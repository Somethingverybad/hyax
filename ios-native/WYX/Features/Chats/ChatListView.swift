import SwiftUI

/// Список чатов по макету: шапка «Изм. / Чаты / +», поиск, фильтры,
/// карточка со строками; всё уходит под стеклянную шапку.
struct ChatListView: View {
    @EnvironmentObject private var session: Session
    let onOpen: (Chat) -> Void
    @State private var chats: [Chat] = []
    @State private var query = ""
    @State private var filter = 0
    @State private var loading = true

    private var shown: [Chat] {
        let me = session.me?.id ?? ""
        var list = chats
        if filter == 1 { list = list.filter { (session.unread[$0.id] ?? $0.unread_count ?? 0) > 0 } }
        if filter == 2 { list = list.filter { $0.kind == "channel" } }
        if !query.isEmpty { list = list.filter { $0.title(me: me).localizedCaseInsensitiveContains(query) } }
        return list
    }

    var body: some View {
        ScrollView {
            LazyVStack(spacing: 0) {
                Color.clear.frame(height: 150) // под шапку с поиском и фильтрами
                if loading && chats.isEmpty {
                    ProgressView().padding(.top, 40)
                } else if shown.isEmpty {
                    Text("Нет чатов").font(Inter.regular(14)).foregroundStyle(Mint.mintMuted).padding(.top, 40)
                } else {
                    VStack(spacing: 0) {
                        ForEach(Array(shown.enumerated()), id: \.element.id) { i, chat in
                            ChatRow(chat: chat, me: session.me?.id ?? "", unread: session.unread[chat.id] ?? chat.unread_count ?? 0,
                                    online: session.online, onOpen: onOpen)
                            if i < shown.count - 1 { Rectangle().fill(Mint.rowDivider).frame(height: 1).padding(.leading, 87).padding(.trailing, 11) }
                        }
                    }
                    .mintCard().padding(.horizontal, 17)
                }
                Color.clear.frame(height: 90) // под остров
            }
        }
        .scrollIndicators(.hidden)
        .overlay(alignment: .top) {
            VStack(spacing: 8) {
                MintHeader(title: "Чаты", left: {
                    Text("Изм.").font(Inter.regular(12.7)).foregroundStyle(Mint.ink).frame(height: 33).padding(.horizontal, 13).mintPill()
                }, right: {
                    Image(systemName: "plus").font(.system(size: 16, weight: .semibold)).foregroundStyle(Mint.accentFg).frame(width: 56, height: 33).mintLime()
                })
                HStack(spacing: 10) {
                    MintIcon("search", 16).foregroundStyle(Mint.mintMuted)
                    TextField("Поиск чатов", text: $query).font(Inter.regular(14)).foregroundStyle(Mint.foreground)
                }
                .padding(.horizontal, 16).frame(height: 40).mintPill().padding(.horizontal, 17)
                HStack(spacing: 8) {
                    ForEach(Array(["Все", "Непрочитанные", "Каналы"].enumerated()), id: \.offset) { i, t in
                        Button { filter = i; Haptic.light() } label: {
                            Text(t).font(Inter.regular(12.7)).foregroundStyle(filter == i ? Mint.accentFg : Mint.ink)
                                .frame(height: 33).padding(.horizontal, 13)
                        }
                        .buttonStyle(.plain)
                        .background(filter == i ? AnyView(Color.clear.mintLime()) : AnyView(Color.clear.mintPill()))
                    }
                    Spacer()
                }
                .padding(.horizontal, 17).padding(.bottom, 10)
            }
            .background(GlassTop().padding(.bottom, -24).ignoresSafeArea(edges: .top))
        }
        .task { await load() }
        .refreshable { await load() }
        .onChange(of: session.chatsVersion) { _, _ in Task { await load() } }
    }

    private func load() async {
        if let c = try? await API.shared.chats() {
            chats = c.sorted { ($0.updated_at ?? $0.last_message?.created_at ?? "") > ($1.updated_at ?? $1.last_message?.created_at ?? "") }
        }
        loading = false
    }
}

struct ChatRow: View {
    let chat: Chat
    let me: String
    let unread: Int
    let online: [String: Bool]
    let onOpen: (Chat) -> Void
    var body: some View {
        let other = chat.kind == "saved" ? nil : chat.other(me: me)
        let isOnline = other.flatMap { online[$0.id] ?? $0.is_online } ?? false
        Button { Haptic.light(); onOpen(chat) } label: {
            HStack(spacing: 12) {
                Avatar(profile: other, online: isOnline, url: chat.avatar_url, name: chat.title(me: me), size: 51, radius: 17)
                VStack(alignment: .leading, spacing: 3) {
                    HStack {
                        Text(chat.title(me: me)).font(Inter.semibold(15)).foregroundStyle(Mint.title).lineLimit(1)
                        Spacer()
                        Text(timeLabel).font(Inter.regular(12.3)).foregroundStyle(Mint.mintMuted)
                    }
                    HStack {
                        Text(chat.last_message?.content?.isEmpty == false ? chat.last_message!.content! : "Нет сообщений")
                            .font(Inter.regular(13.3)).foregroundStyle(Mint.mintMuted).lineLimit(1)
                        Spacer()
                        if unread > 0 {
                            Text("\(unread)").font(Inter.medium(11)).foregroundStyle(Mint.accentFg).padding(.horizontal, 7).frame(height: 20).background(Mint.accent).clipShape(Capsule())
                        }
                    }
                }
            }
            .padding(.horizontal, 12).padding(.vertical, 10)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
    }
    private var timeLabel: String {
        guard let s = chat.last_message?.created_at ?? chat.updated_at, let d = ISO8601.parse(s) else { return "" }
        let f = DateFormatter(); f.locale = Locale(identifier: "ru_RU")
        f.dateFormat = Calendar.current.isDateInToday(d) ? "HH:mm" : "d MMM"
        return f.string(from: d)
    }
}

/// Аватар: картинка с сервера или буква на мятной подложке; аура онлайна.
struct Avatar: View {
    var profile: Profile?
    var online: Bool = false
    var url: String?
    var name: String
    var size: CGFloat
    var radius: CGFloat
    @State private var resolved: URL?
    var body: some View {
        ZStack {
            RoundedRectangle(cornerRadius: radius, style: .continuous).fill(Mint.surface4)
            Text(String(name.prefix(1)).uppercased()).font(Inter.semibold(size * 0.42)).foregroundStyle(Mint.primary)
            if let resolved {
                AsyncImage(url: resolved) { img in img.resizable().scaledToFill() } placeholder: { Color.clear }
                    .frame(width: size, height: size).clipShape(RoundedRectangle(cornerRadius: radius, style: .continuous))
            }
        }
        .frame(width: size, height: size)
        .overlay {
            if online {
                RoundedRectangle(cornerRadius: radius + 3, style: .continuous).stroke(Mint.online.opacity(0.9), lineWidth: 2).padding(-3)
                    .shadow(color: Mint.online.opacity(0.7), radius: 6)
            }
        }
        .task(id: url ?? profile?.avatar_url) { resolved = await API.shared.mediaURL(url ?? profile?.avatar_url) }
    }
}

/// «Избранное» — сразу чат с собой, остров остаётся снизу.
struct SavedView: View {
    let onOpen: (Chat) -> Void
    @State private var chat: Chat?
    var body: some View {
        Group {
            if let chat { ChatView(chat: chat, embedded: true) } else { ProgressView().frame(maxWidth: .infinity, maxHeight: .infinity) }
        }
        .task { chat = try? await API.shared.savedChat() }
    }
}
