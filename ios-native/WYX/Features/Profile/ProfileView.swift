import SwiftUI
import PhotosUI

/// Профиль по макету: обложка, аватар, имя, вайбометр, карточки настроек.
struct ProfileView: View {
    @EnvironmentObject private var session: Session
    @State private var vibe: VibeState?
    @State private var levels: VibeLevelsConfig?
    @State private var savedCount = 0
    @State private var toast: String?

    private var me: Profile? { session.me }
    private var appVersion: String {
        let v = Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String ?? "?"
        let b = Bundle.main.infoDictionary?["CFBundleVersion"] as? String ?? "?"
        return "WYX \(v) · сборка \(b)"
    }

    var body: some View {
        ScrollView {
            VStack(spacing: 11) {
                Color.clear.frame(height: 70)
                ZStack(alignment: .bottom) {
                    CoverImage(url: me?.cover_url).frame(height: 139).frame(maxWidth: .infinity).clipped()
                        .shadow(color: .black.opacity(0.25), radius: 6.6, x: 0, y: 4.3)
                    Avatar(profile: me, online: !(me?.hide_online ?? false), name: me?.username ?? "?", size: 93, radius: 17)
                        .overlay(RoundedRectangle(cornerRadius: 17, style: .continuous).stroke(.white, lineWidth: 2))
                        .shadow(color: .black.opacity(0.25), radius: 6.6, y: 4.3)
                        .offset(y: 47)
                }
                .padding(.bottom, 47)
                HStack(spacing: 6) {
                    Text(me?.username ?? "").font(Inter.semibold(17)).foregroundStyle(Mint.title)
                    Circle().fill(me?.hide_online == true ? Mint.mintMuted : Mint.online).frame(width: 8, height: 8)
                }
                if let bio = me?.bio, !bio.isEmpty { Text(bio).font(Inter.regular(13.3)).foregroundStyle(Mint.mintMuted).multilineTextAlignment(.center).padding(.horizontal, 30) }
                Button {
                    UIPasteboard.general.string = "https://huyax.e-tree.su/u/\(me?.username ?? "")"; Haptic.light(); toast = "Ссылка скопирована"
                } label: {
                    HStack(spacing: 8) { MintIcon("share", 15).foregroundStyle(.white); Text("Поделиться профилем").font(Inter.medium(14)).foregroundStyle(.white) }
                        .frame(height: 40).padding(.horizontal, 20).background(Mint.deepMint).clipShape(Capsule())
                }
                .buttonStyle(.plain)
                VibometerCard(vibe: vibe, levels: levels)
                    .padding(.horizontal, 17)

                card {
                    nav("row-at", "Никнейм", me?.username ?? "") { ProfileEditView() }
                    div; nav("row-about", "О себе", (me?.bio?.isEmpty == false) ? me!.bio! : "Не указано") { ProfileEditView() }
                    div; nav("row-tag", "Аура", me?.aura_text?.isEmpty == false ? me!.aura_text! : "по умолчанию") { AuraView() }
                    div; row("row-at", "Имя пользователя", "@" + (me?.username ?? ""))
                }
                card {
                    nav("row-saved", "Сохранёнки", "\(savedCount) фото", hint: "Видят: " + visibilityLabel) { SavedImagesView(count: $savedCount) }
                    div; nav("row-bell", "Уведомления", me?.notify_sound?.name ?? "Обычный звук") { NotificationsView() }
                    div; nav("row-sticker", "Стикерпаки", "", hint: "Свои наборы и импорт из Telegram") { StickerPacksView() }
                    div; nav("row-lock", "Конфиденциальность", "") { PrivacyView() }
                    div; nav("row-appearance", "Внешний вид", session.appearanceLabel) { AppearanceView() }
                }
                card {
                    nav("row-update", "Долгий ящик", "", hint: "Идеи и голосование") { IdeasView() }
                    div; nav("row-bug", "Сообщить о проблеме", "", hint: "Журнал уйдёт разработчику") { BugReportView() }
                    div; Button { clearCache() } label: { rowLabel("row-cache", "Очистить кэш", "", hint: "Если что-то отображается неправильно") }.buttonStyle(.plain)
                }
                card {
                    Button { session.logout() } label: {
                        HStack(spacing: 14) { MintIcon("row-logout", 19, 14).foregroundStyle(Mint.ink); Text("Выйти").font(Inter.medium(14.3)).foregroundStyle(Mint.ink); Spacer() }
                            .padding(.horizontal, 18).frame(height: 51)
                    }
                    .buttonStyle(.plain)
                    div; nav("close", "Удалить аккаунт", "", destructive: true) { DeleteAccountView() }
                }
                Text(appVersion).font(Inter.regular(12)).foregroundStyle(Mint.ink).padding(.top, 4)
                Color.clear.frame(height: 90)
            }
        }
        .scrollIndicators(.hidden)
        .overlay(alignment: .top) {
            MintHeader(title: "Профиль", right: {
                NavigationLink { ProfileEditView() } label: { MintIcon("pencil", 17, 18).foregroundStyle(Mint.accentFg).frame(width: 56, height: 33) }.buttonStyle(.plain).mintLime()
            })
            .background(GlassTop().padding(.bottom, -24).ignoresSafeArea(edges: .top))
        }
        .overlay(alignment: .top) {
            if let toast { Text(toast).font(Inter.regular(13)).foregroundStyle(Mint.label).padding(.horizontal, 16).frame(height: 40).mintPill().padding(.top, 70).task { try? await Task.sleep(for: .seconds(2)); self.toast = nil } }
        }
        .task {
            if let p = try? await API.shared.currentProfile() { session.me = p }
            if let id = me?.id { vibe = try? await API.shared.vibe(id) }
            levels = try? await API.shared.vibeLevels()
            savedCount = (try? await API.shared.savedImages())?.count ?? 0
        }
    }

