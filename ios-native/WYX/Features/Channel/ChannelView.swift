import SwiftUI
import PhotosUI

struct Channel: Codable, Identifiable, Hashable {
    let id: String
    var name: String
    var username: String?
    var description: String?
    var avatar_url: String?
    var subscribers_count: Int?
    var sign_posts: Bool?
    var my_role: String?
    var creator: String?
    var muted: Bool?
    var canPost: Bool { my_role == "owner" || my_role == "admin" }
}

struct PostsResponse: Codable { var posts: [Message]; var deleted: [String]?; var has_more: Bool?; var now: String? }
struct PostComment: Codable, Identifiable, Hashable {
    let id: String
    var content: String?
    var created_at: String?
    var sender: Profile?
    var author: Profile?
    var parent: String?
    var who: String { sender?.username ?? author?.username ?? "" }
}

/// Канал: лента постов карточками, реакции, комментарии, просмотры;
/// владелец и админы пишут посты.
struct ChannelView: View {
    let chat: Chat
    @EnvironmentObject private var session: Session
    @Environment(\.dismiss) private var dismiss
    @State private var channel: Channel?
    @State private var posts: [Message] = []
    @State private var hasMore = false
    @State private var text = ""
    @State private var photo: PhotosPickerItem?
    @State private var comments: Message?
    @State private var viewer: URL?
    @State private var toast: String?
    @State private var viewed: Set<String> = []

    private var me: String { session.me?.id ?? "" }

    var body: some View {
        ScrollView {
            LazyVStack(spacing: 12) {
                Color.clear.frame(height: 8)
                if hasMore { ProgressView().onAppear { Task { await loadOlder() } } }
                ForEach(posts) { p in
                    PostCard(post: p, channel: channel, onReact: { e in Task { await react(p, e) } }, onComments: { comments = p },
                             onOpenImage: { viewer = $0 })
                        .onAppear { if !viewed.contains(p.id) { viewed.insert(p.id); Task { await API.shared.markPostView(p.id) } } }
                }
                Color.clear.frame(height: 28)
            }
            .padding(.horizontal, 12)
        }
        .defaultScrollAnchor(.bottom)
        .scrollDismissesKeyboard(.interactively)
        .scrollIndicators(.hidden)
        .background(Mint.pageGradient.ignoresSafeArea())
        .safeAreaInset(edge: .top, spacing: 0) { header }
        .safeAreaInset(edge: .bottom, spacing: 0) { bottom }
        .toolbar(.hidden, for: .navigationBar)
        .overlay(alignment: .top) {
            if let toast {
                Text(toast).font(Inter.regular(13)).foregroundStyle(Mint.label).padding(.horizontal, 16).frame(height: 40).mintPill().padding(.top, 70)
                    .task { try? await Task.sleep(for: .seconds(2.5)); self.toast = nil }
            }
        }
        .sheet(item: $comments) { p in CommentsSheet(post: p) }
        .fullScreenCover(item: Binding(get: { viewer.map { ChatView.ViewerItem(url: $0) } }, set: { viewer = $0?.url })) { v in ImageViewer(url: v.url) { viewer = nil } }
        .task { await load() }
        .onReceive(session.socket.events) { e in
            let d = e["data"] as? [String: Any] ?? [:]
            if ((d["type"] as? String) ?? (e["type"] as? String)) == "new_message", (d["chat_id"]).map({ String(describing: $0) }) == chat.id { Task { await pull() } }
        }
        .onChange(of: photo) { _, item in if let item { Task { await sendPhoto(item) }; photo = nil } }
    }

    private var header: some View {
        ZStack {
            HStack(spacing: 8) {
                BackPill { dismiss() }
                Spacer()
                Menu {
                    if channel?.my_role != nil {
                        Button { Task { await mute() } } label: { Label(channel?.muted == true ? "Включить уведомления" : "Выключить уведомления", systemImage: channel?.muted == true ? "bell" : "bell.slash") }
                        if channel?.my_role != "owner" { Button(role: .destructive) { Task { try? await API.shared.leaveChannel(chat.id); dismiss() } } label: { Label("Отписаться", systemImage: "rectangle.portrait.and.arrow.right") } }
                    }
                    if let u = channel?.username { Button { UIPasteboard.general.string = "@" + u; toast = "Скопировано" } label: { Label("Скопировать @\(u)", systemImage: "doc.on.doc") } }
                } label: {
                    Avatar(url: channel?.avatar_url ?? chat.avatar_url, name: channel?.name ?? chat.name ?? "К", size: 43, radius: 21.5)
                }
            }
            VStack(spacing: 1) {
                Text(channel?.name ?? chat.name ?? "Канал").font(Inter.semibold(15)).foregroundStyle(Mint.title).lineLimit(1)
                Text(subtitle).font(Inter.regular(12)).foregroundStyle(Mint.mintMuted)
            }
            .padding(.horizontal, 18).frame(height: 44).mintPill().frame(maxWidth: 230)
        }
        .padding(.horizontal, 17).padding(.top, 19).padding(.bottom, 11)
        .background(GlassTop().padding(.bottom, -24).ignoresSafeArea(edges: .top))
    }

