import Foundation
import WebRTC
import AVFoundation

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
    }

    func beginCall() {
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
        let session = RTCAudioSession.sharedInstance()
        session.audioSessionDidActivate(audioSession)
        session.isAudioEnabled = true
        applyRoute()
    }

    func deactivate(_ audioSession: AVAudioSession) {
        let session = RTCAudioSession.sharedInstance()
        session.isAudioEnabled = false
        session.audioSessionDidDeactivate(audioSession)
    }

    func setSpeaker(_ enabled: Bool) {
        speakerOn = enabled
        applyRoute()
    }

    func endCall() {
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
