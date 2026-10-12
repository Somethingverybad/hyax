import Foundation
import WebRTC
import AVFoundation

/// Медиа-слой звонков — перенос NativeCallPlugin из WhoYaX: соединения по
/// участникам, ручной режим аудио в связке с CallKit. Сигналинг — в CallService.
final class CallEngine {
    static let shared = CallEngine()

    var onSdp: ((String, String, String) -> Void)?        // peerId, type, sdp
    var onIce: ((String, String, String?, Int32) -> Void)? // peerId, candidate, sdpMid, index
    var onState: ((String, String) -> Void)?              // peerId, state

    private static let factory: RTCPeerConnectionFactory = {
        RTCInitializeSSL()
        return RTCPeerConnectionFactory(encoderFactory: RTCDefaultVideoEncoderFactory(), decoderFactory: RTCDefaultVideoDecoderFactory())
    }()
    private static let mediaConstraints = RTCMediaConstraints(mandatoryConstraints: ["OfferToReceiveAudio": "true"], optionalConstraints: nil)

    private var peers: [String: RTCPeerConnection] = [:]
    private var delegates: [String: PeerDelegate] = [:]
    private var audioTrack: RTCAudioTrack?
    private var iceServers: [RTCIceServer] = []
    private let queue = DispatchQueue(label: "wyx.call")

    private init() { NativeCallAudio.shared.prepare() }

    /// Микрофон запрашиваем до соединения.
    func start(iceServers: [[String: Any]]) async -> Bool {
        self.iceServers = iceServers.compactMap { e in
            let urls: [String]
            if let s = e["urls"] as? String { urls = [s] } else if let m = e["urls"] as? [String] { urls = m } else { return nil }
            if let u = e["username"] as? String, let c = e["credential"] as? String { return RTCIceServer(urlStrings: urls, username: u, credential: c) }
            return RTCIceServer(urlStrings: urls)
        }
        let granted = await AVAudioApplication.requestRecordPermission()
        guard granted else { return false }
        queue.sync {
            NativeCallAudio.shared.beginCall()
            if audioTrack == nil {
                let source = CallEngine.factory.audioSource(with: RTCMediaConstraints(mandatoryConstraints: nil, optionalConstraints: nil))
                audioTrack = CallEngine.factory.audioTrack(with: source, trackId: "wyx-audio")
            }
        }
        return true
    }

    func createPeer(_ peerId: String) { queue.async { _ = self.peer(for: peerId) } }

    func createOffer(_ peerId: String) {
        queue.async {
            let pc = self.peer(for: peerId)
            pc.offer(for: Self.mediaConstraints) { sdp, _ in
                guard let sdp else { return }
                pc.setLocalDescription(sdp) { _ in self.onSdp?(peerId, "offer", sdp.sdp) }
            }
        }
    }

    func setRemote(_ peerId: String, type: String, sdp: String) {
        queue.async {
            let pc = self.peer(for: peerId)
            pc.setRemoteDescription(RTCSessionDescription(type: type == "offer" ? .offer : .answer, sdp: sdp)) { error in
                guard error == nil, type == "offer" else { return }
                // На входящий offer отвечаем сразу.
                pc.answer(for: Self.mediaConstraints) { answer, _ in
                    guard let answer else { return }
                    pc.setLocalDescription(answer) { _ in self.onSdp?(peerId, "answer", answer.sdp) }
                }
            }
        }
    }

    func addCandidate(_ peerId: String, candidate: String, sdpMid: String?, index: Int32) {
        queue.async { self.peer(for: peerId).add(RTCIceCandidate(sdp: candidate, sdpMLineIndex: index, sdpMid: sdpMid)) { _ in } }
    }

    func closePeer(_ peerId: String) { queue.async { self.drop(peerId) } }

    func end() {
        queue.async {
            self.peers.keys.forEach { self.drop($0) }
            self.audioTrack = nil
            NativeCallAudio.shared.endCall()
        }
    }

    func setMuted(_ muted: Bool) { queue.async { self.audioTrack?.isEnabled = !muted } }

