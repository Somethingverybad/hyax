import SwiftUI
import Combine

/// Звонок 1:1 (аудио): сигналинг по пользовательскому сокету, как
/// NativeCallService в вебе. Типы сигналов: call_invite, call_accept,
/// call_reject, call_end, webrtc_offer, webrtc_answer, webrtc_ice_candidate.
@MainActor
final class CallService: ObservableObject {
    static let shared = CallService()
    enum State { case idle, outgoing, incoming, connecting, active }
    @Published var state: State = .idle
    @Published var peerName = ""
    @Published var peerAvatar: String?
    @Published var muted = false
    @Published var speaker = false
    @Published var startedAt: Date?
    @Published var error: String?

    private var socket: Socket?
    private var me = ""
    private var callId: String?
    private var chatId: String?
    private var targetUserId: String?
    private var isCaller = false
    private var bag = Set<AnyCancellable>()
    private var ice: [[String: Any]] = []

    func attach(socket: Socket, me: String) {
        self.socket = socket; self.me = me
        bag.removeAll()
        socket.events.sink { [weak self] e in self?.handle(e) }.store(in: &bag)
        let engine = CallEngine.shared
        engine.onSdp = { [weak self] peer, type, sdp in Task { @MainActor in self?.send(type == "offer" ? "webrtc_offer" : "webrtc_answer", ["to_user_id": peer, type: ["type": type, "sdp": sdp]]) } }
        engine.onIce = { [weak self] peer, cand, mid, idx in Task { @MainActor in self?.send("webrtc_ice_candidate", ["to_user_id": peer, "candidate": ["candidate": cand, "sdpMid": mid ?? "", "sdpMLineIndex": Int(idx)]]) } }
        engine.onState = { [weak self] _, st in Task { @MainActor in self?.peerState(st) } }
        let voip = VoipManager.shared
        voip.onAnswer = { [weak self] id, payload in Task { @MainActor in await self?.accept(callId: id, from: payload["from_user_id"] as? String ?? "", name: payload["from_username"] as? String ?? "", chat: payload["chat_id"] as? String) } }
        voip.onEnd = { [weak self] id in Task { @MainActor in self?.endedBySystem(id) } }
        voip.onMuted = { [weak self] _, m in Task { @MainActor in self?.setMuted(m) } }
        voip.onToken = { token in Task { try? await API.shared.registerPush(token: token, platform: "ios_voip", secret: nil) } }
        voip.start()
        if let t = voip.voipToken { Task { try? await API.shared.registerPush(token: t, platform: "ios_voip", secret: nil) } }
    }

    private func send(_ type: String, _ extra: [String: Any]) {
        var data: [String: Any] = ["chat_id": chatId ?? "", "call_id": callId ?? ""]
        for (k, v) in extra { data[k] = v }
        socket?.send(["type": type, "data": data])
    }

    private func loadIce() async {
        struct R: Codable { var iceServers: [IceServer]?; var ice_servers: [IceServer]? }
        struct IceServer: Codable { var urls: Urls; var username: String?; var credential: String? }
        enum Urls: Codable { case one(String), many([String])
            init(from d: Decoder) throws { let c = try d.singleValueContainer(); if let s = try? c.decode(String.self) { self = .one(s) } else { self = .many(try c.decode([String].self)) } }
            func encode(to e: Encoder) throws {} }
        var list: [IceServer] = []
        if let r: R = try? await API.shared.get("ice-servers/") { list = r.iceServers ?? r.ice_servers ?? [] }
        else if let arr: [IceServer] = try? await API.shared.get("ice-servers/") { list = arr }
        ice = list.map { s in
            var d: [String: Any] = [:]
            switch s.urls { case .one(let u): d["urls"] = u; case .many(let m): d["urls"] = m }
            if let u = s.username { d["username"] = u }; if let c = s.credential { d["credential"] = c }
            return d
        }
    }

    // MARK: действия

    func startOutgoing(peer: Profile, chat: String) async {
        guard state == .idle else { return }
        await loadIce()
        guard await CallEngine.shared.start(iceServers: ice) else { error = "Нет доступа к микрофону"; return }
        callId = UUID().uuidString.lowercased(); chatId = chat; targetUserId = peer.id; isCaller = true
        peerName = peer.username; peerAvatar = peer.avatar_url; muted = false; speaker = false; startedAt = nil
        state = .outgoing
        send("call_invite", ["to_user_id": peer.id, "call_type": "audio"])
        VoipManager.shared.reportOutgoing(callId: callId!, name: peer.username)
    }

    func accept(callId: String, from: String, name: String, chat: String?) async {
        await loadIce()
        guard await CallEngine.shared.start(iceServers: ice) else { finish("failed"); return }
        self.callId = callId; chatId = chat; targetUserId = from; isCaller = false
        peerName = name; state = .connecting
        send("call_accept", ["to_user_id": from])
    }

    func reject() {
        if let t = targetUserId { send("call_reject", ["to_user_id": t]) }
        if let id = callId { VoipManager.shared.end(callId: id, reason: .declinedElsewhere) }
        finish("rejected")
    }

    func end() {
        if let t = targetUserId, callId != nil { send("call_end", ["to_user_id": t, "status": "ended"]) }
        if let id = callId { VoipManager.shared.end(callId: id, reason: .remoteEnded) }
        finish("ended")
    }

