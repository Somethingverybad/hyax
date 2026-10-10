import SwiftUI
import PhotosUI

/// Чат: стеклянная шапка из таблеток, лента пузырей, панель ввода из макета.
/// Клавиатура — родная: панель лежит в safeAreaInset, лента прижата к низу.
struct ChatView: View {
    let chat: Chat
    var embedded = false
    @EnvironmentObject private var session: Session
    @Environment(\.dismiss) private var dismiss
    @StateObject private var model: ChatModel
    @State private var text = ""
    @State private var photo: PhotosPickerItem?
    @FocusState private var focused: Bool

    init(chat: Chat, embedded: Bool = false) {
        self.chat = chat; self.embedded = embedded
        _model = StateObject(wrappedValue: ChatModel(chatId: chat.id))
    }

    private var me: String { session.me?.id ?? "" }
    private var peer: Profile? { chat.kind == "saved" ? nil : chat.other(me: me) }

    var body: some View {
        ScrollView {
                LazyVStack(spacing: 6) {
                    Color.clear.frame(height: 16)
                    ForEach(Array(model.messages.enumerated()), id: \.element.id) { i, m in
                        if i == 0 || !Calendar.current.isDate(m.createdDate, inSameDayAs: model.messages[i - 1].createdDate) {
                            DateChip(date: m.createdDate)
                        }
                        let own = m.sender_id == me || m.sender?.id == me
                        let last = i == model.messages.count - 1 || (model.messages[i + 1].sender_id ?? model.messages[i + 1].sender?.id) != (m.sender_id ?? m.sender?.id)
                        Bubble(message: m, own: own, tail: last).id(m.id)
                    }
                    Color.clear.frame(height: 28) // зона растворения над панелью
                }
                .padding(.horizontal, 12)
        }
        // Якорь снизу: при росте ленты, открытии клавиатуры и новых сообщениях
        // низ остаётся прижатым — это делает сам ScrollView, без scrollTo.
        .defaultScrollAnchor(.bottom)
        .scrollDismissesKeyboard(.interactively)
        .scrollIndicators(.hidden)
        .background(Mint.pageGradient.ignoresSafeArea())
        .safeAreaInset(edge: .top, spacing: 0) { header }
        .safeAreaInset(edge: .bottom, spacing: 0) { compose }
        .toolbar(.hidden, for: .navigationBar)
        .task { await model.start() }
        .onDisappear { model.stop() }
        .onChange(of: photo) { _, item in if let item { Task { await sendPhoto(item) }; photo = nil } }
    }

    // MARK: шапка

    private var header: some View {
        ZStack {
            HStack(spacing: 8) {
                if !embedded { BackPill { dismiss() } }
                Spacer()
                Avatar(profile: peer, url: chat.avatar_url, name: chat.title(me: me), size: 43, radius: 21.5)
            }
            VStack(spacing: 1) {
                Text(chat.title(me: me)).font(Inter.semibold(15)).foregroundStyle(Mint.title).lineLimit(1)
                Text(subtitle).font(Inter.regular(12)).foregroundStyle(Mint.mintMuted)
            }
            .padding(.horizontal, 18).frame(height: 44).mintPill().frame(maxWidth: 230)
        }
        .padding(.horizontal, 17).padding(.top, 19).padding(.bottom, 11)
        .background(GlassTop().padding(.bottom, -22).ignoresSafeArea(edges: .top))
    }

    private var subtitle: String {
        if chat.kind == "saved" { return "Сообщения для себя" }
        if chat.is_group == true { return "\(chat.participants.count) участников" }
        if peer?.is_bot == true { return "бот" }
        return peer?.is_online == true ? "в сети" : "был(а) недавно"
    }

    // MARK: панель ввода (макет: [стикеры] [поле со скрепкой] [микрофон/отправить])

    private var compose: some View {
        HStack(alignment: .bottom, spacing: 8) {
            Button { Haptic.light() } label: {
                MintIcon("compose-left", 21, 23).foregroundStyle(Mint.ink).frame(width: 40, height: 40)
            }
            .mintPill().buttonStyle(.plain)
            HStack(spacing: 0) {
                TextField("Сообщение…", text: $text, axis: .vertical)
                    .font(Inter.regular(16)).foregroundStyle(Mint.foreground).lineLimit(1...5)
                    .focused($focused)
                    .padding(.leading, 16).padding(.vertical, 8)
                PhotosPicker(selection: $photo, matching: .images) {
                    MintIcon("attach", 18, 19).foregroundStyle(Mint.ink).frame(width: 55, height: 38)
                        .background(Mint.attachSegment).clipShape(RoundedRectangle(cornerRadius: 19, style: .continuous))
                }
                .padding(1)
            }
            .frame(minHeight: 40).mintPill()
            Button {
                if text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty { Haptic.light() } else { send() }
            } label: {
                Group {
                    if text.isEmpty { MintIcon("mic", 16, 23).foregroundStyle(Mint.ink) }
                    else { MintIcon("send", 10, 18).foregroundStyle(Mint.accentFg).offset(x: 1) }
                }
                .frame(width: 40, height: 40)
            }
            .buttonStyle(.plain)
            .background(text.isEmpty ? AnyView(Color.clear.mintPill()) : AnyView(Color.clear.mintLime()))
            .animation(.easeOut(duration: 0.15), value: text.isEmpty)
        }
        .padding(.horizontal, 16).padding(.top, 8).padding(.bottom, embedded ? 78 : 8)
        .background(
            LinearGradient(colors: [Mint.background.opacity(0), Mint.background.opacity(0.8), Mint.background], startPoint: .top, endPoint: .bottom)
                .padding(.top, -28).ignoresSafeArea(edges: .bottom)
        )
    }