    private var subtitle: String {
        let n = channel?.subscribers_count ?? 0
        let w = n % 10 == 1 && n % 100 != 11 ? "подписчик" : (2...4).contains(n % 10) && !(12...14).contains(n % 100) ? "подписчика" : "подписчиков"
        return "\(n) \(w)" + (channel?.username.map { " · @\($0)" } ?? "")
    }

    @ViewBuilder private var bottom: some View {
        if channel?.canPost == true {
            HStack(alignment: .bottom, spacing: 8) {
                HStack(spacing: 0) {
                    TextField("Новый пост…", text: $text, axis: .vertical).font(Inter.regular(16)).foregroundStyle(Mint.foreground).lineLimit(1...5)
                        .padding(.leading, 16).padding(.vertical, 8)
                    PhotosPicker(selection: $photo, matching: .any(of: [.images, .videos])) {
                        MintIcon("attach", 18, 19).foregroundStyle(Mint.ink).frame(width: 55, height: 38).background(Mint.attachSegment).clipShape(RoundedRectangle(cornerRadius: 19, style: .continuous))
                    }
                    .padding(1)
                }
                .frame(minHeight: 40).mintPill()
                Button { Task { await sendText() } } label: { MintIcon("send", 10, 18).foregroundStyle(Mint.accentFg).offset(x: 1).frame(width: 40, height: 40) }
                    .buttonStyle(.plain).mintLime().disabled(text.trimmingCharacters(in: .whitespaces).isEmpty)
            }
            .padding(.horizontal, 16).padding(.top, 8).padding(.bottom, 8)
            .background(LinearGradient(colors: [Mint.background.opacity(0), Mint.background.opacity(0.8), Mint.background], startPoint: .top, endPoint: .bottom).padding(.top, -28).ignoresSafeArea(edges: .bottom))
        } else if channel != nil && channel?.my_role == nil {
            Button { Task { await subscribe() } } label: {
                Text("Подписаться").font(Inter.medium(15)).foregroundStyle(Mint.accentFg).frame(maxWidth: .infinity).frame(height: 44)
            }
            .mintLime().padding(.horizontal, 17).padding(.vertical, 10)
            .background(LinearGradient(colors: [Mint.background.opacity(0), Mint.background], startPoint: .top, endPoint: .bottom).padding(.top, -28).ignoresSafeArea(edges: .bottom))
        } else {
            Color.clear.frame(height: 8)
        }
    }

    // MARK: данные

    private func load() async {
        channel = try? await API.shared.channel(chat.id)
        if let r = try? await API.shared.channelPosts(chat.id) {
            posts = r.posts.sorted { $0.createdDate < $1.createdDate }; hasMore = r.has_more ?? false
        }
    }
    private func loadOlder() async {
        guard hasMore, let first = posts.first, let r = try? await API.shared.channelPosts(chat.id, before: first.created_at) else { return }
        hasMore = r.has_more ?? false
        merge(r.posts)
    }
    private func pull() async {
        if let r = try? await API.shared.channelPosts(chat.id, limit: 10) { merge(r.posts) }
    }
    private func merge(_ incoming: [Message]) {
        var byId = Dictionary(posts.map { ($0.id, $0) }, uniquingKeysWith: { a, _ in a })
        for p in incoming { byId[p.id] = p }
        posts = byId.values.sorted { $0.createdDate < $1.createdDate }
    }
    private func react(_ p: Message, _ emoji: String) async {
        let mine = p.reactions?.first { $0.emoji == emoji }?.mine == true
        if mine { try? await API.shared.unreactPost(p.id) } else { try? await API.shared.reactPost(p.id, value: emoji) }
        await pull()
    }
    private func subscribe() async { try? await API.shared.subscribeChannel(chat.id); channel = try? await API.shared.channel(chat.id); session.chatsVersion += 1 }
    private func mute() async { try? await API.shared.muteChannel(chat.id, muted: !(channel?.muted ?? false)); channel = try? await API.shared.channel(chat.id) }
    private func sendText() async {
        let t = text.trimmingCharacters(in: .whitespacesAndNewlines); guard !t.isEmpty else { return }
        text = ""; Haptic.light()
        let (clean, ents) = Markers.parse(t)
        if let sent = try? await API.shared.send(chat: chat.id, content: clean, entities: ents) { merge([sent]) }
    }
    private func sendPhoto(_ item: PhotosPickerItem) async {
        guard let data = try? await item.loadTransferable(type: Data.self) else { return }
        let isVideo = item.supportedContentTypes.contains { $0.conforms(to: .movie) }
        if let up = try? await API.shared.upload(data: data, name: isVideo ? "video.mp4" : "photo.jpg", mime: isVideo ? "video/mp4" : "image/jpeg"),
           let sent = try? await API.shared.sendFile(chat: chat.id, upload: up) { merge([sent]) }
    }
}

