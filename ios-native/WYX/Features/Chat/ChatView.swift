import SwiftUI
import PhotosUI
import Combine
import UniformTypeIdentifiers

/// Чат: стеклянная шапка из таблеток, лента пузырей, панель ввода из макета.
/// Клавиатура — родная: панель лежит в safeAreaInset, лента прижата к низу.
struct ChatView: View {
    let chat: Chat
    var embedded = false
    @EnvironmentObject private var session: Session
    @Environment(\.dismiss) private var dismiss
    @StateObject private var model: ChatModel
    @StateObject private var recorder = VoiceRecorder()
    @State private var text = ""
    @State private var photo: PhotosPickerItem?
    @State private var focused = false
    @State private var selection = NSRange(location: 0, length: 0)
    @State private var fieldHeight: CGFloat = 40
    @State private var fmtOpen = false
    @State private var attachOpen = false
    @State private var mediaOpen = false
    @State private var fileOpen = false
    @State private var recorderOpen = false
    @State private var infoOpen = false
    @State private var forwarding: Message?
    @State private var participants: [Profile] = []
    @State private var replyTo: Message?
    @State private var editing: Message?
    @State private var menuFor: Message?
    @State private var viewer: ViewerItem?
    @State private var stickersOpen = false
    @State private var pinned: PinnedInfo?
    @State private var revealed: Set<String> = []
    @State private var toast: String?
    @State private var peerOnline: Bool?

    struct ViewerItem: Identifiable { let id = UUID(); let url: URL }

    init(chat: Chat, embedded: Bool = false) {
        self.chat = chat; self.embedded = embedded
        _model = StateObject(wrappedValue: ChatModel(chatId: chat.id, unread: chat.unread_count ?? 0))
        _pinned = State(initialValue: chat.pinned_message)
    }

    private var me: String { session.me?.id ?? "" }
    private var peer: Profile? { chat.kind == "saved" ? nil : chat.other(me: me) }

    var body: some View {
        ScrollViewReader { proxy in
            ScrollView {
                LazyVStack(spacing: 6) {
                    Color.clear.frame(height: 16)
                    if model.hasMore {
                        ProgressView().padding(8).onAppear { Task { await model.loadOlder() } }
                    }
                    ForEach(Array(model.messages.enumerated()), id: \.element.id) { i, m in
                        if i == 0 || !Calendar.current.isDate(m.createdDate, inSameDayAs: model.messages[i - 1].createdDate) {
                            DateChip(date: m.createdDate)
                        }
                        if m.id == model.unreadFirstId {
                            Text("Непрочитанные сообщения").font(Inter.regular(12)).foregroundStyle(Mint.mintMuted)
                                .frame(maxWidth: .infinity).padding(.vertical, 4).background(Mint.surface3.opacity(0.7)).id("unread")
                        }
                        MessageRow(message: m, own: m.senderId == me, first: i == 0 || model.messages[i - 1].senderId != m.senderId,
                                   last: i == model.messages.count - 1 || model.messages[i + 1].senderId != m.senderId,
                                   group: chat.isGroupLike, revealed: revealed.contains(m.id),
                                   onLongPress: { menuFor = m },
                                   onReveal: { revealed.insert(m.id) },
                                   onOpenImage: { viewer = ViewerItem(url: $0) },
                                   onReact: { e in Task { await model.react(m, emoji: e) } },
                                   onPress: { data in Task { toast = await model.press(m, data: data) } },
                                   onJump: { id in withAnimation { proxy.scrollTo(id, anchor: .center) } })
                            .id(m.id)
                    }
                    Color.clear.frame(height: 28) // зона растворения над панелью
                }
                .padding(.horizontal, 12)
            }
            .defaultScrollAnchor(.bottom)
            .scrollDismissesKeyboard(.interactively)
            .scrollIndicators(.hidden)
            .onChange(of: model.unreadFirstId) { _, id in if id != nil { DispatchQueue.main.asyncAfter(deadline: .now() + 0.1) { proxy.scrollTo("unread", anchor: .top) } } }
            .onChange(of: model.jumpTo) { _, id in if let id { withAnimation { proxy.scrollTo(id, anchor: .center) } } }
        }
        .background(Mint.pageGradient.ignoresSafeArea())
        .safeAreaInset(edge: .top, spacing: 0) { header }
        .safeAreaInset(edge: .bottom, spacing: 0) { composeArea }
        .overlay {
            if let m = menuFor {
                MessageMenu(message: m, own: m.senderId == me, pinned: pinned?.id == m.id,
                            onReact: { e in Task { await model.react(m, emoji: e) } },
                            onAction: { act(m, $0) }, onClose: { menuFor = nil })
                .transition(.opacity)
            }
        }
        .overlay(alignment: .top) {
            if let toast {
                Text(toast).font(Inter.regular(13)).foregroundStyle(Mint.label).padding(.horizontal, 16).frame(height: 40).mintPill()
                    .padding(.top, 70).transition(.move(edge: .top).combined(with: .opacity))
                    .task { try? await Task.sleep(for: .seconds(2.5)); self.toast = nil }
            }
        }
        .animation(.easeOut(duration: 0.2), value: toast)
        .animation(.easeOut(duration: 0.15), value: menuFor?.id)
        .fullScreenCover(item: $viewer) { v in ImageViewer(url: v.url) { viewer = nil } }
        .fullScreenCover(isPresented: $recorderOpen) {
            VideoNoteRecorderView(onDone: { url, secs, mirror, flip in
                recorderOpen = false
                let reply = replyTo; replyTo = nil
                Task { await model.sendVideoNote(fileURL: url, seconds: secs, mirror: mirror, flip: flip, replyTo: reply?.id) }
            }, onCancel: { recorderOpen = false })
        }
        .sheet(isPresented: $infoOpen) { ChatInfoSheet(chat: chat, me: me) }
        .sheet(item: $forwarding) { m in ForwardSheet(me: me) { c in Task { if (try? await API.shared.forward(message: m.id, to: c.id)) != nil { toast = "Переслано" } } } }
        .photosPicker(isPresented: $mediaOpen, selection: $photo, matching: .any(of: [.images, .videos]))
        .fileImporter(isPresented: $fileOpen, allowedContentTypes: [.item]) { r in
            if case .success(let url) = r { Task { await sendFile(url) } }
        }
        .overlay { if attachOpen { AttachMenu(onPick: { pick in
            switch pick {
            case .media: mediaOpen = true
            case .file: fileOpen = true
            case .location: Task { await sendLocation() }
            }
        }, onClose: { attachOpen = false }) } }
        .toolbar(.hidden, for: .navigationBar)
        .task { await model.start(); await session.refreshUnread(); if chat.isGroupLike { participants = (try? await API.shared.participants(chat: chat.id)) ?? chat.participants } }
        .onDisappear { model.stop() }
        .onChange(of: photo) { _, item in if let item { Task { await sendPhoto(item) }; photo = nil } }
        .onReceive(session.socket.events) { model.handle(event: $0, me: me) }
        .onChange(of: session.online) { _, o in if let p = peer, let v = o[p.id] { peerOnline = v } }
    }