    private func send() {
        let t = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !t.isEmpty else { return }
        text = ""
        Haptic.light()
        Task { await model.send(text: t, me: session.me) }
    }

    private func sendPhoto(_ item: PhotosPickerItem) async {
        guard let data = try? await item.loadTransferable(type: Data.self) else { return }
        await model.sendPhoto(data: data, me: session.me)
    }
}

/// Данные чата: первая страница, догрузка новых опросом, отправка.
@MainActor
final class ChatModel: ObservableObject {
    @Published var messages: [Message] = []
    private let chatId: String
    private var since: String?
    private var timer: Task<Void, Never>?

    init(chatId: String) { self.chatId = chatId }

    func start() async {
        if let r = try? await API.shared.sync(chat: chatId) {
            messages = r.messages.sorted { $0.createdDate < $1.createdDate }
            since = r.now
        }
        await API.shared.markRead(chat: chatId)
        timer?.cancel()
        timer = Task { [weak self] in
            while !Task.isCancelled {
                try? await Task.sleep(for: .seconds(3))
                await self?.pull()
            }
        }
    }

    func stop() { timer?.cancel() }

    private func pull() async {
        guard let since, let r = try? await API.shared.sync(chat: chatId, since: since) else { return }
        self.since = r.now
        if r.messages.isEmpty && r.deleted.isEmpty { return }
        merge(r.messages, deleted: r.deleted)
    }

    private func merge(_ incoming: [Message], deleted: [String]) {
        var byId = Dictionary(uniqueKeysWithValues: messages.filter { !deleted.contains($0.id) }.map { ($0.id, $0) })
        for m in incoming { byId[m.id] = m }
        messages = byId.values.sorted { $0.createdDate < $1.createdDate }
    }

    func send(text: String, me: Profile?) async {
        let tempId = "pending-\(UUID().uuidString)"
        let f = ISO8601DateFormatter(); f.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        messages.append(Message(id: tempId, content: text, sender_id: me?.id, sender: me, created_at: f.string(from: Date()), pending: true))
        do {
            let sent = try await API.shared.send(chat: chatId, content: text)
            messages.removeAll { $0.id == tempId }
            merge([sent], deleted: [])
        } catch {
            messages.removeAll { $0.id == tempId }
        }
    }

    func sendPhoto(data: Data, me: Profile?) async {
        do {
            let up = try await API.shared.upload(data: data, name: "photo.jpg", mime: "image/jpeg")
            let sent = try await API.shared.sendFile(chat: chatId, upload: up)
            merge([sent], deleted: [])
        } catch { }
    }
}

// MARK: - Пузыри

struct Bubble: View {
    let message: Message
    let own: Bool
    let tail: Bool
    @State private var imageURL: URL?

    var body: some View {
        HStack {
            if own { Spacer(minLength: 48) }
            Group {
                if message.isImage {
                    VStack(alignment: .trailing, spacing: 4) {
                        ZStack {
                            Mint.surface4.opacity(0.4)
                            if let imageURL {
                                AsyncImage(url: imageURL) { img in img.resizable().scaledToFill() } placeholder: { ProgressView().tint(.white) }
                            }
                        }
                        .frame(width: 220, height: imageHeight)
                        .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
                        .task { imageURL = await API.shared.mediaURL(message.file_url) }
                        if let c = message.content, !c.isEmpty {
                            Text(c).font(Inter.regular(15)).foregroundStyle(Mint.bubbleFg).frame(maxWidth: .infinity, alignment: .leading)
                        }
                        meta
                    }
                    .frame(width: 220)
                } else {
                    // Время — в конце последней строки, как в макете; пузырь по содержимому.
                    HStack(alignment: .bottom, spacing: 6) {
                        if message.sticker != nil {
                            Text(message.sticker?.emoji ?? "🙂").font(.system(size: 64))
                        } else if message.voice_url != nil {
                            Label("Голосовое", systemImage: "waveform").font(Inter.regular(15)).foregroundStyle(Mint.bubbleFg)
                        } else if message.video_url != nil {
                            Label("Видео-треугольник", systemImage: "triangle").font(Inter.regular(15)).foregroundStyle(Mint.bubbleFg)
                        } else {
                            Text(message.content ?? "").font(Inter.regular(15)).foregroundStyle(Mint.bubbleFg).textSelection(.enabled)
                        }
                        meta
                    }
                }
            }
            .padding(.horizontal, 12).padding(.vertical, 8)
            .background(Mint.bubble)
            .clipShape(BubbleShape(own: own, tail: tail))
            .overlay(alignment: own ? .bottomTrailing : .bottomLeading) {
                if tail { Tail(own: own).fill(Mint.bubble).frame(width: 9, height: 14).offset(x: own ? 8 : -8) }
            }
            .opacity(message.pending == true ? 0.7 : 1)
            if !own { Spacer(minLength: 48) }
        }
    }

    private var meta: some View {
        HStack(spacing: 4) {
            Text(time).font(Inter.regular(11)).foregroundStyle(Mint.bubbleFg.opacity(0.75))
            if own {
                Image(systemName: message.pending == true ? "clock" : "checkmark").font(.system(size: 10, weight: .semibold)).foregroundStyle(Mint.bubbleFg.opacity(0.75))
            }
        }
        .padding(.bottom, 1)
    }

    private var imageHeight: CGFloat {
        guard let w = message.file_width, let h = message.file_height, w > 0 else { return 180 }
        return min(300, max(90, 220 * CGFloat(h) / CGFloat(w)))
    }
    private var time: String {
        let f = DateFormatter(); f.dateFormat = "HH:mm"; return f.string(from: message.createdDate)
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
