import SwiftUI
import AVKit

/// Приглашение в секретный чат (как SecretChatIntro): принять или отклонить,
/// либо ждём, пока примет собеседник.
struct SecretIntro: View {
    enum Mode { case accept, waiting, otherDevice }
    let mode: Mode
    let peerName: String
    var busy = false
    var onAccept: () -> Void = {}
    var onDecline: () -> Void = {}

    var body: some View {
        VStack(spacing: 14) {
            Image(systemName: "lock.shield").font(.system(size: 44)).foregroundStyle(Mint.ink)
            Text("Секретный чат").font(Inter.semibold(17)).foregroundStyle(Mint.title)
            Text(text).font(Inter.regular(14)).foregroundStyle(Mint.mintMuted).multilineTextAlignment(.center)
            if mode == .accept {
                Button(action: onAccept) {
                    Text("Принять").font(Inter.medium(15)).foregroundStyle(Mint.accentFg).frame(maxWidth: .infinity).frame(height: 44)
                }
                .mintLime().disabled(busy)
                Button(action: onDecline) { Text("Отклонить").font(Inter.regular(14)).foregroundStyle(.red) }.disabled(busy)
            }
        }
        .padding(24).frame(maxWidth: .infinity).mintCard().padding(.horizontal, 17)
    }

    private var text: String {
        switch mode {
        case .accept: return "\(peerName) предлагает секретный чат. Сообщения шифруются на устройствах, сервер их не читает. Ключ останется только на этом телефоне."
        case .waiting: return "Ждём, пока \(peerName) примет чат. Ключ создан на этом устройстве."
        case .otherDevice: return "Ключ этого чата хранится на другом вашем устройстве — здесь сообщения не прочитать."
        }
    }
}

/// Вложение секретного сообщения: качаем шифротекст, расшифровываем своим
/// ключом файла, показываем. Пока качается — миниатюра из сообщения.
struct SecretMediaView: View {
    let media: SecretMedia
    let fileURL: String?
    let onOpenImage: (URL) -> Void
    @State private var local: URL?
    @State private var image: UIImage?
    @State private var failed = false

    var body: some View {
        Group {
            switch media.k {
            case "image":
                ZStack {
                    if let image { Image(uiImage: image).resizable().scaledToFill() }
                    else if let th = media.th, let d = Data(base64Encoded: th), let ui = UIImage(data: d) { Image(uiImage: ui).resizable().scaledToFill().blur(radius: 6) }
                    else { Mint.surface4.opacity(0.35) }
                    if image == nil && !failed { ProgressView().tint(.white) }
                }
                .frame(width: 220, height: height).clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
                .contentShape(Rectangle())
                .onTapGesture { if let local { onOpenImage(local) } }
            case "voice", "audio":
                HStack(spacing: 10) {
                    Button { if let local { AudioPlayback.shared.toggle(id: local.absoluteString, url: local) } } label: {
                        Image(systemName: "play.fill").font(.system(size: 16, weight: .semibold)).foregroundStyle(Mint.accentFg).frame(width: 38, height: 38).background(Mint.accent).clipShape(Circle())
                    }
                    .buttonStyle(.plain).disabled(local == nil)
                    Text(local == nil ? "Расшифровка…" : (media.k == "voice" ? "Голосовое · \(dur)" : media.name)).font(Inter.regular(14)).foregroundStyle(Mint.bubbleFg)
                }
            case "round", "video":
                ZStack {
                    Color.black.opacity(0.6)
                    if let local {
                        VideoPlayer(player: AVPlayer(url: local))
                    } else { ProgressView().tint(.white) }
                }
                .frame(width: 220, height: 220).clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
            default:
                HStack(spacing: 10) {
                    Image(systemName: "doc.fill").font(.system(size: 22)).foregroundStyle(Mint.bubbleFg).frame(width: 40, height: 40).background(.white.opacity(0.15)).clipShape(Circle())
                    VStack(alignment: .leading, spacing: 2) {
                        Text(media.name).font(Inter.medium(14)).foregroundStyle(Mint.bubbleFg).lineLimit(1)
                        Text(local == nil ? "Расшифровка…" : ByteCountFormatter.string(fromByteCount: Int64(media.size), countStyle: .file)).font(Inter.regular(12)).foregroundStyle(Mint.bubbleFg.opacity(0.7))
                    }
                }
                .onTapGesture { if let local { UIApplication.shared.open(local) } }
            }
        }
        .task(id: fileURL) { await load() }
    }

    private var height: CGFloat {
        guard let w = media.w, let h = media.h, w > 0 else { return 180 }
        return min(300, max(90, 220 * CGFloat(h) / CGFloat(w)))
    }
    private var dur: String { let s = media.dur ?? 0; return String(format: "%d:%02d", s / 60, s % 60) }

    private func load() async {
        guard let fileURL, let url = await API.shared.mediaURL(fileURL) else { failed = true; return }
        guard let (data, _) = try? await URLSession.shared.data(from: url), let plain = Secret.decryptFile(data, media: media) else { failed = true; return }
        let ext = (media.name as NSString).pathExtension.isEmpty ? (media.k == "image" ? "jpg" : media.k == "round" || media.k == "video" ? "mp4" : "bin") : (media.name as NSString).pathExtension
        let tmp = FileManager.default.temporaryDirectory.appendingPathComponent("secret-\(fileURL.hashValue).\(ext)")
        try? plain.write(to: tmp)
        local = tmp
        if media.k == "image" { image = UIImage(data: plain) }
    }
}