    // MARK: шапка

    private var header: some View {
        VStack(spacing: 8) {
            ZStack {
                HStack(spacing: 8) {
                    if !embedded { BackPill { dismiss() } }
                    Spacer()
                    Button { Haptic.light(); infoOpen = true } label: {
                        Avatar(profile: peer, online: peerOnline ?? peer?.is_online ?? false, url: chat.avatar_url, name: chat.title(me: me), size: 43, radius: 21.5)
                    }
                    .buttonStyle(.plain)
                }
                VStack(spacing: 1) {
                    Text(chat.title(me: me)).font(Inter.semibold(15)).foregroundStyle(Mint.title).lineLimit(1)
                    Text(subtitle).font(Inter.regular(12)).foregroundStyle(Mint.mintMuted)
                }
                .padding(.horizontal, 18).frame(height: 44).mintPill().frame(maxWidth: 230)
            }
            if let pinned {
                Button { model.jumpTo = pinned.id; Haptic.light() } label: {
                    HStack(spacing: 12) {
                        VStack(spacing: 4) {
                            Capsule().fill(Mint.rowDivider).frame(width: 2, height: 7)
                            Capsule().fill(Mint.rowDivider).frame(width: 2, height: 7)
                            Capsule().fill(Mint.ink).frame(width: 2, height: 7)
                        }
                        VStack(alignment: .leading, spacing: 1) {
                            Text("Закреплённое сообщение").font(Inter.medium(14.3)).foregroundStyle(Mint.title)
                            Text(pinned.preview ?? "").font(Inter.regular(14.3)).foregroundStyle(Mint.mintMuted).lineLimit(1)
                        }
                        Spacer()
                        MintIcon("pinned-right", 24, 14).foregroundStyle(Mint.ink)
                    }
                    .padding(.horizontal, 16).padding(.vertical, 6)
                }
                .buttonStyle(.plain).mintCard()
            }
        }
        .padding(.horizontal, 17).padding(.top, 19).padding(.bottom, 11)
        .background(GlassTop().padding(.bottom, -24).ignoresSafeArea(edges: .top))
    }

    private var subtitle: String {
        if chat.kind == "saved" { return "Сообщения для себя" }
        if chat.isGroupLike { return "\(chat.participants.count) участников" }
        if peer?.is_bot == true { return "бот" }
        return (peerOnline ?? peer?.is_online ?? false) ? "в сети" : "был(а) недавно"
    }

