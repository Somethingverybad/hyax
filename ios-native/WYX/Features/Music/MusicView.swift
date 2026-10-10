import SwiftUI
import AVFoundation
import MediaPlayer

struct Playlist: Codable, Identifiable, Hashable { let id: String; var name: String; var is_default: Bool?; var share_token: String?; var tracks_count: Int? }
struct PlaylistTrack: Codable, Identifiable, Hashable { let id: String; var file_url: String; var title: String; var artist: String?; var duration: Int?; var playlist_name: String? }

/// Плеер: очередь, следующий/предыдущий, перемешать, повтор; в шторке
/// управления и на экране блокировки — через MPNowPlayingInfoCenter.
@MainActor
final class Player: ObservableObject {
    static let shared = Player()
    @Published var queue: [PlaylistTrack] = []
    @Published var index = 0
    @Published var playing = false
    @Published var progress: Double = 0
    @Published var shuffle = false
    @Published var repeatMode = 0 // 0 выкл, 1 все, 2 один
    private var player: AVPlayer?
    private var obs: Any?
    var current: PlaylistTrack? { queue.indices.contains(index) ? queue[index] : nil }

    init() {
        let c = MPRemoteCommandCenter.shared()
        c.playCommand.addTarget { [weak self] _ in Task { @MainActor in self?.toggle() }; return .success }
        c.pauseCommand.addTarget { [weak self] _ in Task { @MainActor in self?.toggle() }; return .success }
        c.nextTrackCommand.addTarget { [weak self] _ in Task { @MainActor in await self?.next() }; return .success }
        c.previousTrackCommand.addTarget { [weak self] _ in Task { @MainActor in await self?.prev() }; return .success }
    }

    func play(_ list: [PlaylistTrack], at i: Int) async {
        queue = list; index = i
        await load()
    }

    private func load() async {
        guard let t = current, let url = await API.shared.mediaURL(t.file_url) else { return }
        try? AVAudioSession.sharedInstance().setCategory(.playback)
        try? AVAudioSession.sharedInstance().setActive(true)
        AudioPlayback.shared.playingId = nil
        player?.pause()
        let p = AVPlayer(url: url); player = p
        obs = p.addPeriodicTimeObserver(forInterval: CMTime(seconds: 0.5, preferredTimescale: 600), queue: .main) { [weak self] time in
            guard let self, let d = p.currentItem?.duration.seconds, d > 0 else { return }
            self.progress = time.seconds / d
            MPNowPlayingInfoCenter.default().nowPlayingInfo?[MPNowPlayingInfoPropertyElapsedPlaybackTime] = time.seconds
        }
        NotificationCenter.default.addObserver(forName: .AVPlayerItemDidPlayToEndTime, object: p.currentItem, queue: .main) { [weak self] _ in Task { @MainActor in await self?.next(auto: true) } }
        p.play(); playing = true
        MPNowPlayingInfoCenter.default().nowPlayingInfo = [MPMediaItemPropertyTitle: t.title, MPMediaItemPropertyArtist: t.artist ?? "WYX", MPMediaItemPropertyPlaybackDuration: Double(t.duration ?? 0)]
    }

    func toggle() {
        guard let player else { return }
        if playing { player.pause() } else { player.play() }
        playing.toggle()
    }

    func next(auto: Bool = false) async {
        guard !queue.isEmpty else { return }
        if auto && repeatMode == 2 { await player?.seek(to: .zero); player?.play(); return }
        if shuffle { index = Int.random(in: 0..<queue.count) }
        else if index + 1 < queue.count { index += 1 }
        else if repeatMode == 1 || !auto { index = 0 }
        else { playing = false; return }
        await load()
    }

    func prev() async {
        guard !queue.isEmpty else { return }
        if (player?.currentTime().seconds ?? 0) > 3 { await player?.seek(to: .zero); return }
        index = index > 0 ? index - 1 : queue.count - 1
        await load()
    }
}

/// Музыка: плейлисты, треки, плеер снизу, отправка трека в чат.
struct MusicView: View {
    @EnvironmentObject private var session: Session
    @ObservedObject private var player = Player.shared
    @State private var playlists: [Playlist] = []
    @State private var open: Playlist?
    @State private var tracks: [PlaylistTrack] = []
    @State private var newName = ""
    @State private var sending: PlaylistTrack?
    @State private var toast: String?