/// Пост канала — карточка: шапка, текст, медиа, реакции, комментарии, просмотры.
struct PostCard: View {
    let post: Message
    let channel: Channel?
    let onReact: (String) -> Void
    let onComments: () -> Void
    let onOpenImage: (URL) -> Void
    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(spacing: 10) {
                Avatar(url: channel?.avatar_url, name: channel?.name ?? "К", size: 32, radius: 10)
                VStack(alignment: .leading, spacing: 1) {
                    Text(channel?.name ?? "Канал").font(Inter.semibold(13)).foregroundStyle(Mint.title)
                    Text(when).font(Inter.regular(11)).foregroundStyle(Mint.mintMuted)
                }
                Spacer()
                if channel?.sign_posts == true, let s = post.sender?.username { Text(s).font(Inter.regular(11)).foregroundStyle(Mint.mintMuted) }
            }
            if post.isImage { ImageBubble(message: post, onOpen: onOpenImage).frame(maxWidth: .infinity) }
            else if post.isVideoFile && post.video_url == nil { VideoFileBubble(message: post).frame(maxWidth: .infinity) }
            else if post.video_url != nil { VideoNoteBubble(message: post).frame(maxWidth: .infinity) }
            else if post.file_url != nil { FileBubble(message: post) }
            if let c = post.content, !c.isEmpty {
                Text(Formatting.attributed(c, entities: post.entities ?? [], mentions: [], revealed: true, seed: post.id.hashValue, textColor: Mint.label, accent: Mint.ink))
                    .foregroundStyle(Mint.label).tint(Mint.ink).textSelection(.enabled)
            }
            HStack(spacing: 6) {
                ForEach(["❤️", "🔥", "👍", "😂"], id: \.self) { e in
                    let r = post.reactions?.first { $0.emoji == e }
                    Button { Haptic.light(); onReact(e) } label: {
                        HStack(spacing: 3) { Text(e).font(.system(size: 13)); if let n = r?.count, n > 0 { Text("\(n)").font(Inter.medium(11)).foregroundStyle(r?.mine == true ? Mint.accentFg : Mint.ink) } }
                            .padding(.horizontal, 8).frame(height: 26).background(r?.mine == true ? Mint.accent : Mint.surface3).clipShape(Capsule())
                    }
                    .buttonStyle(.plain)
                }
                Spacer()
                Button { onComments() } label: {
                    HStack(spacing: 4) { Image(systemName: "bubble.left").font(.system(size: 12)); Text("\(post.comments_count ?? 0)").font(Inter.regular(12)) }.foregroundStyle(Mint.mintMuted)
                }
                .buttonStyle(.plain)
                HStack(spacing: 4) { Image(systemName: "eye").font(.system(size: 12)); Text("\(post.views_count ?? 0)").font(Inter.regular(12)) }.foregroundStyle(Mint.mintMuted)
            }
        }
        .padding(14).frame(maxWidth: .infinity, alignment: .leading).mintCard()
    }
    private var when: String {
        let f = DateFormatter(); f.locale = Locale(identifier: "ru_RU")
        f.dateFormat = Calendar.current.isDateInToday(post.createdDate) ? "HH:mm" : "d MMM, HH:mm"
        return f.string(from: post.createdDate)
    }
}

struct CommentsSheet: View {
    let post: Message
    @Environment(\.dismiss) private var dismiss
    @State private var items: [PostComment] = []
    @State private var text = ""
    var body: some View {
        VStack(spacing: 0) {
            MintHeader(title: "Комментарии", left: { Button("Закрыть") { dismiss() }.font(Inter.regular(14)).foregroundStyle(Mint.ink) })
            ScrollView {
                VStack(spacing: 0) {
                    if items.isEmpty { Text("Пока нет комментариев").font(Inter.regular(14)).foregroundStyle(Mint.mintMuted).padding(30) }
                    ForEach(items) { c in
                        HStack(alignment: .top, spacing: 10) {
                            Avatar(profile: c.sender ?? c.author, name: c.who, size: 32, radius: 10)
                            VStack(alignment: .leading, spacing: 2) {
                                Text(c.who).font(Inter.semibold(13)).foregroundStyle(Mint.title)
                                Text(c.content ?? "").font(Inter.regular(14)).foregroundStyle(Mint.label)
                            }
                            Spacer()
                        }
                        .padding(.horizontal, 14).padding(.vertical, 10)
                    }
                }
                .mintCard().padding(17)
            }
            HStack(spacing: 8) {
                TextField("Комментарий…", text: $text).font(Inter.regular(16)).foregroundStyle(Mint.foreground).padding(.horizontal, 16).frame(height: 40).mintPill()
                Button {
                    let t = text.trimmingCharacters(in: .whitespaces); guard !t.isEmpty else { return }
                    text = ""; Task { try? await API.shared.addComment(post.id, content: t); items = (try? await API.shared.postComments(post.id)) ?? items }
                } label: { MintIcon("send", 10, 18).foregroundStyle(Mint.accentFg).offset(x: 1).frame(width: 40, height: 40) }
                .buttonStyle(.plain).mintLime()
            }
            .padding(16)
        }
        .background(Mint.pageGradient.ignoresSafeArea())
        .task { items = (try? await API.shared.postComments(post.id)) ?? [] }
    }
}