    // MARK: панель ввода (макет: [стикеры] [поле со скрепкой] [микрофон/отправить])

    private var composeArea: some View {
        VStack(spacing: 6) {
            if let r = replyTo { panel(title: "Ответ · \(r.sender?.username ?? "")", text: r.preview) { replyTo = nil } }
            if let e = editing { panel(title: "Редактирование", text: e.preview) { editing = nil; text = "" } }
            if focused {
                HStack(spacing: 6) {
                    Button { Haptic.light(); fmtOpen.toggle() } label: {
                        Text("Aa").font(Inter.semibold(13)).foregroundStyle(fmtOpen ? Mint.accentFg : Mint.ink).frame(width: 36, height: 32)
                    }
                    .buttonStyle(.plain).background(fmtOpen ? AnyView(Color.clear.mintLime()) : AnyView(Color.clear.mintPill()))
                    if fmtOpen { FormatToolbar { applyFormat($0) } }
                    else if chat.isGroupLike, let q = mentionQuery(text, caret: selection.location) {
                        MentionHints(people: participants.filter { $0.id != me && (q.1.isEmpty || $0.username.lowercased().hasPrefix(q.1.lowercased())) }) { p in insertMention(p, range: q.0) }
                    }
                    Spacer(minLength: 0)
                }
            }
            compose
            if stickersOpen { StickerSheet { s in stickersOpen = false; Task { await model.sendSticker(s, replyTo: replyTo?.id, me: session.me) }; replyTo = nil } }
        }
        .padding(.horizontal, 16).padding(.top, 8).padding(.bottom, embedded ? 78 : 8)
        .background(
            LinearGradient(colors: [Mint.background.opacity(0), Mint.background.opacity(0.8), Mint.background], startPoint: .top, endPoint: .bottom)
                .padding(.top, -28).ignoresSafeArea(edges: .bottom)
        )
    }

    private func panel(title: String, text: String, close: @escaping () -> Void) -> some View {
        HStack(spacing: 10) {
            Capsule().fill(Mint.ink).frame(width: 2, height: 30)
            VStack(alignment: .leading, spacing: 1) {
                Text(title).font(Inter.medium(12)).foregroundStyle(Mint.ink)
                Text(text).font(Inter.regular(13)).foregroundStyle(Mint.mintMuted).lineLimit(1)
            }
            Spacer()
            Button { close() } label: { MintIcon("close", 12).foregroundStyle(Mint.mintMuted).frame(width: 30, height: 30) }.buttonStyle(.plain)
        }
        .padding(.horizontal, 12).frame(height: 44).mintCard(16)
    }

    private var compose: some View {
        HStack(alignment: .bottom, spacing: 8) {
            Button { Haptic.light(); stickersOpen.toggle(); if stickersOpen { focused = false } } label: {
                MintIcon("compose-left", 21, 23).foregroundStyle(Mint.ink).frame(width: 40, height: 40)
            }
            .mintPill().buttonStyle(.plain)
            if recorder.recording {
                HStack(spacing: 10) {
                    Circle().fill(.red).frame(width: 10, height: 10)
                    Text(String(format: "%d:%02d", recorder.seconds / 60, recorder.seconds % 60)).font(Inter.medium(15)).foregroundStyle(Mint.foreground).monospacedDigit()
                    Text("Отпустите, чтобы отправить").font(Inter.regular(13)).foregroundStyle(Mint.mintMuted)
                    Spacer()
                }
                .padding(.horizontal, 16).frame(height: 40).mintPill()
            } else {
                HStack(alignment: .bottom, spacing: 0) {
                    GrowingTextView(text: $text, selection: $selection, placeholder: "Сообщение…", focused: $focused) { fieldHeight = $0 }
                        .frame(height: fieldHeight)
                        .onChange(of: focused) { _, f in if f { stickersOpen = false } else { fmtOpen = false } }
                    Button { Haptic.light(); attachOpen.toggle() } label: {
                        MintIcon("attach", 18, 19).foregroundStyle(Mint.ink).frame(width: 55, height: 38)
                            .background(Mint.attachSegment).clipShape(RoundedRectangle(cornerRadius: 19, style: .continuous))
                    }
                    .buttonStyle(.plain).padding(1)
                }
                .frame(minHeight: 40).mintPill()
            }
            sendButton
        }
    }