    var body: some View {
        let cur = player.current, isPlaying = player.playing
        return ScrollView {
            VStack(spacing: 12) {
                Color.clear.frame(height: 76)
                if let open {
                    HStack {
                        BackPill { self.open = nil }
                        Text(open.name).font(Inter.semibold(15)).foregroundStyle(Mint.title)
                        Spacer()
                        Button { Task { if let t = try? await API.shared.sharePlaylist(open.id) { UIPasteboard.general.string = "https://huyax.e-tree.su/playlist/\(t)"; toast = "Ссылка скопирована" } } } label: { MintIcon("share", 15).foregroundStyle(Mint.ink).frame(width: 37, height: 31) }.buttonStyle(.plain).mintPill()
                        if open.is_default != true { Button { Task { try? await API.shared.deletePlaylist(open.id); self.open = nil; await load() } } label: { MintIcon("close", 12).foregroundStyle(.red).frame(width: 37, height: 31) }.buttonStyle(.plain).mintPill() }
                    }
                    VStack(spacing: 0) {
                        if tracks.isEmpty { Text("Пусто. Добавляйте музыку из чатов: тап по аудио → «В плейлист».").font(Inter.regular(13)).foregroundStyle(Mint.mintMuted).multilineTextAlignment(.center).padding(20) }
                        ForEach(Array(tracks.enumerated()), id: \.element.id) { i, t in
                            HStack(spacing: 12) {
                                Button { Task { await player.play(tracks, at: i) } } label: {
                                    Image(systemName: cur?.id == t.id && isPlaying ? "pause.fill" : "play.fill").font(.system(size: 14, weight: .semibold)).foregroundStyle(Mint.accentFg).frame(width: 36, height: 36).background(Mint.accent).clipShape(Circle())
                                }
                                .buttonStyle(.plain)
                                VStack(alignment: .leading, spacing: 2) {
                                    Text(t.title).font(Inter.medium(14.3)).foregroundStyle(cur?.id == t.id ? Mint.ink : Mint.label).lineLimit(1)
                                    Text(t.artist ?? dur(t.duration)).font(Inter.regular(11.7)).foregroundStyle(Mint.mintMuted)
                                }
                                Spacer()
                                Menu {
                                    Button { sending = t } label: { Label("Отправить в чат", systemImage: "paperplane") }
                                    Button(role: .destructive) { Task { try? await API.shared.removeTrack(open.id, t.id); tracks.removeAll { $0.id == t.id } } } label: { Label("Убрать из плейлиста", systemImage: "trash") }
                                } label: { Image(systemName: "ellipsis").foregroundStyle(Mint.mintMuted).frame(width: 36, height: 36) }
                            }
                            .padding(.horizontal, 14).frame(height: 56)
                            if i < tracks.count - 1 { Rectangle().fill(Mint.rowDivider).frame(height: 1).padding(.horizontal, 11) }
                        }
                    }
                    .mintCard()
                } else {
                    HStack(spacing: 8) {
                        TextField("Новый плейлист", text: $newName).font(Inter.regular(14)).foregroundStyle(Mint.foreground).padding(.horizontal, 16).frame(height: 40).mintPill()
                        Button { let n = newName.trimmingCharacters(in: .whitespaces); guard !n.isEmpty else { return }; newName = ""; Task { _ = try? await API.shared.createPlaylist(n); await load() } } label: {
                            Image(systemName: "plus").font(.system(size: 16, weight: .semibold)).foregroundStyle(Mint.accentFg).frame(width: 40, height: 40)
                        }
                        .buttonStyle(.plain).mintLime()
                    }
                    VStack(spacing: 0) {
                        if playlists.isEmpty { Text("Плейлистов пока нет. Создайте первый или добавьте музыку из чата: долгое нажатие на аудио → «В плейлист».").font(Inter.regular(13)).foregroundStyle(Mint.mintMuted).multilineTextAlignment(.center).padding(20) }
                        ForEach(Array(playlists.enumerated()), id: \.element.id) { i, p in
                            Button { open = p; Task { tracks = (try? await API.shared.playlistTracks(p.id)) ?? [] } } label: {
                                HStack(spacing: 14) {
                                    MintIcon("nav-music", 22).foregroundStyle(Mint.ink).frame(width: 44, height: 44).background(Mint.surface3).clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
                                    VStack(alignment: .leading, spacing: 2) {
                                        Text(p.name).font(Inter.semibold(15)).foregroundStyle(Mint.title)
                                        Text("\(p.tracks_count ?? 0) треков" + (p.share_token != nil ? " · по ссылке" : "")).font(Inter.regular(12.3)).foregroundStyle(Mint.mintMuted)
                                    }
                                    Spacer()
                                    MintIcon("chevron", 5, 10).foregroundStyle(Mint.mintMuted)
                                }
                                .padding(.horizontal, 14).frame(height: 64).contentShape(Rectangle())
                            }
                            .buttonStyle(.plain)
                            if i < playlists.count - 1 { Rectangle().fill(Mint.rowDivider).frame(height: 1).padding(.leading, 72).padding(.trailing, 11) }
                        }
                    }
                    .mintCard()
                }
                Color.clear.frame(height: player.current == nil ? 90 : 170)
            }
            .padding(.horizontal, 17)
        }
        .scrollIndicators(.hidden)
        .overlay(alignment: .top) {
            MintHeader(title: "Музыка").background(GlassTop().padding(.bottom, -24).ignoresSafeArea(edges: .top))
        }
        .overlay(alignment: .bottom) {
            if let t = player.current {
                VStack(spacing: 6) {
                    HStack(spacing: 12) {
                        Button { Task { await player.prev() } } label: { Image(systemName: "backward.fill").foregroundStyle(Mint.ink) }
                        Button { player.toggle() } label: { Image(systemName: player.playing ? "pause.fill" : "play.fill").font(.system(size: 16, weight: .semibold)).foregroundStyle(Mint.accentFg).frame(width: 36, height: 36).background(Mint.accent).clipShape(Circle()) }
                        Button { Task { await player.next() } } label: { Image(systemName: "forward.fill").foregroundStyle(Mint.ink) }
                        VStack(alignment: .leading, spacing: 1) {
                            Text(t.title).font(Inter.medium(13.3)).foregroundStyle(Mint.label).lineLimit(1)
                            Text(t.artist ?? "").font(Inter.regular(11)).foregroundStyle(Mint.mintMuted).lineLimit(1)
                        }
                        Spacer()
                        Button { player.shuffle.toggle(); Haptic.light() } label: { Image(systemName: "shuffle").foregroundStyle(player.shuffle ? Mint.accentFg : Mint.mintMuted).frame(width: 30, height: 30).background(player.shuffle ? Mint.accent : .clear).clipShape(Circle()) }
                        Button { player.repeatMode = (player.repeatMode + 1) % 3; Haptic.light() } label: { Image(systemName: player.repeatMode == 2 ? "repeat.1" : "repeat").foregroundStyle(player.repeatMode > 0 ? Mint.accentFg : Mint.mintMuted).frame(width: 30, height: 30).background(player.repeatMode > 0 ? Mint.accent : .clear).clipShape(Circle()) }
                    }
                    .buttonStyle(.plain)
                    GeometryReader { g in ZStack(alignment: .leading) { Capsule().fill(Mint.surface3); Capsule().fill(Mint.accent).frame(width: g.size.width * player.progress) } }.frame(height: 4)
                }
                .padding(12).mintCard(16).padding(.horizontal, 17).padding(.bottom, 80)
            }
        }
        .overlay(alignment: .top) {
            if let toast { Text(toast).font(Inter.regular(13)).foregroundStyle(Mint.label).padding(.horizontal, 16).frame(height: 40).mintPill().padding(.top, 70).task { try? await Task.sleep(for: .seconds(2)); self.toast = nil } }
        }
        .sheet(item: $sending) { t in ForwardSheet(me: session.me?.id ?? "") { c in Task { try? await API.shared.sendTrack(chat: c.id, fileURL: t.file_url, title: t.title); toast = "Отправлено" } } }
        .task { await load() }
    }

    private func dur(_ s: Int?) -> String { let s = s ?? 0; return String(format: "%d:%02d", s / 60, s % 60) }
    private func load() async { playlists = (try? await API.shared.playlists()) ?? [] }
}
