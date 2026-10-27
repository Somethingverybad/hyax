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

    /// По умолчанию разговорный динамик, громкая — по кнопке или с видео.
    private var speakerOn = false
    private var inCall = false
    /// Звук включён: CallKit активировал сессию или мы сами (звонок без CallKit).
    private var activated = false
    private var manual = false
    private var routeObserver: NSObjectProtocol?
    /// Динамик сменили не мы (VoipPlugin передаёт странице событие callSpeaker).
    var onSpeakerChange: ((Bool) -> Void)?

    private init() {}

    func prepare() {
        let session = RTCAudioSession.sharedInstance()
        session.useManualAudio = true
        session.isAudioEnabled = false
        CallDiag.observeSession()
        if routeObserver == nil {
            routeObserver = NotificationCenter.default.addObserver(
                forName: AVAudioSession.routeChangeNotification, object: nil, queue: nil
            ) { [weak self] n in self?.routeChanged(n) }
        }
    }

    /// Динамик переключили кнопкой на системном экране звонка (CallKit) или
    /// его сбросила перенастройка сессии. Запоминаем фактический — чтобы
    /// applyRoute не вернул прежний — и сообщаем странице: кнопка в приложении
    /// показывает то же, что CallKit. Наушники и Bluetooth не трогаем.
    ///
    /// Громкую на соединении включает страница (setSpeaker), уже после того
    /// как движок WebRTC перенастроил сессию под звук. Возвращать громкую
    /// здесь нельзя: нажатие «Динамик» в CallKit приходит с той же причиной
    /// (categoryChange), и выключить громкую было бы невозможно.
    private func routeChanged(_ n: Notification) {
        guard inCall else { return }
        let outs = AVAudioSession.sharedInstance().currentRoute.outputs
        let speaker = outs.contains { $0.portType == .builtInSpeaker }
        let receiver = outs.contains { $0.portType == .builtInReceiver }
        guard speaker || receiver, speaker != speakerOn else { return }
        CallDiag.log("speaker changed outside: \(speaker)")
        speakerOn = speaker
        onSpeakerChange?(speaker)
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
        // Та же настройка — движку: запуская звук на соединении, он
        // перенастраивал сессию своей (другие опции категории), а смена
        // категории сбрасывала выбранный динамик.
        RTCAudioSessionConfiguration.setWebRTC(config)
        try? session.setConfiguration(config)
        session.unlockForConfiguration()
        // Звонок без CallKit (система вызов не показала — «Не беспокоить»,
        // лимиты — и ответили на экране приложения): didActivate не придёт,
        // и разговор шёл бы без звука. Исходящий успевает зарегистрироваться
        // в CallKit за доли секунды, поэтому ждём немного.
        DispatchQueue.main.asyncAfter(deadline: .now() + 1.5) { [weak self] in
            guard let self, self.inCall, !self.activated, !VoipManager.shared.hasCallKitCall else { return }
            self.activateManually()
        }
    }

    private func activateManually() {
        CallDiag.log("activate without CallKit")
        let session = RTCAudioSession.sharedInstance()
        session.lockForConfiguration()
        do { try session.setActive(true) } catch { CallDiag.log("setActive: \(error.localizedDescription)") }
        session.unlockForConfiguration()
        session.isAudioEnabled = true
        activated = true
        manual = true
        applyRoute()
    }

    /// CallKit активировал сессию — включаем звук движка.
    func activate(_ audioSession: AVAudioSession) {
        CallDiag.log("didActivate")
        activated = true
        let session = RTCAudioSession.sharedInstance()
        session.audioSessionDidActivate(audioSession)
        session.isAudioEnabled = true
        applyRoute()
    }

    func deactivate(_ audioSession: AVAudioSession) {
        CallDiag.log("didDeactivate")
        activated = false
        let session = RTCAudioSession.sharedInstance()
        session.isAudioEnabled = false
        session.audioSessionDidDeactivate(audioSession)
    }

    /// auto — громкая ради видео: при наушниках и Bluetooth не включаем.
    /// Возвращает, что вышло.
    @discardableResult
    func setSpeaker(_ enabled: Bool, auto: Bool = false) -> Bool {
        CallDiag.log("setSpeaker \(enabled) auto=\(auto)")
        if auto && enabled {
            let outs = AVAudioSession.sharedInstance().currentRoute.outputs
            let builtIn = outs.contains { $0.portType == .builtInReceiver || $0.portType == .builtInSpeaker }
            if !outs.isEmpty && !builtIn { return speakerOn }
        }
        speakerOn = enabled
        applyRoute()
        return speakerOn
    }

    func endCall() {
        CallDiag.log("endCall")
        inCall = false
        speakerOn = false
        activated = false
        let session = RTCAudioSession.sharedInstance()
        session.isAudioEnabled = false
        if manual {
            manual = false
            session.lockForConfiguration()
            try? session.setActive(false)
            session.unlockForConfiguration()
        }
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
