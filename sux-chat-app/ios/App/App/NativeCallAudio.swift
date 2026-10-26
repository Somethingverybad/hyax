import Foundation
import WebRTC
import AVFoundation
import UIKit

/// Аудио-сессия звонка в связке с CallKit.
///
/// Правило системы: сессию активирует CallKit, а приложение только включает
/// звук по его сигналу. Поэтому движок переводится в ручной режим
/// (useManualAudio), а isAudioEnabled переключается из didActivate и
/// didDeactivate. Именно так звонок звучит на заблокированном экране.
final class NativeCallAudio {
    static let shared = NativeCallAudio()

    private var speakerOn = true
    private var inCall = false

    private init() {}

    func prepare() {
        let session = RTCAudioSession.sharedInstance()
        session.useManualAudio = true
        session.isAudioEnabled = false
        CallDiag.observeSession()
    }

    func beginCall() {
        CallDiag.log("beginCall inCall=\(inCall)")
        inCall = true
        let session = RTCAudioSession.sharedInstance()
        session.lockForConfiguration()
        let config = RTCAudioSessionConfiguration.webRTC()
        config.category = AVAudioSession.Category.playAndRecord.rawValue
        config.mode = AVAudioSession.Mode.voiceChat.rawValue
        config.categoryOptions = [.allowBluetooth, .allowBluetoothA2DP]
        try? session.setConfiguration(config)
        session.unlockForConfiguration()
    }

    /// CallKit активировал сессию — включаем звук движка.
    func activate(_ audioSession: AVAudioSession) {
        CallDiag.log("didActivate")
        let session = RTCAudioSession.sharedInstance()
        session.audioSessionDidActivate(audioSession)
        session.isAudioEnabled = true
        applyRoute()
    }

    func deactivate(_ audioSession: AVAudioSession) {
        CallDiag.log("didDeactivate")
        let session = RTCAudioSession.sharedInstance()
        session.isAudioEnabled = false
        session.audioSessionDidDeactivate(audioSession)
    }

    func setSpeaker(_ enabled: Bool) {
        CallDiag.log("setSpeaker \(enabled)")
        speakerOn = enabled
        applyRoute()
    }

    func endCall() {
        CallDiag.log("endCall")
        inCall = false
        speakerOn = true
        RTCAudioSession.sharedInstance().isAudioEnabled = false
    }

    private func applyRoute() {
        guard inCall else { return }
        let session = RTCAudioSession.sharedInstance()
        session.lockForConfiguration()
        try? session.overrideOutputAudioPort(speakerOn ? .speaker : .none)
        session.unlockForConfiguration()
    }
}

#if DEBUG
/// Отладочный журнал звонка — только сборка Debug. Строки идут и в консоль
/// (devicectl --console), и в файл Library/Caches/calldiag.log: его можно
/// забрать `devicectl device copy from`, даже если консоль по Wi-Fi отвалилась.
enum CallDiag {
    private static let q = DispatchQueue(label: "hyax.calldiag")
    private static let url = FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask)[0]
        .appendingPathComponent("calldiag.log")
    private static let fmt: DateFormatter = {
        let f = DateFormatter()
        f.dateFormat = "HH:mm:ss.SSS"
        return f
    }()
    private static var observing = false

    static func log(_ text: @autoclosure () -> String) {
        let s = text()
        NSLog("[calldiag] %@", s)
        q.async {
            guard let data = "\(fmt.string(from: Date())) \(s)\n".data(using: .utf8) else { return }
            if let h = try? FileHandle(forWritingTo: url) {
                h.seekToEndOfFile()
                h.write(data)
                try? h.close()
            } else {
                try? data.write(to: url)
            }
        }
    }

    /// Состояние аудио-сессии одной строкой.
    static func session() -> String {
        let s = AVAudioSession.sharedInstance()
        let r = RTCAudioSession.sharedInstance()
        let ins = s.currentRoute.inputs.map { $0.portType.rawValue }.joined(separator: ",")
        let outs = s.currentRoute.outputs.map { $0.portType.rawValue }.joined(separator: ",")
        return "cat=\(s.category.rawValue) mode=\(s.mode.rawValue) inAvail=\(s.isInputAvailable) in=[\(ins)] out=[\(outs)] "
            + "perm=\(s.recordPermission.rawValue) rtcActive=\(r.isActive) rtcEnabled=\(r.isAudioEnabled)"
    }

    static func observeSession() {
        guard !observing else { return }
        observing = true
        let nc = NotificationCenter.default
        nc.addObserver(forName: AVAudioSession.interruptionNotification, object: nil, queue: nil) { n in
            let type = (n.userInfo?[AVAudioSessionInterruptionTypeKey] as? UInt) ?? 99
            let reason = (n.userInfo?[AVAudioSessionInterruptionReasonKey] as? UInt) ?? 99
            log("interruption type=\(type) reason=\(reason)")
        }
        nc.addObserver(forName: AVAudioSession.routeChangeNotification, object: nil, queue: nil) { n in
            let reason = (n.userInfo?[AVAudioSessionRouteChangeReasonKey] as? UInt) ?? 99
            log("routeChange reason=\(reason) \(session())")
        }
        nc.addObserver(forName: AVAudioSession.mediaServicesWereResetNotification, object: nil, queue: nil) { _ in
            log("mediaServicesWereReset")
        }
        nc.addObserver(forName: UIApplication.didEnterBackgroundNotification, object: nil, queue: nil) { _ in log("app background") }
        nc.addObserver(forName: UIApplication.didBecomeActiveNotification, object: nil, queue: nil) { _ in log("app active") }
    }
}
#else
enum CallDiag {
    @inline(__always) static func log(_ text: @autoclosure () -> String) {}
    @inline(__always) static func session() -> String { "" }
    @inline(__always) static func observeSession() {}
}
#endif