    private func peer(for peerId: String) -> RTCPeerConnection {
        if let existing = peers[peerId] { return existing }
        let config = RTCConfiguration()
        config.iceServers = iceServers
        config.sdpSemantics = .unifiedPlan
        config.continualGatheringPolicy = .gatherContinually
        let delegate = PeerDelegate(peerId: peerId, engine: self)
        let pc = CallEngine.factory.peerConnection(with: config, constraints: RTCMediaConstraints(mandatoryConstraints: nil, optionalConstraints: nil), delegate: delegate)!
        if let audioTrack { pc.add(audioTrack, streamIds: ["wyx"]) }
        peers[peerId] = pc; delegates[peerId] = delegate
        return pc
    }

    private func drop(_ peerId: String) {
        peers[peerId]?.close(); peers.removeValue(forKey: peerId); delegates.removeValue(forKey: peerId)
    }
}

private final class PeerDelegate: NSObject, RTCPeerConnectionDelegate {
    private let peerId: String
    private weak var engine: CallEngine?
    init(peerId: String, engine: CallEngine) { self.peerId = peerId; self.engine = engine }
    func peerConnection(_ pc: RTCPeerConnection, didGenerate candidate: RTCIceCandidate) {
        engine?.onIce?(peerId, candidate.sdp, candidate.sdpMid, candidate.sdpMLineIndex)
    }
    func peerConnection(_ pc: RTCPeerConnection, didChange newState: RTCPeerConnectionState) {
        let name: String
        switch newState { case .connected: name = "connected"; case .disconnected: name = "disconnected"; case .failed: name = "failed"; case .closed: name = "closed"; case .connecting: name = "connecting"; default: name = "new" }
        engine?.onState?(peerId, name)
    }
    func peerConnection(_ pc: RTCPeerConnection, didChange stateChanged: RTCSignalingState) {}
    func peerConnection(_ pc: RTCPeerConnection, didAdd stream: RTCMediaStream) {}
    func peerConnection(_ pc: RTCPeerConnection, didRemove stream: RTCMediaStream) {}
    func peerConnectionShouldNegotiate(_ pc: RTCPeerConnection) {}
    func peerConnection(_ pc: RTCPeerConnection, didChange newState: RTCIceConnectionState) {}
    func peerConnection(_ pc: RTCPeerConnection, didChange newState: RTCIceGatheringState) {}
    func peerConnection(_ pc: RTCPeerConnection, didRemove candidates: [RTCIceCandidate]) {}
    func peerConnection(_ pc: RTCPeerConnection, didOpen dataChannel: RTCDataChannel) {}
}

/// Аудио-сессия звонка в связке с CallKit: сессию активирует система,
/// приложение включает звук по её сигналу (перенос NativeCallAudio).
final class NativeCallAudio {
    static let shared = NativeCallAudio()
    private var speakerOn = false
    private var inCall = false
    private init() {}

    func prepare() {
        let s = RTCAudioSession.sharedInstance()
        s.useManualAudio = true; s.isAudioEnabled = false
    }
    func beginCall() {
        inCall = true
        let s = RTCAudioSession.sharedInstance()
        s.lockForConfiguration()
        let c = RTCAudioSessionConfiguration.webRTC()
        c.category = AVAudioSession.Category.playAndRecord.rawValue
        c.mode = AVAudioSession.Mode.voiceChat.rawValue
        c.categoryOptions = [.allowBluetooth, .allowBluetoothA2DP]
        try? s.setConfiguration(c)
        s.unlockForConfiguration()
    }
    func activate(_ a: AVAudioSession) { let s = RTCAudioSession.sharedInstance(); s.audioSessionDidActivate(a); s.isAudioEnabled = true; applyRoute() }
    func deactivate(_ a: AVAudioSession) { let s = RTCAudioSession.sharedInstance(); s.isAudioEnabled = false; s.audioSessionDidDeactivate(a) }
    func setSpeaker(_ on: Bool) { speakerOn = on; applyRoute() }
    func endCall() { inCall = false; speakerOn = false; RTCAudioSession.sharedInstance().isAudioEnabled = false }
    private func applyRoute() {
        guard inCall else { return }
        let s = RTCAudioSession.sharedInstance()
        s.lockForConfiguration(); try? s.overrideOutputAudioPort(speakerOn ? .speaker : .none); s.unlockForConfiguration()
    }
}