    private var sendButton: some View {
        let hasText = !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
        return Group {
            if hasText {
                Button { send() } label: {
                    MintIcon("send", 10, 18).foregroundStyle(Mint.accentFg).offset(x: 1).frame(width: 40, height: 40)
                }
                .buttonStyle(.plain).mintLime()
            } else {
                MintIcon("mic", 16, 23).foregroundStyle(Mint.ink).frame(width: 40, height: 40).mintPill()
                    .scaleEffect(recorder.recording ? 1.15 : 1)
                    // Тап — видео-треугольник, удержание — голосовое (как в вебе).
                    .onTapGesture { Haptic.light(); focused = false; recorderOpen = true }
                    .onLongPressGesture(minimumDuration: 0.25, maximumDistance: 60, perform: {}, onPressingChanged: { pressing in
                        if pressing { Task { if await recorder.start() { Haptic.medium() } } }
                        else if recorder.recording { finishVoice() }
                    })
            }
        }
        .animation(.easeOut(duration: 0.15), value: hasText)
        .animation(.easeOut(duration: 0.15), value: recorder.recording)
    }

    // MARK: действия

    private func send() {
        let raw = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !raw.isEmpty else { return }
        let (clean, entities) = Markers.parse(raw)
        text = ""
        Haptic.light()
        if let e = editing {
            editing = nil
            Task { await model.edit(e, content: clean, entities: entities) }
        } else {
            let reply = replyTo; replyTo = nil
            Task { await model.send(text: clean, entities: entities, replyTo: reply?.id, me: session.me) }
        }
    }

    private func finishVoice() {
        guard let r = recorder.stop() else { Haptic.light(); return }
        Haptic.medium()
        let reply = replyTo; replyTo = nil
        Task { await model.sendVoice(fileURL: r.url, seconds: r.seconds, replyTo: reply?.id, me: session.me) }
    }

    private func applyFormat(_ type: String) {
        let (t, r) = ComposerFormat.toggle(text, selection: selection, type: type)
        text = t; selection = r
    }

    private func insertMention(_ p: Profile, range: NSRange) {
        let ns = text as NSString
        guard range.location + range.length <= ns.length else { return }
        text = ns.replacingCharacters(in: range, with: "@\(p.username) ")
        selection = NSRange(location: range.location + p.username.utf16.count + 2, length: 0)
    }

    private func sendFile(_ url: URL) async {
        let ok = url.startAccessingSecurityScopedResource(); defer { if ok { url.stopAccessingSecurityScopedResource() } }
        guard let data = try? Data(contentsOf: url) else { toast = "Не удалось прочитать файл"; return }
        let mime = UTType(filenameExtension: url.pathExtension)?.preferredMIMEType ?? "application/octet-stream"
        let reply = replyTo; replyTo = nil
        await model.sendFile(data: data, name: url.lastPathComponent, mime: mime, replyTo: reply?.id, me: session.me)
    }

    private func sendLocation() async {
        guard let c = await LocationOnce().get() else { toast = "Нет доступа к геопозиции"; return }
        let reply = replyTo; replyTo = nil
        await model.sendLocation(lat: c.latitude, lng: c.longitude, replyTo: reply?.id)
    }

    private func sendPhoto(_ item: PhotosPickerItem) async {
        guard let data = try? await item.loadTransferable(type: Data.self) else { return }
        let isVideo = item.supportedContentTypes.contains { $0.conforms(to: .movie) }
        let reply = replyTo; replyTo = nil
        await model.sendFile(data: data, name: isVideo ? "video.mp4" : "photo.jpg", mime: isVideo ? "video/mp4" : "image/jpeg", replyTo: reply?.id, me: session.me)
    }

    private func act(_ m: Message, _ a: MessageMenu.Action) {
        switch a {
        case .reply: replyTo = m; editing = nil; focused = true
        case .copy: UIPasteboard.general.string = m.content ?? ""; toast = "Скопировано"
        case .pin:
            Task {
                let on = pinned?.id != m.id
                if let p = try? await API.shared.pin(message: m.id, pin: on) { pinned = p } else if !on { pinned = nil }
                toast = on ? "Закреплено" : "Откреплено"
            }
        case .edit:
            editing = m; replyTo = nil
            text = Markers.restore(m.content ?? "", entities: m.entities ?? [])
            focused = true
        case .deleteMe: Task { await model.remove(m, scope: "me") }
        case .deleteAll: Task { await model.remove(m, scope: "all") }
        case .forward: forwarding = m
        }
    }
}

// MARK: - Строка сообщения

struct MessageRow: View {
    let message: Message
    let own: Bool
    let first: Bool
    let last: Bool
    let group: Bool
    let revealed: Bool
    let onLongPress: () -> Void
    let onReveal: () -> Void
    let onOpenImage: (URL) -> Void
    let onReact: (String) -> Void
    let onPress: (String) -> Void
    let onJump: (String) -> Void

