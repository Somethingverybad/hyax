import SwiftUI
import AVKit
import AVFoundation
import Lottie
import zlib

// MARK: - Картинка в пузыре и полноэкранный просмотр

struct ImageBubble: View {
    let message: Message
    let onOpen: (URL) -> Void
    @State private var url: URL?
    var body: some View {
        ZStack {
            Mint.surface4.opacity(0.35)
            if let url {
                AsyncImage(url: url) { phase in
                    switch phase {
                    case .success(let img): img.resizable().scaledToFill()
                    case .failure: Image(systemName: "photo").foregroundStyle(.white.opacity(0.6))
                    default: ProgressView().tint(.white)
                    }
                }
            }
        }
        .frame(width: 220, height: height)
        .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
        .contentShape(Rectangle())
        .onTapGesture { if let url { onOpen(url) } }
        .task { url = await API.shared.mediaURL(message.file_url) }
    }
    private var height: CGFloat {
        guard let w = message.file_width, let h = message.file_height, w > 0 else { return 180 }
        return min(300, max(90, 220 * CGFloat(h) / CGFloat(w)))
    }
}

/// Полноэкранный просмотр: свайп вниз закрывает, щипок увеличивает.
struct ImageViewer: View {
    let url: URL
    let onClose: () -> Void
    @State private var offset: CGSize = .zero
    @State private var scale: CGFloat = 1
    var body: some View {
        ZStack {
            Color.black.opacity(Double(1 - min(0.6, abs(offset.height) / 500))).ignoresSafeArea()
            AsyncImage(url: url) { img in img.resizable().scaledToFit() } placeholder: { ProgressView().tint(.white) }
                .scaleEffect(scale)
                .offset(offset)
                .gesture(
                    DragGesture().onChanged { offset = $0.translation }
                        .onEnded { v in
                            if v.translation.height > 120 { onClose() } else { withAnimation(.spring(duration: 0.3)) { offset = .zero } }
                        }
                )
                .simultaneousGesture(MagnifyGesture().onChanged { scale = max(1, $0.magnification) }.onEnded { _ in withAnimation { scale = 1 } })
            VStack {
                HStack {
                    Spacer()
                    Button { onClose() } label: { Image(systemName: "xmark").font(.system(size: 16, weight: .semibold)).foregroundStyle(.white).frame(width: 36, height: 36).background(.white.opacity(0.15)).clipShape(Circle()) }
                        .padding(16)
                }
                Spacer()
            }
        }
        .statusBarHidden()
    }
}

// MARK: - Видео-файл и файл

struct VideoFileBubble: View {
    let message: Message
    @State private var poster: URL?
    @State private var player: AVPlayer?
    @State private var showing = false
    var body: some View {
        ZStack {
            Color.black.opacity(0.6)
            if let poster { AsyncImage(url: poster) { $0.resizable().scaledToFill() } placeholder: { Color.clear } }
            Image(systemName: "play.fill").font(.system(size: 26)).foregroundStyle(.white).frame(width: 52, height: 52).background(.black.opacity(0.45)).clipShape(Circle())
        }
        .frame(width: 220, height: 160)
        .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
        .onTapGesture { Task { if let u = await API.shared.mediaURL(message.file_url) { player = AVPlayer(url: u); showing = true } } }
        .task { poster = await API.shared.mediaURL(message.poster_url) }
        .fullScreenCover(isPresented: $showing) {
            if let player { VideoPlayer(player: player).ignoresSafeArea().onAppear { player.play() }.overlay(alignment: .topTrailing) {
                Button { showing = false } label: { Image(systemName: "xmark").foregroundStyle(.white).padding(10).background(.black.opacity(0.4)).clipShape(Circle()) }.padding()
            } }
        }
    }
}

struct FileBubble: View {
    let message: Message
    var body: some View {
        Button {
            Task { if let u = await API.shared.mediaURL(message.file_url) { await UIApplication.shared.open(u) } }
        } label: {
            HStack(spacing: 10) {
                Image(systemName: "doc.fill").font(.system(size: 22)).foregroundStyle(Mint.bubbleFg).frame(width: 40, height: 40).background(.white.opacity(0.15)).clipShape(Circle())
                VStack(alignment: .leading, spacing: 2) {
                    Text(message.file_name ?? "Файл").font(Inter.medium(14)).foregroundStyle(Mint.bubbleFg).lineLimit(1)
                    Text(sizeLabel).font(Inter.regular(12)).foregroundStyle(Mint.bubbleFg.opacity(0.7))
                }
            }
        }
        .buttonStyle(.plain)
    }
    private var sizeLabel: String {
        guard let s = message.file_size, s > 0 else { return "Файл" }
        return ByteCountFormatter.string(fromByteCount: Int64(s), countStyle: .file)
    }
}