    private var visibilityLabel: String {
        switch me?.saved_visibility { case "selected": return "избранные"; case "none": return "никто"; default: return "все" }
    }

    private func clearCache() {
        URLCache.shared.removeAllCachedResponses()
        let tmp = FileManager.default.temporaryDirectory
        (try? FileManager.default.contentsOfDirectory(at: tmp, includingPropertiesForKeys: nil))?.forEach { try? FileManager.default.removeItem(at: $0) }
        Haptic.light(); toast = "Кэш очищен"
    }

    // MARK: строки

    private var div: some View { Rectangle().fill(Mint.rowDivider).frame(height: 1).padding(.horizontal, 11) }
    private func card<V: View>(@ViewBuilder _ c: () -> V) -> some View { VStack(spacing: 0) { c() }.mintCard().padding(.horizontal, 17) }
    private func row(_ icon: String, _ label: String, _ value: String) -> some View { rowLabel(icon, label, value) }
    private func nav<D: View>(_ icon: String, _ label: String, _ value: String, hint: String? = nil, destructive: Bool = false, @ViewBuilder dest: () -> D) -> some View {
        NavigationLink { dest() } label: { rowLabel(icon, label, value, hint: hint, destructive: destructive) }.buttonStyle(.plain)
    }
    private func rowLabel(_ icon: String, _ label: String, _ value: String, hint: String? = nil, destructive: Bool = false) -> some View {
        HStack(spacing: 14) {
            MintIcon(icon, 18).foregroundStyle(destructive ? .red : Mint.ink)
            VStack(alignment: .leading, spacing: 2) {
                Text(label).font(Inter.regular(14.3)).foregroundStyle(destructive ? .red : Mint.label)
                if let hint { Text(hint).font(Inter.regular(11.7)).foregroundStyle(Mint.mintMuted) }
            }
            Spacer()
            if !value.isEmpty { Text(value).font(Inter.regular(12.7)).foregroundStyle(Mint.mintMuted).lineLimit(1) }
            MintIcon("chevron", 5, 10).foregroundStyle(Mint.mintMuted)
        }
        .padding(.horizontal, 18).frame(minHeight: 51).contentShape(Rectangle())
    }
}

struct CoverImage: View {
    var url: String?
    @State private var resolved: URL?
    var body: some View {
        ZStack {
            Mint.surface3
            if let resolved { AsyncImage(url: resolved) { $0.resizable().scaledToFill() } placeholder: { Color.clear } }
        }
        .task(id: url) { resolved = await API.shared.mediaURL(url) }
    }
}

/// Вайбометр: счётчик без потолка, полоса до bar_length, уровни бронза/серебро/золото.
struct VibometerCard: View {
    var vibe: VibeState?
    var levels: VibeLevelsConfig?
    var onRaise: (() -> Void)? = nil
    var body: some View {
        let v = vibe?.vibe ?? 0
        let barLen = max(1, levels?.bar_length ?? 10)
        let level = levels?.levels.filter { $0.min_vibe <= v }.max { $0.min_vibe < $1.min_vibe }
        let color = level.flatMap { Color(hexString: $0.color) } ?? Mint.accent
        VStack(alignment: .leading, spacing: 8) {
            HStack {
                Text("Вайбометр").font(Inter.semibold(14.3)).foregroundStyle(Mint.title)
                Spacer()
                if let level { Text(level.name).font(Inter.medium(12)).foregroundStyle(color) }
                Text("\(v)").font(Inter.bold(20)).foregroundStyle(Mint.title)
            }
            GeometryReader { g in
                ZStack(alignment: .leading) {
                    Capsule().fill(Mint.surface3)
                    Capsule().fill(color).frame(width: g.size.width * CGFloat(min(v, barLen)) / CGFloat(barLen))
                        .shadow(color: (level?.glow ?? false) || v > barLen ? color.opacity(0.8) : .clear, radius: 6)
                }
            }
            .frame(height: 10)
            if let onRaise, vibe?.can_vote == true {
                Button(action: onRaise) { Text(vibe?.voted == true ? "Вы уже подняли вайб" : "Поднять вайб +1").font(Inter.medium(13)).foregroundStyle(Mint.accentFg).frame(height: 33).padding(.horizontal, 13) }
                    .mintLime().disabled(vibe?.voted == true).opacity(vibe?.voted == true ? 0.6 : 1)
            }
        }
        .padding(14).mintCard()
    }
}