    var body: some View {
        HStack(alignment: .bottom, spacing: 6) {
            if own { Spacer(minLength: 48) }
            if !own && group {
                if last { Avatar(profile: message.sender, name: message.sender?.username ?? "?", size: 32, radius: 10) } else { Color.clear.frame(width: 32, height: 1) }
            }
            VStack(alignment: own ? .trailing : .leading, spacing: 3) {
                if !own && group && first, let n = message.sender?.username {
                    Text(n).font(Inter.semibold(12)).foregroundStyle(Mint.ink).padding(.leading, 6)
                }
                if message.sticker != nil && (message.content ?? "").isEmpty {
                    StickerView(fileURL: message.sticker!.file_url, size: 140)
                } else {
                    Bubble(message: message, own: own, tail: last, revealed: revealed, onReveal: onReveal, onOpenImage: onOpenImage, onJump: onJump)
                }
                if let r = message.reactions, !r.isEmpty { ReactionChips(reactions: r, onTap: onReact) }
                if let rows = message.buttons, !rows.isEmpty {
                    VStack(spacing: 4) {
                        ForEach(Array(rows.enumerated()), id: \.offset) { _, row in
                            HStack(spacing: 4) {
                                ForEach(row, id: \.data) { b in
                                    Button { Haptic.light(); onPress(b.data) } label: {
                                        Text(b.text).font(Inter.medium(13)).foregroundStyle(Mint.ink).frame(maxWidth: .infinity).frame(height: 34)
                                    }
                                    .buttonStyle(.plain).mintPill()
                                }
                            }
                        }
                    }
                    .frame(maxWidth: 260)
                }
            }
            .onLongPressGesture(minimumDuration: 0.35) { onLongPress() }
            if !own { Spacer(minLength: 48) }
        }
    }
}

// MARK: - Пузырь

struct Bubble: View {
    let message: Message
    let own: Bool
    let tail: Bool
    let revealed: Bool
    let onReveal: () -> Void
    let onOpenImage: (URL) -> Void
    let onJump: (String) -> Void

    private var hasSpoiler: Bool { (message.entities ?? []).contains { $0.type == "spoiler" || $0.type == "scramble" } }
    private var wholePre: Bool {
        guard let e = message.entities, e.count == 1, e[0].type == "pre", let c = message.content else { return false }
        return e[0].offset == 0 && e[0].length >= c.utf16.count
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            if let f = message.forwarded_from ?? nil {
                Text("Переслано от \(f.username ?? message.forwarded_title ?? "")").font(Inter.medium(12)).foregroundStyle(Mint.bubbleFg.opacity(0.8))
            } else if let c = message.forwarded_chat {
                Text("Переслано из \(c.name ?? "")").font(Inter.medium(12)).foregroundStyle(Mint.bubbleFg.opacity(0.8))
            }
            if let r = message.reply_to {
                Button { onJump(r.id) } label: {
                    HStack(spacing: 8) {
                        Capsule().fill(Mint.accent).frame(width: 2, height: 30)
                        VStack(alignment: .leading, spacing: 1) {
                            Text(r.sender_username ?? "").font(Inter.medium(12)).foregroundStyle(Mint.accent)
                            Text(r.preview ?? "").font(Inter.regular(13)).foregroundStyle(Mint.bubbleFg.opacity(0.85)).lineLimit(1)
                        }
                    }
                    .padding(.vertical, 2)
                }
                .buttonStyle(.plain)
            }
            if let lat = message.geo_lat, let lng = message.geo_lng { GeoBubble(lat: lat, lng: lng) }
            else if message.isImage { ImageBubble(message: message, onOpen: onOpenImage) }
            else if message.isVideoFile && message.video_url == nil { VideoFileBubble(message: message) }
            else if message.voice_url != nil { VoiceBubble(message: message) }
            else if message.video_url != nil { VideoNoteBubble(message: message) }
            else if message.file_url != nil && !message.isImage { FileBubble(message: message) }
            if message.sticker != nil, let c = message.content, !c.isEmpty { StickerView(fileURL: message.sticker!.file_url, size: 96) }
            if wholePre {
                CodeCard(code: message.content ?? "")
            } else if let c = message.content, !c.isEmpty {
                HStack(alignment: .bottom, spacing: 6) {
                    Text(Formatting.attributed(c, entities: message.entities ?? [], mentions: message.mentions ?? [], revealed: revealed,
                                               seed: message.id.hashValue, textColor: Mint.bubbleFg, accent: Mint.accent))
                        .foregroundStyle(Mint.bubbleFg).tint(Mint.accent).textSelection(.enabled)
                        .onTapGesture { if hasSpoiler && !revealed { onReveal() } }
                    meta
                }
            } else {
                HStack { Spacer(minLength: 0); meta }
            }
        }
        .padding(.horizontal, 12).padding(.vertical, 8)
        .frame(maxWidth: 300, alignment: .leading)
        .background(Mint.bubble)
        .clipShape(BubbleShape(own: own, tail: tail))
        .overlay(alignment: own ? .bottomTrailing : .bottomLeading) {
            if tail { Tail(own: own).fill(Mint.bubble).frame(width: 9, height: 14).offset(x: own ? 8 : -8) }
        }
        .opacity(message.pending == true ? 0.7 : 1)
    }

    private var meta: some View {
        HStack(spacing: 4) {
            if message.is_edited == true { Text("изм.").font(Inter.regular(10)).foregroundStyle(Mint.bubbleFg.opacity(0.6)) }
            Text(time).font(Inter.regular(11)).foregroundStyle(Mint.bubbleFg.opacity(0.75))
            if own {
                let read = (message.read_by ?? []).contains { $0.id != message.senderId }
                Image(systemName: message.pending == true ? "clock" : (read ? "checkmark.circle.fill" : "checkmark"))
                    .font(.system(size: 10, weight: .semibold)).foregroundStyle(read ? Mint.accent : Mint.bubbleFg.opacity(0.75))
            }
        }
        .padding(.bottom, 1)
    }
    private var time: String { let f = DateFormatter(); f.dateFormat = "HH:mm"; return f.string(from: message.createdDate) }
}