    private func endedBySystem(_ id: String) {
        guard id == callId else { return }
        if let t = targetUserId { send("call_end", ["to_user_id": t, "status": "ended"]) }
        finish("ended")
    }

    func setMuted(_ m: Bool) { muted = m; CallEngine.shared.setMuted(m) }
    func setSpeaker(_ on: Bool) { speaker = on; VoipManager.shared.setSpeaker(on) }

    private func peerState(_ st: String) {
        if st == "connected" { state = .active; startedAt = Date(); if let id = callId { VoipManager.shared.reportConnected(callId: id) } }
        if st == "failed" { if let id = callId { VoipManager.shared.end(callId: id, reason: .failed) }; finish("failed") }
    }

    private func finish(_ reason: String) {
        CallEngine.shared.end()
        callId = nil; targetUserId = nil; chatId = nil; isCaller = false
        state = .idle; startedAt = nil
        AppLog.shared.add("call: finished \(reason)")
    }

    // MARK: сигналы с сокета

    private func handle(_ e: [String: Any]) {
        let type = e["type"] as? String ?? ""
        if type == "notification", let d = e["data"] as? [String: Any], (d["type"] as? String) == "incoming_call" {
            guard state == .idle, let id = d["call_id"].map({ String(describing: $0) }) else { return }
            peerName = d["from_username"] as? String ?? "Звонок"; peerAvatar = d["from_user_avatar"] as? String
            VoipManager.shared.reportIncoming(callId: id, payload: d)
            return
        }
        guard type == "call_signal", let st = e["signal_type"] as? String, let d = e["data"] as? [String: Any] else { return }
        let from = d["from_user_id"].map { String(describing: $0) } ?? ""
        guard !from.isEmpty, from != me else { return }
        if let cid = callId, let incoming = d["call_id"].map({ String(describing: $0) }), incoming != cid { return }
        switch st {
        case "call_accept":
            guard isCaller else { return }
            state = .connecting
            CallEngine.shared.createPeer(from); CallEngine.shared.createOffer(from)
        case "call_reject": if let id = callId { VoipManager.shared.end(callId: id, reason: .declinedElsewhere) }; finish("rejected")
        case "call_end": if let id = callId { VoipManager.shared.end(callId: id, reason: .remoteEnded) }; finish("ended")
        case "webrtc_offer": if let o = d["offer"] as? [String: Any], let sdp = o["sdp"] as? String { CallEngine.shared.createPeer(from); CallEngine.shared.setRemote(from, type: "offer", sdp: sdp) }
        case "webrtc_answer": if let a = d["answer"] as? [String: Any], let sdp = a["sdp"] as? String { CallEngine.shared.setRemote(from, type: "answer", sdp: sdp) }
        case "webrtc_ice_candidate":
            if let c = d["candidate"] as? [String: Any], let cand = c["candidate"] as? String {
                CallEngine.shared.addCandidate(from, candidate: cand, sdpMid: c["sdpMid"] as? String, index: Int32((c["sdpMLineIndex"] as? Int) ?? 0))
            }
        default: break
        }
    }
}

/// Экран звонка поверх всего: имя, состояние, таймер, микрофон/динамик/отбой.
struct CallView: View {
    @ObservedObject private var call = CallService.shared
    @State private var tick = 0
    var body: some View {
        ZStack {
            Mint.pageGradient.ignoresSafeArea()
            VStack(spacing: 18) {
                Spacer()
                Avatar(url: call.peerAvatar, name: call.peerName, size: 120, radius: 36)
                Text(call.peerName).font(Inter.bold(24)).foregroundStyle(Mint.title)
                Text(status).font(Inter.regular(15)).foregroundStyle(Mint.mintMuted).monospacedDigit()
                Spacer()
                HStack(spacing: 28) {
                    round(call.muted ? "mic.slash.fill" : "mic.fill", on: call.muted) { call.setMuted(!call.muted) }
                    Button { Haptic.medium(); call.end() } label: {
                        Image(systemName: "phone.down.fill").font(.system(size: 26)).foregroundStyle(.white).frame(width: 72, height: 72).background(.red).clipShape(Circle())
                    }
                    .buttonStyle(.plain)
                    round(call.speaker ? "speaker.wave.3.fill" : "speaker.fill", on: call.speaker) { call.setSpeaker(!call.speaker) }
                }
                .padding(.bottom, 60)
            }
        }
        .onReceive(Timer.publish(every: 1, on: .main, in: .common).autoconnect()) { _ in tick += 1 }
    }
    private var status: String {
        switch call.state {
        case .outgoing: return "Вызов…"
        case .incoming: return "Входящий"
        case .connecting: return "Соединение…"
        case .active:
            let s = Int(Date().timeIntervalSince(call.startedAt ?? Date())) + 0 * tick
            return String(format: "%02d:%02d", s / 60, s % 60)
        case .idle: return ""
        }
    }
    private func round(_ icon: String, on: Bool, action: @escaping () -> Void) -> some View {
        Button { Haptic.light(); action() } label: {
            Image(systemName: icon).font(.system(size: 22)).foregroundStyle(on ? Mint.accentFg : Mint.ink).frame(width: 60, height: 60)
        }
        .buttonStyle(.plain).background(on ? AnyView(Color.clear.mintLime()) : AnyView(Color.clear.mintPill()))
    }
}
