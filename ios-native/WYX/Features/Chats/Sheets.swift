import SwiftUI

/// Выбор чата для пересылки.
struct ForwardSheet: View {
    let me: String
    let onPick: (Chat) -> Void
    @Environment(\.dismiss) private var dismiss
    @State private var chats: [Chat] = []
    var body: some View {
        VStack(spacing: 0) {
            MintHeader(title: "Переслать", left: { Button("Отмена") { dismiss() }.font(Inter.regular(14)).foregroundStyle(Mint.ink) })
            ScrollView {
                VStack(spacing: 0) {
                    ForEach(Array(chats.enumerated()), id: \.element.id) { i, c in
                        ChatRow(chat: c, me: me, unread: 0, online: [:], onOpen: { onPick($0); dismiss() })
                        if i < chats.count - 1 { Rectangle().fill(Mint.rowDivider).frame(height: 1).padding(.leading, 87).padding(.trailing, 11) }
                    }
                }
                .mintCard().padding(17)
            }
        }
        .background(Mint.pageGradient.ignoresSafeArea())
        .task { chats = (try? await API.shared.chats()) ?? [] }
    }
}

/// Новый чат: по точному нику — личный; с именем и участниками — группа.
struct NewChatSheet: View {
    let onCreated: (Chat) -> Void
    @Environment(\.dismiss) private var dismiss
    @State private var group = false
    @State private var name = ""
    @State private var query = ""
    @State private var found: Profile?
    @State private var members: [Profile] = []
    @State private var error: String?
    @State private var busy = false

    var body: some View {
        VStack(spacing: 12) {
            MintHeader(title: group ? "Новая группа" : "Новый чат", left: { Button("Отмена") { dismiss() }.font(Inter.regular(14)).foregroundStyle(Mint.ink) },
                       right: { Button(action: create) { Text("Создать").font(Inter.regular(12.7)).foregroundStyle(Mint.accentFg).frame(height: 33).padding(.horizontal, 13) }.mintLime().disabled(!canCreate || busy).opacity(canCreate ? 1 : 0.5) })
            HStack(spacing: 8) {
                ForEach([("Личный", false), ("Группа", true)], id: \.1) { t in
                    Button { group = t.1 } label: { Text(t.0).font(Inter.regular(12.7)).foregroundStyle(group == t.1 ? Mint.accentFg : Mint.ink).frame(height: 33).padding(.horizontal, 13) }
                        .buttonStyle(.plain).background(group == t.1 ? AnyView(Color.clear.mintLime()) : AnyView(Color.clear.mintPill()))
                }
                Spacer()
            }
            .padding(.horizontal, 17)
            if group {
                TextField("Название группы", text: $name).font(Inter.regular(15)).foregroundStyle(Mint.foreground)
                    .padding(.horizontal, 16).frame(height: 40).mintPill().padding(.horizontal, 17)
            }
            HStack(spacing: 10) {
                MintIcon("search", 16).foregroundStyle(Mint.mintMuted)
                TextField("Точный ник", text: $query).font(Inter.regular(14)).foregroundStyle(Mint.foreground)
                    .textInputAutocapitalization(.never).autocorrectionDisabled()
                    .onSubmit { Task { await lookup() } }
                    .onChange(of: query) { _, q in Task { if q.count >= 2 { await lookup() } else { found = nil } } }
            }
            .padding(.horizontal, 16).frame(height: 40).mintPill().padding(.horizontal, 17)
            if let p = found {
                Button {
                    if group { if !members.contains(p) { members.append(p) }; query = ""; found = nil }
                    else { create() }
                } label: {
                    HStack(spacing: 12) {
                        Avatar(profile: p, name: p.username, size: 44, radius: 15)
                        Text(p.username).font(Inter.semibold(15)).foregroundStyle(Mint.title)
                        Spacer()
                        Image(systemName: group ? "plus.circle" : "arrow.right.circle").foregroundStyle(Mint.ink)
                    }
                    .padding(12)
                }
                .buttonStyle(.plain).mintCard().padding(.horizontal, 17)
            }
            if group && !members.isEmpty {
                VStack(spacing: 0) {
                    ForEach(members) { p in
                        HStack(spacing: 12) {
                            Avatar(profile: p, name: p.username, size: 36, radius: 12)
                            Text(p.username).font(Inter.regular(14.3)).foregroundStyle(Mint.label)
                            Spacer()
                            Button { members.removeAll { $0.id == p.id } } label: { MintIcon("close", 12).foregroundStyle(Mint.mintMuted).frame(width: 30, height: 30) }.buttonStyle(.plain)
                        }
                        .padding(.horizontal, 14).frame(height: 48)
                    }
                }
                .mintCard().padding(.horizontal, 17)
            }
            if let error { Text(error).font(Inter.regular(13)).foregroundStyle(.red).padding(.horizontal, 17) }
            Spacer()
        }
        .background(Mint.pageGradient.ignoresSafeArea())
    }

    private var canCreate: Bool { group ? (!name.isEmpty && !members.isEmpty) : found != nil }