/// Блок кода: шапка «copy», акцентная полоса, тёмное тело — как в вебе.
struct CodeCard: View {
    let code: String
    var body: some View {
        Button { UIPasteboard.general.string = code; Haptic.light() } label: {
            VStack(alignment: .leading, spacing: 0) {
                HStack { Text("copy").font(.system(size: 12, design: .monospaced)); Spacer(); Image(systemName: "doc.on.doc").font(.system(size: 12)).opacity(0.75) }
                    .foregroundStyle(Mint.bubbleFg).padding(.horizontal, 10).padding(.leading, 4).frame(height: 28).background(.white.opacity(0.18))
                Text(code).font(.system(size: 13, design: .monospaced)).foregroundStyle(Mint.bubbleFg)
                    .padding(.horizontal, 10).padding(.leading, 4).padding(.vertical, 8).frame(maxWidth: .infinity, alignment: .leading).background(.black.opacity(0.35))
            }
            .overlay(alignment: .leading) { Capsule().fill(Mint.accent).frame(width: 4) }
            .clipShape(RoundedRectangle(cornerRadius: 9, style: .continuous))
        }
        .buttonStyle(.plain)
    }
}

/// Скругление 16; у последнего в серии нижний угол со стороны хвоста — 4.
struct BubbleShape: Shape {
    let own: Bool; let tail: Bool
    func path(in r: CGRect) -> Path {
        let R: CGFloat = 16, s: CGFloat = tail ? 4 : 16
        let tl = R, tr = R, br = (tail && own) ? s : R, bl = (tail && !own) ? s : R
        var p = Path()
        p.move(to: CGPoint(x: r.minX + tl, y: r.minY))
        p.addLine(to: CGPoint(x: r.maxX - tr, y: r.minY))
        p.addArc(center: CGPoint(x: r.maxX - tr, y: r.minY + tr), radius: tr, startAngle: .degrees(-90), endAngle: .degrees(0), clockwise: false)
        p.addLine(to: CGPoint(x: r.maxX, y: r.maxY - br))
        p.addArc(center: CGPoint(x: r.maxX - br, y: r.maxY - br), radius: br, startAngle: .degrees(0), endAngle: .degrees(90), clockwise: false)
        p.addLine(to: CGPoint(x: r.minX + bl, y: r.maxY))
        p.addArc(center: CGPoint(x: r.minX + bl, y: r.maxY - bl), radius: bl, startAngle: .degrees(90), endAngle: .degrees(180), clockwise: false)
        p.addLine(to: CGPoint(x: r.minX, y: r.minY + tl))
        p.addArc(center: CGPoint(x: r.minX + tl, y: r.minY + tl), radius: tl, startAngle: .degrees(180), endAngle: .degrees(270), clockwise: false)
        p.closeSubpath()
        return p
    }
}

/// Хвостик пузыря — та же кривая, что в index.css (M0 0v14h9c-5-1.5-8-6-9-14z).
struct Tail: Shape {
    let own: Bool
    func path(in r: CGRect) -> Path {
        var p = Path()
        let w = r.width, h = r.height
        p.move(to: CGPoint(x: 0, y: 0)); p.addLine(to: CGPoint(x: 0, y: h)); p.addLine(to: CGPoint(x: w, y: h))
        p.addCurve(to: CGPoint(x: 0, y: 0), control1: CGPoint(x: w - 5 / 9 * w, y: h - 1.5 / 14 * h), control2: CGPoint(x: w - 8 / 9 * w, y: h - 6 / 14 * h))
        p.closeSubpath()
        return own ? p : p.applying(CGAffineTransform(scaleX: -1, y: 1).translatedBy(x: -w, y: 0))
    }
}