// MARK: - Голосовое

@MainActor
final class AudioPlayback: ObservableObject {
    static let shared = AudioPlayback()
    @Published var playingId: String?
    @Published var progress: Double = 0
    private var player: AVPlayer?
    private var timeObs: Any?

    func toggle(id: String, url: URL) {
        if playingId == id { player?.pause(); playingId = nil; return }
        try? AVAudioSession.sharedInstance().setCategory(.playback)
        try? AVAudioSession.sharedInstance().setActive(true)
        player?.pause()
        let p = AVPlayer(url: url)
        player = p; playingId = id; progress = 0
        timeObs = p.addPeriodicTimeObserver(forInterval: CMTime(seconds: 0.1, preferredTimescale: 600), queue: .main) { [weak self] t in
            guard let self, let d = p.currentItem?.duration.seconds, d > 0 else { return }
            self.progress = t.seconds / d
        }
        NotificationCenter.default.addObserver(forName: .AVPlayerItemDidPlayToEndTime, object: p.currentItem, queue: .main) { [weak self] _ in
            Task { @MainActor in self?.playingId = nil; self?.progress = 0 }
        }
        p.play()
    }
}

struct VoiceBubble: View {
    let message: Message
    @ObservedObject private var audio = AudioPlayback.shared
    private var playing: Bool { audio.playingId == message.id }
    var body: some View {
        HStack(spacing: 10) {
            Button {
                Task { if let u = await API.shared.mediaURL(message.voice_url) { audio.toggle(id: message.id, url: u) } }
            } label: {
                Image(systemName: playing ? "pause.fill" : "play.fill").font(.system(size: 16, weight: .semibold)).foregroundStyle(Mint.accentFg)
                    .frame(width: 38, height: 38).background(Mint.accent).clipShape(Circle())
            }
            .buttonStyle(.plain)
            VStack(alignment: .leading, spacing: 5) {
                // Полоса: 28 штрихов псевдо-волны, детерминированно от id.
                HStack(alignment: .center, spacing: 2) {
                    ForEach(0..<28, id: \.self) { i in
                        let h = 6 + CGFloat((message.id.utf8.reduce(0) { Int($0) &+ Int($1) } &* (i + 3)) % 14)
                        Capsule().fill(Mint.bubbleFg.opacity(playing && Double(i) / 28 <= audio.progress ? 1 : 0.5)).frame(width: 3, height: h)
                    }
                }
                Text(duration).font(Inter.regular(11)).foregroundStyle(Mint.bubbleFg.opacity(0.75))
            }
        }
        .frame(minWidth: 180)
    }
    private var duration: String {
        let s = message.voice_duration ?? 0
        return String(format: "%d:%02d", s / 60, s % 60)
    }
}

// MARK: - Видео-треугольник (воспроизведение)

struct VideoNoteBubble: View {
    let message: Message
    @State private var player: AVPlayer?
    @State private var playing = false
    private let size: CGFloat = 176
    var body: some View {
        let flip = message.video_flip == true
        ZStack {
            TriangleShape(flip: flip).fill(LinearGradient(colors: [Mint.accent, Color(hex: 0x8DBB5C), Mint.deepMint], startPoint: .topLeading, endPoint: .bottomTrailing))
                .frame(width: size, height: size)
                .shadow(color: .black.opacity(0.2), radius: 5.5, y: 5)
            ZStack {
                Color.black
                if let player { PlayerLayerView(player: player).scaleEffect(x: message.video_mirror == true ? -1 : 1) }
                if !playing {
                    Image(systemName: "play.fill").font(.system(size: 18)).foregroundStyle(Mint.accentFg).frame(width: 44, height: 44)
                        .background(.white.opacity(0.75)).clipShape(Circle()).offset(y: flip ? -40 : 40)
                }
            }
            .frame(width: size - 14, height: size - 14)
            .clipShape(TriangleShape(flip: flip))
            .offset(y: flip ? 3 : 4)
            Text(duration).font(Inter.regular(11)).foregroundStyle(.white)
                .padding(.horizontal, 8).frame(height: 18).background(Mint.deepMint.opacity(0.75)).clipShape(Capsule())
                .offset(y: flip ? -size / 2 + 16 : size / 2 - 16)
        }
        .frame(width: size, height: size)
        .onTapGesture { toggle() }
        .task {
            if let u = await API.shared.mediaURL(message.video_url) {
                let p = AVPlayer(url: u); p.isMuted = true; player = p
                NotificationCenter.default.addObserver(forName: .AVPlayerItemDidPlayToEndTime, object: p.currentItem, queue: .main) { _ in playing = false; p.seek(to: .zero) }
            }
        }
    }
    private func toggle() {
        guard let player else { return }
        if playing { player.pause(); playing = false; return }
        try? AVAudioSession.sharedInstance().setCategory(.playback); player.isMuted = false
        player.seek(to: .zero); player.play(); playing = true
    }
    private var duration: String { let s = message.video_duration ?? 0; return String(format: "%02d:%02d", s / 60, s % 60) }
}