extension Color {
    init?(hexString: String) {
        var s = hexString.trimmingCharacters(in: .whitespaces); if s.hasPrefix("#") { s.removeFirst() }
        guard s.count == 6, let v = UInt32(s, radix: 16) else { return nil }
        self.init(hex: v)
    }
}

// MARK: - Подэкраны

/// Общий каркас подэкрана: шапка с «назад», карточки.
struct SubScreen<Content: View>: View {
    let title: String
    var right: AnyView? = nil
    @ViewBuilder let content: () -> Content
    @Environment(\.dismiss) private var dismiss
    var body: some View {
        ScrollView {
            VStack(spacing: 12) { Color.clear.frame(height: 76); content(); Color.clear.frame(height: 40) }.padding(.horizontal, 17)
        }
        .scrollDismissesKeyboard(.interactively)
        .background(Mint.pageGradient.ignoresSafeArea())
        .overlay(alignment: .top) {
            MintHeader(title: title, left: { BackPill { dismiss() } }, right: { right ?? AnyView(Color.clear.frame(width: 37)) })
                .background(GlassTop().padding(.bottom, -24).ignoresSafeArea(edges: .top))
        }
        .toolbar(.hidden, for: .navigationBar)
    }
}

struct SettingsToggle: View {
    let title: String
    var hint: String? = nil
    @Binding var on: Bool
    var body: some View {
        Toggle(isOn: $on) {
            VStack(alignment: .leading, spacing: 2) {
                Text(title).font(Inter.regular(14.3)).foregroundStyle(Mint.label)
                if let hint { Text(hint).font(Inter.regular(11.7)).foregroundStyle(Mint.mintMuted) }
            }
        }
        .tint(Mint.primary).padding(.horizontal, 18).frame(minHeight: 51)
    }
}

struct ProfileEditView: View {
    @EnvironmentObject private var session: Session
    @Environment(\.dismiss) private var dismiss
    @State private var username = ""
    @State private var bio = ""
    @State private var avatar: PhotosPickerItem?
    @State private var cover: PhotosPickerItem?
    @State private var busy = false
    @State private var error: String?
    var body: some View {
        SubScreen(title: "Редактировать", right: AnyView(Button { save() } label: { Text("Готово").font(Inter.regular(12.7)).foregroundStyle(Mint.accentFg).frame(height: 33).padding(.horizontal, 13) }.mintLime().disabled(busy))) {
            VStack(spacing: 0) {
                HStack(spacing: 14) {
                    Avatar(profile: session.me, name: session.me?.username ?? "?", size: 56, radius: 17)
                    PhotosPicker(selection: $avatar, matching: .images) { Text("Сменить аватар").font(Inter.regular(14.3)).foregroundStyle(Mint.ink) }
                    Spacer()
                }
                .padding(.horizontal, 18).frame(height: 72)
                Rectangle().fill(Mint.rowDivider).frame(height: 1).padding(.horizontal, 11)
                HStack(spacing: 14) {
                    CoverImage(url: session.me?.cover_url).frame(width: 84, height: 48).clipShape(RoundedRectangle(cornerRadius: 10, style: .continuous))
                    PhotosPicker(selection: $cover, matching: .images) { Text("Сменить обложку").font(Inter.regular(14.3)).foregroundStyle(Mint.ink) }
                    Spacer()
                    if session.me?.cover_url != nil { Button("Убрать") { Task { try? await API.shared.removeCover(); await reload() } }.font(Inter.regular(13)).foregroundStyle(.red) }
                }
                .padding(.horizontal, 18).frame(height: 72)
            }
            .mintCard()
            VStack(spacing: 0) {
                field("Никнейм", text: $username)
                Rectangle().fill(Mint.rowDivider).frame(height: 1).padding(.horizontal, 11)
                field("О себе", text: $bio)
            }
            .mintCard()
            if let error { Text(error).font(Inter.regular(13)).foregroundStyle(.red) }
        }
        .onAppear { username = session.me?.username ?? ""; bio = session.me?.bio ?? "" }
        .onChange(of: avatar) { _, i in if let i { Task { await upload(i, path: "avatar/upload/") }; avatar = nil } }
        .onChange(of: cover) { _, i in if let i { Task { await upload(i, path: "cover/upload/") }; cover = nil } }
    }
    private func field(_ title: String, text: Binding<String>) -> some View {
        HStack(spacing: 14) {
            Text(title).font(Inter.regular(14.3)).foregroundStyle(Mint.label).frame(width: 90, alignment: .leading)
            TextField(title, text: text).font(Inter.regular(14.3)).foregroundStyle(Mint.foreground).textInputAutocapitalization(.never)
        }
        .padding(.horizontal, 18).frame(height: 51)
    }
    private func upload(_ item: PhotosPickerItem, path: String) async {
        guard let data = try? await item.loadTransferable(type: Data.self), let img = UIImage(data: data), let jpg = img.jpegData(compressionQuality: 0.85) else { return }
        busy = true
        _ = try? await API.shared.upload(data: jpg, name: "image.jpg", mime: "image/jpeg", path: path)
        await reload(); busy = false
    }
    private func reload() async { if let p = try? await API.shared.currentProfile() { session.me = p } }
    private func save() {
        busy = true; error = nil
        Task {
            do { session.me = try await API.shared.updateProfile(fields: ["username": username.trimmingCharacters(in: .whitespaces), "bio": bio]); Haptic.medium(); dismiss() }
            catch { self.error = error.localizedDescription }
            busy = false
        }
    }
}

