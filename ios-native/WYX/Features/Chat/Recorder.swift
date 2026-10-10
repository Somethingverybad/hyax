import AVFoundation
import Foundation

/// Запись голосового: удержание кнопки микрофона. m4a (AAC), как принимает сервер.
@MainActor
final class VoiceRecorder: ObservableObject {
    @Published var recording = false
    @Published var seconds = 0
    private var recorder: AVAudioRecorder?
    private var timer: Timer?
    private var url: URL?

    func start() async -> Bool {
        let ok = await AVAudioApplication.requestRecordPermission()
        guard ok else { return false }
        let session = AVAudioSession.sharedInstance()
        try? session.setCategory(.playAndRecord, mode: .default, options: [.defaultToSpeaker, .allowBluetooth])
        try? session.setActive(true)
        let u = FileManager.default.temporaryDirectory.appendingPathComponent("voice-\(UUID().uuidString).m4a")
        let settings: [String: Any] = [AVFormatIDKey: kAudioFormatMPEG4AAC, AVSampleRateKey: 44100, AVNumberOfChannelsKey: 1, AVEncoderAudioQualityKey: AVAudioQuality.high.rawValue]
        guard let r = try? AVAudioRecorder(url: u, settings: settings) else { return false }
        r.record()
        recorder = r; url = u; seconds = 0; recording = true
        timer?.invalidate()
        timer = Timer.scheduledTimer(withTimeInterval: 1, repeats: true) { [weak self] _ in Task { @MainActor in self?.seconds += 1 } }
        return true
    }

    /// Остановить; nil — слишком коротко или отменено.
    func stop(cancel: Bool = false) -> (url: URL, seconds: Int)? {
        timer?.invalidate(); timer = nil
        recorder?.stop(); recording = false
        defer { recorder = nil }
        guard !cancel, let url, seconds >= 1 else { if let url { try? FileManager.default.removeItem(at: url) }; return nil }
        return (url, seconds)
    }
}
