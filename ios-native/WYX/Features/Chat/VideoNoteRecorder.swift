import SwiftUI
import AVFoundation

/// Запись видео-треугольника: фронтальная камера, до 60 секунд, переворот
/// треугольника на лету, экспорт в mp4 (QuickTime .mov не играет в Chrome).
@MainActor
final class VideoNoteCamera: NSObject, ObservableObject, AVCaptureFileOutputRecordingDelegate {
    @Published var ready = false
    @Published var recording = false
    @Published var seconds = 0
    @Published var front = true
    let session = AVCaptureSession()
    private let output = AVCaptureMovieFileOutput()
    private var timer: Timer?
    private var finish: ((URL?) -> Void)?

    func start() async {
        guard await AVCaptureDevice.requestAccess(for: .video), await AVCaptureDevice.requestAccess(for: .audio) else { return }
        try? AVAudioSession.sharedInstance().setCategory(.playAndRecord, mode: .videoRecording, options: [.defaultToSpeaker, .allowBluetooth])
        try? AVAudioSession.sharedInstance().setActive(true)
        let s = session
        s.beginConfiguration()
        s.sessionPreset = .high
        for i in s.inputs { s.removeInput(i) }
        if let cam = camera(front: front), let input = try? AVCaptureDeviceInput(device: cam), s.canAddInput(input) { s.addInput(input) }
        if let mic = AVCaptureDevice.default(for: .audio), let input = try? AVCaptureDeviceInput(device: mic), s.canAddInput(input) { s.addInput(input) }
        if !s.outputs.contains(output), s.canAddOutput(output) { s.addOutput(output) }
        output.maxRecordedDuration = CMTime(seconds: 60, preferredTimescale: 1)
        if let conn = output.connection(with: .video) {
            conn.videoRotationAngle = 90
            if conn.isVideoMirroringSupported { conn.isVideoMirrored = false }
        }
        s.commitConfiguration()
        Task.detached { s.startRunning(); await MainActor.run { self.ready = true } }
    }

    func flipCamera() async { front.toggle(); ready = false; await start() }

    private func camera(front: Bool) -> AVCaptureDevice? {
        AVCaptureDevice.default(.builtInWideAngleCamera, for: .video, position: front ? .front : .back)
    }

    func record() {
        let u = FileManager.default.temporaryDirectory.appendingPathComponent("note-\(UUID().uuidString).mov")
        output.startRecording(to: u, recordingDelegate: self)
        recording = true; seconds = 0
        timer = Timer.scheduledTimer(withTimeInterval: 1, repeats: true) { [weak self] _ in Task { @MainActor in self?.seconds += 1 } }
    }

    func stop() async -> URL? {
        timer?.invalidate(); timer = nil
        guard recording else { return nil }
        recording = false
        let mov: URL? = await withCheckedContinuation { c in finish = { c.resume(returning: $0) }; output.stopRecording() }
        guard let mov else { return nil }
        return await export(mov)
    }

    func close() { Task.detached { [session] in session.stopRunning() } }

    nonisolated func fileOutput(_ output: AVCaptureFileOutput, didFinishRecordingTo url: URL, from connections: [AVCaptureConnection], error: Error?) {
        Task { @MainActor in finish?(error == nil || (error as NSError?)?.code == AVError.maximumDurationReached.rawValue ? url : nil); finish = nil }
    }

    private func export(_ mov: URL) async -> URL? {
        let asset = AVURLAsset(url: mov)
        guard let ex = AVAssetExportSession(asset: asset, presetName: AVAssetExportPreset960x540) else { return mov }
        let out = mov.deletingPathExtension().appendingPathExtension("mp4")
        ex.outputURL = out; ex.outputFileType = .mp4; ex.shouldOptimizeForNetworkUse = true
        await ex.export()
        try? FileManager.default.removeItem(at: mov)
        return ex.status == .completed ? out : nil
    }
}