struct SavedImagesView: View {
    @Binding var count: Int
    @EnvironmentObject private var session: Session
    @State private var items: [SavedImage] = []
    @State private var viewer: ChatView.ViewerItem?
    @State private var mode = "all"
    @State private var viewers: [Profile] = []
    @State private var query = ""
    @State private var found: Profile?
    private let cols = Array(repeating: GridItem(.flexible(), spacing: 4), count: 3)
    var body: some View {
        SubScreen(title: "Сохранёнки") {
            VStack(spacing: 0) {
                ForEach([("all", "Все", "Видит любой, кто открыл профиль"), ("selected", "Избранные люди", "Только те, кого вы добавили"), ("none", "Никто", "Только вы")], id: \.0) { m in
                    Button { mode = m.0; Task { session.me = try? await API.shared.updateProfile(fields: ["saved_visibility": m.0]) } } label: {
                        HStack(spacing: 14) {
                            VStack(alignment: .leading, spacing: 2) { Text(m.1).font(Inter.regular(14.3)).foregroundStyle(Mint.label); Text(m.2).font(Inter.regular(11.7)).foregroundStyle(Mint.mintMuted) }
                            Spacer()
                            if mode == m.0 { MintIcon("checks", 16, 10).foregroundStyle(Mint.ink) }
                        }
                        .padding(.horizontal, 18).frame(minHeight: 51).contentShape(Rectangle())
                    }
                    .buttonStyle(.plain)
                    if m.0 != "none" { Rectangle().fill(Mint.rowDivider).frame(height: 1).padding(.horizontal, 11) }
                }
            }
            .mintCard()
            if mode == "selected" {
                VStack(spacing: 0) {
                    HStack(spacing: 10) {
                        MintIcon("search", 16).foregroundStyle(Mint.mintMuted)
                        TextField("Добавить по нику", text: $query).font(Inter.regular(14)).foregroundStyle(Mint.foreground).textInputAutocapitalization(.never).autocorrectionDisabled()
                            .onChange(of: query) { _, q in Task { found = q.count >= 2 ? try? await API.shared.profileByUsername(q) : nil } }
                    }
                    .padding(.horizontal, 18).frame(height: 48)
                    if let p = found, !viewers.contains(p) {
                        Button { Task { try? await API.shared.savedViewer(add: p.id); viewers = (try? await API.shared.savedViewers()) ?? viewers; query = ""; found = nil } } label: {
                            HStack(spacing: 12) { Avatar(profile: p, name: p.username, size: 32, radius: 10); Text("Добавить @\(p.username)").font(Inter.regular(14.3)).foregroundStyle(Mint.ink); Spacer() }.padding(.horizontal, 18).frame(height: 48)
                        }
                        .buttonStyle(.plain)
                    }
                    ForEach(viewers) { p in
                        Rectangle().fill(Mint.rowDivider).frame(height: 1).padding(.horizontal, 11)
                        HStack(spacing: 12) {
                            Avatar(profile: p, name: p.username, size: 32, radius: 10); Text(p.username).font(Inter.regular(14.3)).foregroundStyle(Mint.label); Spacer()
                            Button { Task { try? await API.shared.savedViewer(remove: p.id); viewers.removeAll { $0.id == p.id } } } label: { MintIcon("close", 12).foregroundStyle(Mint.mintMuted).frame(width: 30, height: 30) }.buttonStyle(.plain)
                        }
                        .padding(.horizontal, 18).frame(height: 48)
                    }
                }
                .mintCard()
            }
            if items.isEmpty {
                Text("Пока пусто. Откройте фото в чате, тапните по нему и выберите «Добавить в сохранёнки».").font(Inter.regular(13)).foregroundStyle(Mint.mintMuted).multilineTextAlignment(.center).padding(20)
            } else {
                LazyVGrid(columns: cols, spacing: 4) {
                    ForEach(items) { it in SavedTile(item: it) { viewer = ChatView.ViewerItem(url: $0) } }
                }
            }
        }
        .fullScreenCover(item: $viewer) { v in ImageViewer(url: v.url) { viewer = nil } }
        .task {
            mode = session.me?.saved_visibility ?? "all"
            items = (try? await API.shared.savedImages()) ?? []; count = items.count
            viewers = (try? await API.shared.savedViewers()) ?? []
        }
    }
}