    private func lookup() async {
        found = try? await API.shared.profileByUsername(query.trimmingCharacters(in: .whitespaces))
    }

    private func create() {
        busy = true; error = nil
        Task {
            do {
                let ids = group ? members.map(\.id) : [found!.id]
                let chat = try await API.shared.createChat(participants: ids, groupName: group ? name : nil)
                Haptic.medium()
                dismiss(); onCreated(chat)
            } catch { self.error = error.localizedDescription }
            busy = false
        }
    }
}

/// Карточка чата: собеседник или участники группы, добавление, выход.
struct ChatInfoSheet: View {
    let chat: Chat
    let me: String
    var onSecret: ((Chat) -> Void)? = nil
    @Environment(\.dismiss) private var dismiss
    @State private var participants: [Profile] = []
    @State private var query = ""
    @State private var found: Profile?
    @State private var toast: String?

    var body: some View {
        VStack(spacing: 12) {
            MintHeader(title: chat.isGroupLike ? "Группа" : "Профиль", left: { Button("Закрыть") { dismiss() }.font(Inter.regular(14)).foregroundStyle(Mint.ink) })
            ScrollView {
                VStack(spacing: 12) {
                    let other = chat.isGroupLike ? nil : chat.other(me: me)
                    Avatar(profile: other, online: other?.is_online ?? false, url: chat.avatar_url, name: chat.title(me: me), size: 93, radius: 17)
                    Text(chat.title(me: me)).font(Inter.semibold(17)).foregroundStyle(Mint.title)
                    if let bio = other?.bio, !bio.isEmpty { Text(bio).font(Inter.regular(14)).foregroundStyle(Mint.mintMuted).multilineTextAlignment(.center).padding(.horizontal, 24) }
                    if let other, !chat.isSecret, chat.kind != "saved", other.is_bot != true, let onSecret {
                        Button {
                            Task {
                                let (priv, pub) = Secret.newKeyPair()
                                if let c = try? await API.shared.createSecretChat(peer: other.id, pub: pub) {
                                    Secret.rememberPending(chatId: c.id, priv: priv, myPub: pub)
                                    Haptic.medium(); dismiss(); onSecret(c)
                                } else { toast = "Не удалось создать секретный чат" }
                            }
                        } label: {
                            HStack(spacing: 12) { Image(systemName: "lock.fill").foregroundStyle(Mint.online); Text("Секретный чат").font(Inter.medium(14.3)).foregroundStyle(Mint.label); Spacer() }
                                .padding(.horizontal, 18).frame(height: 51)
                        }
                        .buttonStyle(.plain).mintCard().padding(.horizontal, 17)
                    }
                    if chat.isGroupLike {
                        VStack(spacing: 0) {
                            ForEach(participants) { p in
                                HStack(spacing: 12) {
                                    Avatar(profile: p, online: p.is_online ?? false, name: p.username, size: 36, radius: 12)
                                    Text(p.username).font(Inter.regular(14.3)).foregroundStyle(Mint.label)
                                    Spacer()
                                    if p.id == chat.creator { Text("создатель").font(Inter.regular(11)).foregroundStyle(Mint.mintMuted) }
                                }
                                .padding(.horizontal, 14).frame(height: 48)
                            }
                        }
                        .mintCard().padding(.horizontal, 17)
                        HStack(spacing: 10) {
                            MintIcon("search", 16).foregroundStyle(Mint.mintMuted)
                            TextField("Добавить по нику", text: $query).font(Inter.regular(14)).foregroundStyle(Mint.foreground)
                                .textInputAutocapitalization(.never).autocorrectionDisabled()
                                .onChange(of: query) { _, q in Task { found = q.count >= 2 ? try? await API.shared.profileByUsername(q) : nil } }
                        }
                        .padding(.horizontal, 16).frame(height: 40).mintPill().padding(.horizontal, 17)
                        if let p = found, !participants.contains(p) {
                            Button {
                                Task { if (try? await API.shared.addParticipants(chat: chat.id, ids: [p.id])) != nil { participants.append(p); query = ""; found = nil; toast = "Добавлен" } }
                            } label: {
                                HStack(spacing: 12) { Avatar(profile: p, name: p.username, size: 36, radius: 12); Text("Добавить @\(p.username)").font(Inter.regular(14.3)).foregroundStyle(Mint.ink); Spacer() }.padding(14)
                            }
                            .buttonStyle(.plain).mintCard().padding(.horizontal, 17)
                        }
                        Button { Task { try? await API.shared.leaveChat(chat.id); dismiss() } } label: {
                            Text("Выйти из группы").font(Inter.medium(14.3)).foregroundStyle(.red).frame(maxWidth: .infinity).frame(height: 48)
                        }
                        .buttonStyle(.plain).mintCard().padding(.horizontal, 17)
                    }
                    if let toast { Text(toast).font(Inter.regular(13)).foregroundStyle(Mint.mintMuted) }
                }
                .padding(.vertical, 8)
            }
        }
        .background(Mint.pageGradient.ignoresSafeArea())
        .task { if chat.isGroupLike { participants = (try? await API.shared.participants(chat: chat.id)) ?? chat.participants } }
    }
}
