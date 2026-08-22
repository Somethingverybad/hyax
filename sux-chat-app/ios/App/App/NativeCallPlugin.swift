import Foundation
import Capacitor
import WebRTC
import AVFoundation

/// Медиа-слой звонков на нативном WebRTC.
///
/// Раньше разговор вёл WebView, и это не уживалось с CallKit: аудио-сессией
/// не могут владеть двое — микрофон движка молчал, пока звонок держала
/// система. Нативный движок работает с CallKit кооперативно (ручной режим
/// аудио: система активирует сессию — мы включаем звук), поэтому разговор
/// живёт при заблокированном экране, как в обычной телефонии.
///
/// Сигналинг и весь интерфейс остаются в вебе: сюда приходят только SDP и
/// ICE-кандидаты, обратно уходят события. Соединения хранятся по участнику,
/// поэтому групповой звонок (mesh) работает тем же кодом.
@objc(NativeCallPlugin)
public class NativeCallPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "NativeCallPlugin"
    public let jsName = "NativeCall"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "start", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "createPeer", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "createOffer", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "setRemoteDescription", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "addCandidate", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "closePeer", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "end", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "setMuted", returnType: CAPPluginReturnPromise),
    ]

    private static let factory: RTCPeerConnectionFactory = {
        RTCInitializeSSL()
        return RTCPeerConnectionFactory(
            encoderFactory: RTCDefaultVideoEncoderFactory(),
            decoderFactory: RTCDefaultVideoDecoderFactory())
    }()

    private var peers: [String: RTCPeerConnection] = [:]
    private var delegates: [String: PeerDelegate] = [:]
    private var audioTrack: RTCAudioTrack?
    private var iceServers: [RTCIceServer] = []
    private let queue = DispatchQueue(label: "hyax.nativecall")

    public override func load() {
        NativeCallAudio.shared.prepare()
    }

    // MARK: - Методы из JS

    @objc func start(_ call: CAPPluginCall) {
        let servers = call.getArray("iceServers", JSObject.self) ?? []
        iceServers = servers.compactMap { entry in
            let urls: [String]
            if let single = entry["urls"] as? String {
                urls = [single]
            } else if let many = entry["urls"] as? [String] {
                urls = many
            } else {
                return nil
            }
            if let user = entry["username"] as? String, let cred = entry["credential"] as? String {
                return RTCIceServer(urlStrings: urls, username: user, credential: cred)
            }
            return RTCIceServer(urlStrings: urls)
        }

        // Микрофон запрашиваем до соединения: без разрешения звонок
        // бессмысленен, а спрашивать посреди разговора поздно.
        AVAudioSession.sharedInstance().requestRecordPermission { granted in
            if !granted {
                call.reject("Нет доступа к микрофону")
                return
            }
            self.queue.async {
                NativeCallAudio.shared.beginCall()
                if self.audioTrack == nil {
                    let constraints = RTCMediaConstraints(mandatoryConstraints: nil, optionalConstraints: nil)
                    let source = NativeCallPlugin.factory.audioSource(with: constraints)
                    self.audioTrack = NativeCallPlugin.factory.audioTrack(with: source, trackId: "hyax-audio")
                }
                call.resolve()
            }
        }
    }

    @objc func createPeer(_ call: CAPPluginCall) {
        guard let peerId = call.getString("peerId") else {
            call.reject("peerId обязателен")
            return
        }
        queue.async {
            _ = self.peer(for: peerId)
            call.resolve()
        }
    }

    @objc func createOffer(_ call: CAPPluginCall) {
        guard let peerId = call.getString("peerId") else {
            call.reject("peerId обязателен")
            return
        }
        queue.async {
            let pc = self.peer(for: peerId)
            pc.offer(for: Self.mediaConstraints) { sdp, error in
                guard let sdp else {
                    call.reject(error?.localizedDescription ?? "offer не создан")
                    return
                }
                pc.setLocalDescription(sdp) { _ in
                    self.notifyListeners("sdp", data: [
                        "peerId": peerId, "type": "offer", "sdp": sdp.sdp,
                    ])
                    call.resolve()
                }
            }
        }
    }

    @objc func setRemoteDescription(_ call: CAPPluginCall) {
        guard let peerId = call.getString("peerId"),
              let type = call.getString("type"),
              let sdp = call.getString("sdp") else {
            call.reject("нужны peerId, type и sdp")
            return
        }
        queue.async {
            let pc = self.peer(for: peerId)
            let desc = RTCSessionDescription(type: type == "offer" ? .offer : .answer, sdp: sdp)
            pc.setRemoteDescription(desc) { error in
                if let error {
                    call.reject(error.localizedDescription)
                    return
                }
                guard type == "offer" else {
                    call.resolve()
                    return
                }
                // На входящий offer сразу отвечаем: лишний круг через JS
                // только добавил бы задержку перед первым звуком.
                pc.answer(for: Self.mediaConstraints) { answer, error in
                    guard let answer else {
                        call.reject(error?.localizedDescription ?? "answer не создан")
                        return
                    }
                    pc.setLocalDescription(answer) { _ in
                        self.notifyListeners("sdp", data: [
                            "peerId": peerId, "type": "answer", "sdp": answer.sdp,
                        ])
                        call.resolve()
                    }
                }
            }
        }
    }

    @objc func addCandidate(_ call: CAPPluginCall) {
        guard let peerId = call.getString("peerId"),
              let candidate = call.getString("candidate") else {
            call.reject("нужны peerId и candidate")
            return
        }
        let mid = call.getString("sdpMid")
        let index = call.getInt("sdpMLineIndex") ?? 0
        queue.async {
            let ice = RTCIceCandidate(sdp: candidate, sdpMLineIndex: Int32(index), sdpMid: mid)
            self.peer(for: peerId).add(ice) { _ in }
            call.resolve()
        }
    }

    @objc func closePeer(_ call: CAPPluginCall) {
        guard let peerId = call.getString("peerId") else {
            call.reject("peerId обязателен")
            return
        }
        queue.async {
            self.drop(peerId)
            call.resolve()
        }
    }

    @objc func end(_ call: CAPPluginCall) {
        queue.async {
            self.peers.keys.forEach { self.drop($0) }
            self.audioTrack = nil
            NativeCallAudio.shared.endCall()
            call.resolve()
        }
    }

    @objc func setMuted(_ call: CAPPluginCall) {
        let muted = call.getBool("muted") ?? false
        queue.async {
            self.audioTrack?.isEnabled = !muted
            call.resolve()
        }
    }

    // MARK: - Внутреннее

    private static let mediaConstraints = RTCMediaConstraints(
        mandatoryConstraints: ["OfferToReceiveAudio": "true"],
        optionalConstraints: nil)

    private func peer(for peerId: String) -> RTCPeerConnection {
        if let existing = peers[peerId] { return existing }

        let config = RTCConfiguration()
        config.iceServers = iceServers
        config.sdpSemantics = .unifiedPlan
        config.continualGatheringPolicy = .gatherContinually

        let delegate = PeerDelegate(peerId: peerId, plugin: self)
        let pc = NativeCallPlugin.factory.peerConnection(
            with: config,
            constraints: RTCMediaConstraints(mandatoryConstraints: nil, optionalConstraints: nil),
            delegate: delegate)!
        if let audioTrack {
            pc.add(audioTrack, streamIds: ["hyax"])
        }
        peers[peerId] = pc
        delegates[peerId] = delegate
        return pc
    }

    private func drop(_ peerId: String) {
        peers[peerId]?.close()
        peers.removeValue(forKey: peerId)
        delegates.removeValue(forKey: peerId)
    }

    fileprivate func emitCandidate(_ peerId: String, _ candidate: RTCIceCandidate) {
        notifyListeners("iceCandidate", data: [
            "peerId": peerId,
            "candidate": candidate.sdp,
            "sdpMid": candidate.sdpMid ?? "",
            "sdpMLineIndex": Int(candidate.sdpMLineIndex),
        ])
    }

    fileprivate func emitState(_ peerId: String, _ state: String) {
        notifyListeners("peerState", data: ["peerId": peerId, "state": state])
    }
}