struct SavedImage: Codable, Identifiable, Hashable { let id: String; var file_url: String; var file_name: String?; var created_at: String? }

struct SavedTile: View {
    let item: SavedImage
    let onOpen: (URL) -> Void
    @State private var url: URL?
    var body: some View {
        ZStack { Mint.surface4; if let url { AsyncImage(url: url) { $0.resizable().scaledToFill() } placeholder: { ProgressView() } } }
            .aspectRatio(117 / 130, contentMode: .fill).clipShape(RoundedRectangle(cornerRadius: 20, style: .continuous))
            .contentShape(Rectangle()).onTapGesture { if let url { onOpen(url) } }
            .task { url = await API.shared.mediaURL(item.file_url) }
    }
}

struct NotificationsView: View {
    @EnvironmentObject private var session: Session
    @State private var preview = true
    @State private var rov = true
    @State private var sounds: [SoundInfo] = []
    var body: some View {
        SubScreen(title: "Уведомления") {
            VStack(spacing: 0) {
                SettingsToggle(title: "Текст в уведомлении", hint: "Иначе — только «Новое сообщение»", on: $preview)
                    .onChange(of: preview) { _, v in Task { session.me = try? await API.shared.updateProfile(fields: ["push_preview": v]) } }
                Rectangle().fill(Mint.rowDivider).frame(height: 1).padding(.horizontal, 11)
                SettingsToggle(title: "Принимать Р.Ё.В", hint: "Вибрация, пока собеседник держит палец", on: $rov)
                    .onChange(of: rov) { _, v in Task { session.me = try? await API.shared.updateProfile(fields: ["rov_enabled": v]) } }
            }
            .mintCard()
            Text("Мой звук уведомлений").font(Inter.regular(12.7)).foregroundStyle(Mint.mintMuted).frame(maxWidth: .infinity, alignment: .leading).padding(.leading, 4)
            VStack(spacing: 0) {
                soundRow(nil)
                ForEach(sounds, id: \.id) { s in Rectangle().fill(Mint.rowDivider).frame(height: 1).padding(.horizontal, 11); soundRow(s) }
            }
            .mintCard()
        }
        .onAppear { preview = session.me?.push_preview ?? true; rov = session.me?.rov_enabled ?? true }
        .task { sounds = (try? await API.shared.sounds()) ?? [] }
    }
    private func soundRow(_ s: SoundInfo?) -> some View {
        let on = (session.me?.notify_sound?.id) == s?.id
        return Button {
            Task { session.me = try? await API.shared.updateProfile(fields: ["notify_sound_id": s?.id ?? NSNull()]) }
            if let u = s?.url { Task { if let url = await API.shared.mediaURL(u) { AudioPlayback.shared.toggle(id: "preview", url: url) } } }
        } label: {
            HStack(spacing: 14) {
                MintIcon("sound-play", 14).foregroundStyle(Mint.ink)
                Text(s?.name ?? "Обычный звук").font(Inter.regular(14.3)).foregroundStyle(Mint.label)
                Spacer()
                if on { MintIcon("checks", 16, 10).foregroundStyle(Mint.ink) }
            }
            .padding(.horizontal, 18).frame(height: 51).contentShape(Rectangle())
        }
        .buttonStyle(.plain)
    }
}