/// Треугольник со скруглёнными углами, как GlassTriangle в вебе (d ≈ 9% стороны).
struct TriangleShape: Shape {
    var flip = false
    func path(in r: CGRect) -> Path {
        let w = r.width, h = r.height, d = min(w, h) * 0.09
        let T = CGPoint(x: r.minX + w / 2, y: flip ? r.maxY : r.minY)
        let R = CGPoint(x: r.maxX, y: flip ? r.minY : r.maxY)
        let L = CGPoint(x: r.minX, y: flip ? r.minY : r.maxY)
        func along(_ a: CGPoint, _ b: CGPoint) -> CGPoint {
            let dx = b.x - a.x, dy = b.y - a.y, len = hypot(dx, dy)
            return CGPoint(x: a.x + dx * d / len, y: a.y + dy * d / len)
        }
        var p = Path()
        p.move(to: along(T, R)); p.addLine(to: along(R, T)); p.addQuadCurve(to: along(R, L), control: R)
        p.addLine(to: along(L, R)); p.addQuadCurve(to: along(L, T), control: L)
        p.addLine(to: along(T, L)); p.addQuadCurve(to: along(T, R), control: T)
        p.closeSubpath()
        return p
    }
}

struct PlayerLayerView: UIViewRepresentable {
    let player: AVPlayer
    func makeUIView(context: Context) -> PlayerView { let v = PlayerView(); v.playerLayer.player = player; v.playerLayer.videoGravity = .resizeAspectFill; return v }
    func updateUIView(_ uiView: PlayerView, context: Context) { uiView.playerLayer.player = player }
    final class PlayerView: UIView {
        override static var layerClass: AnyClass { AVPlayerLayer.self }
        var playerLayer: AVPlayerLayer { layer as! AVPlayerLayer }
    }
}

// MARK: - Стикеры: картинка или .tgs (Lottie в gzip)

struct StickerView: View {
    let fileURL: String
    var size: CGFloat = 128
    @State private var url: URL?
    @State private var animation: LottieAnimation?
    var body: some View {
        Group {
            if let animation {
                LottieView(animation: animation).looping().frame(width: size, height: size)
            } else if let url, !isTgs {
                AsyncImage(url: url) { $0.resizable().scaledToFit() } placeholder: { ProgressView() }.frame(width: size, height: size)
            } else {
                Color.clear.frame(width: size, height: size)
            }
        }
        .task(id: fileURL) {
            url = await API.shared.mediaURL(fileURL)
            guard isTgs, let url else { return }
            if let (data, _) = try? await URLSession.shared.data(from: url), let json = gunzip(data) {
                animation = try? LottieAnimation.from(data: json)
            }
        }
    }
    private var isTgs: Bool { fileURL.lowercased().range(of: #"\.tgs(\?|$)"#, options: .regularExpression) != nil }
}

/// Распаковать gzip (zlib, windowBits 16+15).
func gunzip(_ data: Data) -> Data? {
    guard !data.isEmpty else { return nil }
    var stream = z_stream()
    var status = inflateInit2_(&stream, 16 + MAX_WBITS, ZLIB_VERSION, Int32(MemoryLayout<z_stream>.size))
    guard status == Z_OK else { return nil }
    defer { inflateEnd(&stream) }
    var out = Data()
    let chunk = 64 * 1024
    var buffer = [UInt8](repeating: 0, count: chunk)
    return data.withUnsafeBytes { (inPtr: UnsafeRawBufferPointer) -> Data? in
        stream.next_in = UnsafeMutablePointer(mutating: inPtr.bindMemory(to: Bytef.self).baseAddress)
        stream.avail_in = uInt(data.count)
        repeat {
            let produced: Int = buffer.withUnsafeMutableBufferPointer { bp in
                stream.next_out = bp.baseAddress
                stream.avail_out = uInt(chunk)
                status = inflate(&stream, Z_NO_FLUSH)
                return chunk - Int(stream.avail_out)
            }
            if status != Z_OK && status != Z_STREAM_END { return nil }
            out.append(buffer, count: produced)
        } while status != Z_STREAM_END
        return out
    }
}