struct CameraPreview: UIViewRepresentable {
    let session: AVCaptureSession
    let mirrored: Bool
    func makeUIView(context: Context) -> PreviewView { let v = PreviewView(); v.previewLayer.session = session; v.previewLayer.videoGravity = .resizeAspectFill; return v }
    func updateUIView(_ v: PreviewView, context: Context) {
        v.previewLayer.session = session
        if let c = v.previewLayer.connection, c.isVideoMirroringSupported { c.automaticallyAdjustsVideoMirroring = false; c.isVideoMirrored = mirrored }
    }
    final class PreviewView: UIView {
        override static var layerClass: AnyClass { AVCaptureVideoPreviewLayer.self }
        var previewLayer: AVCaptureVideoPreviewLayer { layer as! AVCaptureVideoPreviewLayer }
    }
}

/// Экран записи треугольника: превью в стеклянной рамке, переворот, смена
/// камеры, большая кнопка записи, отмена.
struct VideoNoteRecorderView: View {
    @StateObject private var cam = VideoNoteCamera()
    @State private var flip = false
    let onDone: (URL, Int, Bool, Bool) -> Void   // файл, секунды, зеркало, переворот
    let onCancel: () -> Void
    private let size: CGFloat = 240

    var body: some View {
        ZStack {
            Mint.pageGradient.ignoresSafeArea()
            VStack(spacing: 24) {
                Spacer()
                ZStack {
                    TriangleShape(flip: flip).fill(LinearGradient(colors: [Mint.accent, Color(hex: 0x8DBB5C), Mint.deepMint], startPoint: .topLeading, endPoint: .bottomTrailing))
                        .frame(width: size, height: size).shadow(color: .black.opacity(0.2), radius: 5.5, y: 5)
                    ZStack {
                        Color.black
                        if cam.ready { CameraPreview(session: cam.session, mirrored: cam.front) } else { ProgressView().tint(.white) }
                    }
                    .frame(width: size - 16, height: size - 16).clipShape(TriangleShape(flip: flip)).offset(y: flip ? 3 : 5)
                }
                .animation(.easeInOut(duration: 0.3), value: flip)
                Text(cam.recording ? String(format: "%02d:%02d", cam.seconds / 60, cam.seconds % 60) : "Тап — начать запись, до минуты")
                    .font(Inter.medium(15)).foregroundStyle(Mint.title).monospacedDigit()
                HStack(spacing: 20) {
                    round("xmark") { cam.close(); onCancel() }
                    round("triangle", rotate: flip) { Haptic.light(); flip.toggle() }
                    Button {
                        if cam.recording { Task { if let u = await cam.stop() { Haptic.medium(); cam.close(); onDone(u, cam.seconds, cam.front, flip) } } }
                        else { Haptic.medium(); cam.record() }
                    } label: {
                        ZStack {
                            Circle().fill(cam.recording ? .red : Mint.accent).frame(width: 72, height: 72)
                            if cam.recording { RoundedRectangle(cornerRadius: 6).fill(.white).frame(width: 26, height: 26) }
                            else { MintIcon("camera", 28, 22).foregroundStyle(Mint.accentFg) }
                        }
                    }
                    .buttonStyle(.plain).shadow(color: .black.opacity(0.2), radius: 8, y: 4)
                    round("arrow.triangle.2.circlepath.camera") { Task { await cam.flipCamera() } }
                    Color.clear.frame(width: 40, height: 40)
                }
                Spacer()
            }
        }
        .task { await cam.start() }
        .onChange(of: cam.seconds) { _, s in if s >= 60, cam.recording { Task { if let u = await cam.stop() { cam.close(); onDone(u, 60, cam.front, flip) } } } }
    }

    private func round(_ icon: String, rotate: Bool = false, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Image(systemName: icon).font(.system(size: 17, weight: .medium)).foregroundStyle(Mint.ink).rotationEffect(.degrees(rotate ? 180 : 0)).frame(width: 40, height: 40)
        }
        .buttonStyle(.plain).mintPill()
    }
}