struct StickerPacksView: View {
    @State private var mine: [StickerPack] = []
    @State private var publicPacks: [StickerPack] = []
    @State private var link = ""
    @State private var busy = false
    @State private var toast: String?
    var body: some View {
        SubScreen(title: "Стикерпаки") {
            VStack(spacing: 10) {
                HStack(spacing: 10) {
                    TextField("Ссылка t.me/addstickers/…", text: $link).font(Inter.regular(14)).foregroundStyle(Mint.foreground).textInputAutocapitalization(.never).autocorrectionDisabled()
                        .padding(.horizontal, 16).frame(height: 40).mintPill()
                    Button { importTG() } label: { Text("Импорт").font(Inter.regular(12.7)).foregroundStyle(Mint.accentFg).frame(height: 33).padding(.horizontal, 13) }.mintLime().disabled(busy || link.isEmpty)
                }
                if let toast { Text(toast).font(Inter.regular(12.7)).foregroundStyle(Mint.mintMuted) }
            }
            .padding(14).mintCard()
            section("Мои наборы", mine, saved: true)
            section("Публичные", publicPacks.filter { p in !mine.contains { $0.id == p.id } }, saved: false)
        }
        .task { await load() }
    }
    private func section(_ title: String, _ packs: [StickerPack], saved: Bool) -> some View {
        Group {
            if !packs.isEmpty {
                Text(title).font(Inter.regular(12.7)).foregroundStyle(Mint.mintMuted).frame(maxWidth: .infinity, alignment: .leading).padding(.leading, 4)
                VStack(spacing: 0) {
                    ForEach(Array(packs.enumerated()), id: \.element.id) { i, p in
                        HStack(spacing: 12) {
                            if let pr = p.preview { StickerView(fileURL: pr, size: 40) } else { MintIcon("row-sticker", 22).foregroundStyle(Mint.ink).frame(width: 40) }
                            VStack(alignment: .leading, spacing: 2) { Text(p.name).font(Inter.regular(14.3)).foregroundStyle(Mint.label); Text("\(p.stickers_count ?? 0) стикеров").font(Inter.regular(11.7)).foregroundStyle(Mint.mintMuted) }
                            Spacer()
                            Button { Task { if saved { try? await API.shared.unsaveStickerPack(p.id) } else { try? await API.shared.saveStickerPack(p.id) }; await load() } } label: {
                                Text(saved ? "Убрать" : "Добавить").font(Inter.regular(12.7)).foregroundStyle(saved ? .red : Mint.accentFg).frame(height: 30).padding(.horizontal, 12)
                            }
                            .buttonStyle(.plain).background(saved ? AnyView(Color.clear.mintPill()) : AnyView(Color.clear.mintLime()))
                        }
                        .padding(.horizontal, 14).frame(height: 60)
                        if i < packs.count - 1 { Rectangle().fill(Mint.rowDivider).frame(height: 1).padding(.horizontal, 11) }
                    }
                }
                .mintCard()
            }
        }
    }
    private func load() async {
        mine = (try? await API.shared.myStickerPacks()) ?? []
        publicPacks = (try? await API.shared.publicStickerPacks()) ?? []
    }
    private func importTG() {
        busy = true
        Task {
            if let r = try? await API.shared.importTelegramStickers(url: link) { toast = "Импортировано: \(r.name), \(r.done)/\(r.total)"; link = ""; await load() } else { toast = "Не удалось импортировать" }
            busy = false
        }
    }
}

struct PrivacyView: View {
    @EnvironmentObject private var session: Session
    @State private var hideOnline = false
    @State private var adult = false
    @State private var blocked: [Profile] = []
    var body: some View {
        SubScreen(title: "Конфиденциальность") {
            VStack(spacing: 0) {
                SettingsToggle(title: "Скрывать статус «в сети»", hint: "Другие не увидят, когда вы онлайн", on: $hideOnline)
                    .onChange(of: hideOnline) { _, v in Task { session.me = try? await API.shared.updateProfile(fields: ["hide_online": v]) } }
                Rectangle().fill(Mint.rowDivider).frame(height: 1).padding(.horizontal, 11)
                SettingsToggle(title: "Контент 18+", hint: "Показывать стикеры и наборы 18+", on: $adult)
                    .onChange(of: adult) { _, v in Task { session.me = try? await API.shared.updateProfile(fields: ["allow_adult": v]) } }
            }
            .mintCard()
            Text("Заблокированные").font(Inter.regular(12.7)).foregroundStyle(Mint.mintMuted).frame(maxWidth: .infinity, alignment: .leading).padding(.leading, 4)
            VStack(spacing: 0) {
                if blocked.isEmpty { Text("Никого").font(Inter.regular(13.3)).foregroundStyle(Mint.mintMuted).frame(height: 51) }
                ForEach(Array(blocked.enumerated()), id: \.element.id) { i, p in
                    HStack(spacing: 12) {
                        Avatar(profile: p, name: p.username, size: 36, radius: 12); Text(p.username).font(Inter.regular(14.3)).foregroundStyle(Mint.label); Spacer()
                        Button { Task { try? await API.shared.unblock(p.id); blocked.removeAll { $0.id == p.id } } } label: { Text("Разблокировать").font(Inter.regular(12.7)).foregroundStyle(Mint.ink) }
                    }
                    .padding(.horizontal, 14).frame(height: 51)
                    if i < blocked.count - 1 { Rectangle().fill(Mint.rowDivider).frame(height: 1).padding(.horizontal, 11) }
                }
            }
            .mintCard()
        }
        .onAppear { hideOnline = session.me?.hide_online ?? false; adult = session.me?.allow_adult ?? false }
        .task { blocked = (try? await API.shared.blocks()) ?? [] }
    }
}