struct DateChip: View {
    let date: Date
    var body: some View {
        Text(label).font(Inter.regular(12)).foregroundStyle(.white)
            .padding(.horizontal, 10).frame(height: 24).background(Mint.bubble.opacity(0.55)).clipShape(Capsule())
            .padding(.vertical, 6)
    }
    private var label: String {
        if Calendar.current.isDateInToday(date) { return "Сегодня" }
        if Calendar.current.isDateInYesterday(date) { return "Вчера" }
        let f = DateFormatter(); f.locale = Locale(identifier: "ru_RU"); f.dateFormat = "d MMMM"; return f.string(from: date)
    }
}

// MARK: - Панель стикеров

struct StickerSheet: View {
    let onPick: (StickerItem) -> Void
    @State private var packs: [StickerPack] = []
    @State private var current: String?
    @State private var items: [StickerItem] = []
    private let cols = Array(repeating: GridItem(.flexible(), spacing: 6), count: 5)
    var body: some View {
        VStack(spacing: 8) {
            ScrollView {
                LazyVGrid(columns: cols, spacing: 6) {
                    ForEach(items) { s in
                        StickerView(fileURL: s.file_url, size: 60).frame(maxWidth: .infinity).contentShape(Rectangle())
                            .onTapGesture { Haptic.light(); onPick(s) }
                    }
                }
                .padding(8)
            }
            .frame(height: 230)
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 6) {
                    ForEach(packs) { p in
                        Button { current = p.id; Task { items = (try? await API.shared.stickers(pack: p.id)) ?? [] } } label: {
                            Text(p.name).font(Inter.regular(12)).foregroundStyle(current == p.id ? Mint.accentFg : Mint.ink)
                                .padding(.horizontal, 12).frame(height: 30)
                        }
                        .buttonStyle(.plain)
                        .background(current == p.id ? AnyView(Color.clear.mintLime()) : AnyView(Color.clear.mintPill()))
                    }
                }
                .padding(.horizontal, 8).padding(.bottom, 8)
            }
        }
        .background(Mint.surface3.opacity(0.6)).clipShape(RoundedRectangle(cornerRadius: 20, style: .continuous))
        .task {
            packs = (try? await API.shared.myStickerPacks()) ?? []
            if let first = packs.first { current = first.id; items = (try? await API.shared.stickers(pack: first.id)) ?? [] }
        }
    }
}

// MARK: - Данные чата

@MainActor
final class ChatModel: ObservableObject {
    @Published var messages: [Message] = []
    @Published var hasMore = false
    @Published var unreadFirstId: String?
    @Published var jumpTo: String?
    private let chatId: String
    private let unread: Int
    private var since: String?
    private var loadingOlder = false
    private var timer: Task<Void, Never>?

    init(chatId: String, unread: Int) { self.chatId = chatId; self.unread = unread }

    func start() async {
        if let r = try? await API.shared.sync(chat: chatId) {
            messages = r.messages.sorted { $0.createdDate < $1.createdDate }
            since = r.now
            hasMore = r.has_more ?? false
            // Разделитель — перед первым из последних `unread` чужих сообщений.
            if unread > 0 {
                let incoming = messages.filter { $0.senderId != nil }
                if incoming.count >= unread { unreadFirstId = incoming[incoming.count - unread].id }
            }
        }
        await API.shared.markRead(chat: chatId)
        timer?.cancel()
        // Опрос — страховка на случай, если сокет упал.
        timer = Task { [weak self] in
            while !Task.isCancelled { try? await Task.sleep(for: .seconds(15)); await self?.pull() }
        }
    }

    func stop() { timer?.cancel() }

    func loadOlder() async {
        guard hasMore, !loadingOlder, let first = messages.first else { return }
        loadingOlder = true
        if let r = try? await API.shared.sync(chat: chatId, before: first.created_at) {
            hasMore = r.has_more ?? false
            merge(r.messages, deleted: r.deleted)
        }
        loadingOlder = false
    }

    private func pull() async {
        guard let since, let r = try? await API.shared.sync(chat: chatId, since: since) else { return }
        self.since = r.now
        if r.messages.isEmpty && r.deleted.isEmpty { return }
        merge(r.messages, deleted: r.deleted)
    }