/// Колбэки соединения приходят без указания участника — поэтому у каждого
/// свой делегат, который помнит, чей он.
private final class PeerDelegate: NSObject, RTCPeerConnectionDelegate {
    private let peerId: String
    private weak var plugin: NativeCallPlugin?

    init(peerId: String, plugin: NativeCallPlugin) {
        self.peerId = peerId
        self.plugin = plugin
    }

    func peerConnection(_ pc: RTCPeerConnection, didGenerate candidate: RTCIceCandidate) {
        plugin?.emitCandidate(peerId, candidate)
    }

    func peerConnection(_ pc: RTCPeerConnection, didChange newState: RTCPeerConnectionState) {
        let name: String
        switch newState {
        case .connected: name = "connected"
        case .disconnected: name = "disconnected"
        case .failed: name = "failed"
        case .closed: name = "closed"
        case .connecting: name = "connecting"
        default: name = "new"
        }
        plugin?.emitState(peerId, name)
    }

    // Остальные требования протокола нам не нужны: звук воспроизводится
    // движком сам, видео и каналы данных не используем.
    func peerConnection(_ pc: RTCPeerConnection, didChange stateChanged: RTCSignalingState) {}
    func peerConnection(_ pc: RTCPeerConnection, didAdd stream: RTCMediaStream) {}
    func peerConnection(_ pc: RTCPeerConnection, didRemove stream: RTCMediaStream) {}
    func peerConnectionShouldNegotiate(_ pc: RTCPeerConnection) {}
    func peerConnection(_ pc: RTCPeerConnection, didChange newState: RTCIceConnectionState) {}
    func peerConnection(_ pc: RTCPeerConnection, didChange newState: RTCIceGatheringState) {}
    func peerConnection(_ pc: RTCPeerConnection, didRemove candidates: [RTCIceCandidate]) {}
    func peerConnection(_ pc: RTCPeerConnection, didOpen dataChannel: RTCDataChannel) {}
}