struct AppearanceView: View {
    @EnvironmentObject private var session: Session
    var body: some View {
        SubScreen(title: "Внешний вид") {
            VStack(spacing: 0) {
                ForEach([("system", "Как в системе"), ("light", "Мята"), ("dark", "Мята тёмная")], id: \.0) { t in
                    Button { session.appearance = t.0; Haptic.light() } label: {
                        HStack { Text(t.1).font(Inter.regular(14.3)).foregroundStyle(Mint.label); Spacer(); if session.appearance == t.0 { MintIcon("checks", 16, 10).foregroundStyle(Mint.ink) } }
                            .padding(.horizontal, 18).frame(height: 51).contentShape(Rectangle())
                    }
                    .buttonStyle(.plain)
                    if t.0 != "dark" { Rectangle().fill(Mint.rowDivider).frame(height: 1).padding(.horizontal, 11) }
                }
            }
            .mintCard()
            Text("Свои темы из веб-версии сюда не переносятся: в WYX одна тема — «Мята», светлая и тёмная.").font(Inter.regular(12.7)).foregroundStyle(Mint.mintMuted).padding(.horizontal, 4)
        }
    }
}

struct AuraView: View {
    @EnvironmentObject private var session: Session
    @State private var color = ""
    @State private var text = ""
    @State private var busy = false
    private let presets = ["", "#5DBB2E", "#C7F964", "#E9A100", "#D64545", "#7B61FF", "#2FB5D6", "#FF6BD6", "#FFFFFF"]
    var body: some View {
        SubScreen(title: "Аура", right: AnyView(Button { save() } label: { Text("Готово").font(Inter.regular(12.7)).foregroundStyle(Mint.accentFg).frame(height: 33).padding(.horizontal, 13) }.mintLime().disabled(busy))) {
            VStack(spacing: 14) {
                Avatar(profile: session.me, online: true, name: session.me?.username ?? "?", size: 93, radius: 17)
                Text("Цвет свечения").font(Inter.regular(12.7)).foregroundStyle(Mint.mintMuted)
                HStack(spacing: 10) {
                    ForEach(presets, id: \.self) { p in
                        Circle().fill(p.isEmpty ? Mint.online : (Color(hexString: p) ?? Mint.online)).frame(width: 30, height: 30)
                            .overlay(Circle().stroke(Mint.ink, lineWidth: color == p ? 3 : 0))
                            .onTapGesture { color = p; Haptic.light() }
                    }
                }
                TextField("Что означает ваша аура", text: $text).font(Inter.regular(14.3)).foregroundStyle(Mint.foreground).padding(.horizontal, 16).frame(height: 40).background(Mint.surface3).clipShape(Capsule())
            }
            .padding(16).mintCard()
        }
        .onAppear { color = session.me?.aura_color ?? ""; text = session.me?.aura_text ?? "" }
    }
    private func save() {
        busy = true
        Task { session.me = try? await API.shared.updateProfile(fields: ["aura_color": color, "aura_text": text]); busy = false; Haptic.medium() }
    }
}

struct IdeasView: View {
    @State private var sort = "top"
    @State private var page: IdeasPage?
    @State private var text = ""
    var body: some View {
        SubScreen(title: "Долгий ящик") {
            HStack(spacing: 8) {
                ForEach([("top", "Топ"), ("new", "Новые"), ("done", "Сделано"), ("mine", "Мои")], id: \.0) { t in
                    Button { sort = t.0; Task { await load() } } label: { Text(t.1).font(Inter.regular(12.7)).foregroundStyle(sort == t.0 ? Mint.accentFg : Mint.ink).frame(height: 33).padding(.horizontal, 13) }
                        .buttonStyle(.plain).background(sort == t.0 ? AnyView(Color.clear.mintLime()) : AnyView(Color.clear.mintPill()))
                }
                Spacer()
            }
            HStack(spacing: 8) {
                TextField("Ваша идея…", text: $text).font(Inter.regular(14)).foregroundStyle(Mint.foreground).padding(.horizontal, 16).frame(height: 40).mintPill()
                Button { let t = text.trimmingCharacters(in: .whitespaces); guard !t.isEmpty else { return }; text = ""; Task { _ = try? await API.shared.createIdea(t); await load() } } label: {
                    MintIcon("send", 10, 18).foregroundStyle(Mint.accentFg).offset(x: 1).frame(width: 40, height: 40)
                }
                .buttonStyle(.plain).mintLime()
            }
            if let p = page {
                Text("Голос: +\(p.points.vote) к вайбу, лайк автору: +\(p.points.like)").font(Inter.regular(11.7)).foregroundStyle(Mint.mintMuted)
                ForEach(p.items) { idea in
                    VStack(alignment: .leading, spacing: 8) {
                        Text(idea.text).font(Inter.regular(14.3)).foregroundStyle(Mint.label)
                        HStack(spacing: 8) {
                            vote(idea, 1, "hand.thumbsup", idea.likes); vote(idea, -1, "hand.thumbsdown", idea.dislikes)
                            Spacer()
                            if idea.status == "done" { Text("Реализовано").font(Inter.medium(12)).foregroundStyle(Mint.online) }
                            if p.is_admin && idea.status != "done" { Button("Реализовано") { Task { _ = try? await API.shared.ideaAction(idea.id, "done"); await load() } }.font(Inter.regular(12)).foregroundStyle(Mint.ink) }
                        }
                    }
                    .padding(14).frame(maxWidth: .infinity, alignment: .leading).mintCard()
                }
            }
        }
        .task { await load() }
    }
    private func vote(_ idea: IdeaItem, _ v: Int, _ icon: String, _ n: Int) -> some View {
        Button { Task { _ = try? await API.shared.ideaAction(idea.id, "vote", value: v); await load() } } label: {
            HStack(spacing: 4) { Image(systemName: icon).font(.system(size: 12)); Text("\(n)").font(Inter.medium(12)) }
                .foregroundStyle(idea.my_vote == v ? Mint.accentFg : Mint.ink).padding(.horizontal, 10).frame(height: 28)
        }
        .buttonStyle(.plain).background(idea.my_vote == v ? AnyView(Color.clear.mintLime()) : AnyView(Color.clear.mintPill()))
    }
    private func load() async { page = try? await API.shared.ideas(sort: sort) }
}