    func handle(event e: [String: Any], me: String) {
        let data = e["data"] as? [String: Any] ?? [:]
        let type = (data["type"] as? String) ?? (e["type"] as? String) ?? ""
        switch type {
        case "new_message":
            let m = (data["message"] as? [String: Any]) ?? (e["message"] as? [String: Any])
            let cid = data["chat_id"].map { String(describing: $0) } ?? (m?["chat"]).map { String(describing: $0) }
            guard cid == chatId else { return }
            if let m, let d = try? JSONSerialization.data(withJSONObject: m), let msg = try? JSONDecoder().decode(Message.self, from: d) {
                merge([msg], deleted: [])
                if msg.senderId != me { Task { await API.shared.markRead(chat: chatId) } }
            } else { Task { await pull() } }
        case "reaction":
            guard let mid = data["message_id"].map({ String(describing: $0) }) else { return }
            if let rs = data["reactions"], let d = try? JSONSerialization.data(withJSONObject: rs), let list = try? JSONDecoder().decode([Reaction].self, from: d),
               let i = messages.firstIndex(where: { $0.id == mid }) {
                messages[i].reactions = list
            } else { Task { await pull() } }
        case "read":
            guard data["chat_id"].map({ String(describing: $0) }) == chatId, let reader = data["reader_id"].map({ String(describing: $0) }), reader != me else { return }
            for i in messages.indices where messages[i].senderId == me && !(messages[i].read_by ?? []).contains(where: { $0.id == reader }) {
                messages[i].read_by = (messages[i].read_by ?? []) + [ReadBy(id: reader, username: nil, read_at: nil)]
            }
        default: break
        }
    }

    private func merge(_ incoming: [Message], deleted: [String]) {
        var byId: [String: Message] = [:]
        for m in messages where !deleted.contains(m.id) { byId[m.id] = m }
        for m in incoming { byId[m.id] = m }
        messages = byId.values.sorted { $0.createdDate < $1.createdDate }
    }

    func send(text: String, entities: [Entity], replyTo: String?, me: Profile?) async {
        let tempId = "pending-\(UUID().uuidString)"
        messages.append(Message(id: tempId, content: text, entities: entities, sender_id: me?.id, sender: me, created_at: ISO8601.string(Date()), pending: true))
        do {
            let sent = try await API.shared.send(chat: chatId, content: text, entities: entities, replyTo: replyTo)
            messages.removeAll { $0.id == tempId }
            merge([sent], deleted: [])
        } catch { messages.removeAll { $0.id == tempId } }
    }

    func sendFile(data: Data, name: String, mime: String, replyTo: String?, me: Profile?) async {
        do {
            let up = try await API.shared.upload(data: data, name: name, mime: mime)
            let sent = try await API.shared.sendFile(chat: chatId, upload: up, replyTo: replyTo)
            merge([sent], deleted: [])
        } catch { }
    }

    func sendVoice(fileURL: URL, seconds: Int, replyTo: String?, me: Profile?) async {
        do {
            let data = try Data(contentsOf: fileURL)
            let up = try await API.shared.upload(data: data, name: "voice.m4a", mime: "audio/mp4", path: "voice/upload/")
            let sent = try await API.shared.sendVoice(chat: chatId, url: up.file_url, seconds: seconds, replyTo: replyTo)
            merge([sent], deleted: [])
        } catch { }
        try? FileManager.default.removeItem(at: fileURL)
    }

    func sendVideoNote(fileURL: URL, seconds: Int, mirror: Bool, flip: Bool, replyTo: String?) async {
        do {
            let data = try Data(contentsOf: fileURL)
            let up = try await API.shared.upload(data: data, name: "round.mp4", mime: "video/mp4")
            let sent = try await API.shared.sendVideoNote(chat: chatId, url: up.file_url, seconds: seconds, mirror: mirror, flip: flip, replyTo: replyTo)
            merge([sent], deleted: [])
        } catch { }
        try? FileManager.default.removeItem(at: fileURL)
    }

    func sendLocation(lat: Double, lng: Double, replyTo: String?) async {
        if let sent = try? await API.shared.sendLocation(chat: chatId, lat: lat, lng: lng, replyTo: replyTo) { merge([sent], deleted: []) }
    }

    func sendSticker(_ s: StickerItem, replyTo: String?, me: Profile?) async {
        if let sent = try? await API.shared.sendSticker(chat: chatId, stickerId: s.id, replyTo: replyTo) { merge([sent], deleted: []) }
    }

    func edit(_ m: Message, content: String, entities: [Entity]) async {
        if let updated = try? await API.shared.edit(message: m.id, content: content, entities: entities) { merge([updated], deleted: []) }
    }

    func remove(_ m: Message, scope: String) async {
        if (try? await API.shared.remove(message: m.id, scope: scope)) != nil { messages.removeAll { $0.id == m.id } }
    }

    func react(_ m: Message, emoji: String) async {
        if let rs = try? await API.shared.react(message: m.id, emoji: emoji), let i = messages.firstIndex(where: { $0.id == m.id }) { messages[i].reactions = rs }
    }

    func press(_ m: Message, data: String) async -> String? {
        guard let r = try? await API.shared.press(message: m.id, data: data) else { return "Не удалось" }
        if r.open != nil { await pull() }
        return r.toast
    }
}