struct BugReportView: View {
    @Environment(\.dismiss) private var dismiss
    @State private var text = ""
    @State private var shot: PhotosPickerItem?
    @State private var shotData: Data?
    @State private var withLog = true
    @State private var busy = false
    @State private var result: String?
    var body: some View {
        SubScreen(title: "Сообщить о проблеме", right: AnyView(Button { send() } label: { Text("Отправить").font(Inter.regular(12.7)).foregroundStyle(Mint.accentFg).frame(height: 33).padding(.horizontal, 13) }.mintLime().disabled(busy || text.isEmpty))) {
            VStack(spacing: 10) {
                TextField("Что случилось?", text: $text, axis: .vertical).font(Inter.regular(14.3)).foregroundStyle(Mint.foreground).lineLimit(3...8).padding(12).background(Mint.surface3).clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
                PhotosPicker(selection: $shot, matching: .screenshots) { Text(shotData == nil ? "Приложить скриншот" : "Скриншот приложен").font(Inter.regular(14.3)).foregroundStyle(Mint.ink) }
                Toggle("Приложить журнал приложения", isOn: $withLog).font(Inter.regular(14.3)).foregroundStyle(Mint.label).tint(Mint.primary)
                if let result { Text(result).font(Inter.regular(13)).foregroundStyle(Mint.mintMuted) }
            }
            .padding(14).mintCard()
        }
        .onChange(of: shot) { _, i in if let i { Task { shotData = try? await i.loadTransferable(type: Data.self) } } }
    }
    private func send() {
        busy = true
        Task {
            do { try await API.shared.sendBugReport(text: text, screenshot: shotData, log: withLog ? AppLog.shared.dump() : nil); result = "Отправлено, спасибо"; Haptic.medium(); try? await Task.sleep(for: .seconds(1)); dismiss() }
            catch { result = error.localizedDescription }
            busy = false
        }
    }
}

struct DeleteAccountView: View {
    @EnvironmentObject private var session: Session
    @State private var password = ""
    @State private var error: String?
    @State private var busy = false
    var body: some View {
        SubScreen(title: "Удалить аккаунт") {
            VStack(spacing: 12) {
                Text("Это навсегда").font(Inter.medium(14.3)).foregroundStyle(.red)
                Text("Сообщения, чаты, сохранёнки и ключи секретных чатов будут удалены. Восстановить не получится.").font(Inter.regular(13.3)).foregroundStyle(Mint.mintMuted)
                SecureField("Пароль для подтверждения", text: $password).font(Inter.regular(14.3)).padding(.horizontal, 16).frame(height: 40).background(Mint.surface3).clipShape(Capsule())
                if let error { Text(error).font(Inter.regular(13)).foregroundStyle(.red) }
                Button {
                    busy = true
                    Task { do { try await API.shared.deleteAccount(password: password); session.logout() } catch { self.error = error.localizedDescription }; busy = false }
                } label: { Text("Удалить аккаунт").font(Inter.medium(15)).foregroundStyle(.white).frame(maxWidth: .infinity).frame(height: 44).background(.red).clipShape(Capsule()) }
                .disabled(busy || password.isEmpty).opacity(password.isEmpty ? 0.5 : 1)
            }
            .padding(16).mintCard()
        }
    }
}
