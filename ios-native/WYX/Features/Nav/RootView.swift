import SwiftUI

enum Tab: Int, CaseIterable {
    case music, saved, chats, profile
    var icon: String {
        switch self { case .music: return "nav-music"; case .saved: return "nav-saved"; case .chats: return "nav-chat"; case .profile: return "nav-profile" }
    }
    var label: String {
        switch self { case .music: return "Музыка"; case .saved: return "Избранное"; case .chats: return "Чаты"; case .profile: return "Профиль" }
    }
}

/// Корень: вкладки под островом навигации; чат открывается поверх.
struct RootView: View {
    @EnvironmentObject private var session: Session
    // Для автоматических прогонов: SIMCTL_CHILD_WYX_TAB=profile|saved|music.
    @State private var tab: Tab = ["profile": Tab.profile, "saved": .saved, "music": .music][ProcessInfo.processInfo.environment["WYX_TAB"] ?? ""] ?? .chats
    @State private var path = NavigationPath()

    var body: some View {
        NavigationStack(path: $path) {
            ZStack(alignment: .bottom) {
                Mint.pageGradient.ignoresSafeArea()
                Group {
                    switch tab {
                    case .chats: ChatListView(onOpen: { path.append($0) })
                    case .saved: SavedView(onOpen: { path.append($0) })
                    case .music: MusicView()
                    case .profile: ProfileView()
                    }
                }
                MintIsland(selected: $tab)
            }
            .navigationDestination(for: Chat.self) { chat in
                if chat.kind == "channel" { ChannelView(chat: chat) } else { ChatView(chat: chat) }
            }
            .toolbar(.hidden, for: .navigationBar)
        }
        .onChange(of: session.openChat) { _, c in if let c { path.append(c) } }
        .tint(Mint.ink)
    }
}

/// Остров навигации: стекло-градиент, подсветка переплывает к выбранной вкладке.
struct MintIsland: View {
    @Binding var selected: Tab
    @Environment(\.colorScheme) private var scheme
    private let height: CGFloat = 54

    var body: some View {
        GeometryReader { geo in
            let width = min(295, geo.size.width - 64)
            let cell = (width - 8) / CGFloat(Tab.allCases.count)
            HStack(spacing: 0) {
                ForEach(Tab.allCases, id: \.rawValue) { t in
                    Button {
                        if selected != t { Haptic.light(); withAnimation(.timingCurve(0.32, 0.72, 0, 1, duration: 0.32)) { selected = t } }
                    } label: {
                        MintIcon(t.icon, 24).foregroundStyle(Mint.ink).frame(width: cell, height: 46)
                    }
                    .buttonStyle(.plain).accessibilityLabel(t.label)
                }
            }
            .padding(4)
            .background(alignment: .leading) {
                RoundedRectangle(cornerRadius: 20, style: .continuous).fill(Mint.navOn)
                    .frame(width: 63, height: 46)
                    .offset(x: 4 + cell * CGFloat(selected.rawValue) + (cell - 63) / 2, y: 0)
            }
            .frame(width: width, height: height)
            .background(islandBackground)
            .clipShape(RoundedRectangle(cornerRadius: 20, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: 20, style: .continuous).stroke(scheme == .dark ? Mint.accent.opacity(0.3) : .clear, lineWidth: 1))
            .shadow(color: .black.opacity(scheme == .dark ? 0.35 : 0.2), radius: 5.5, x: 0, y: 5)
            .frame(maxWidth: .infinity)
        }
        .frame(height: height)
        .padding(.bottom, 8)
    }

    private var islandBackground: some View {
        Group {
            if scheme == .dark {
                LinearGradient(colors: [Mint.background, Color(hex: 0x2D392B)], startPoint: .leading, endPoint: .trailing)
            } else {
                ZStack {
                    Mint.surface1
                    LinearGradient(colors: [Color(hex: 0x428116).opacity(0.2), Color(hex: 0xA2C18C).opacity(0.2), Color.white.opacity(0.2)],
                                   startPoint: .leading, endPoint: .trailing)
                }
            }
        }
    }
}

struct Placeholder: View {
    let title: String
    var body: some View {
        VStack {
            MintHeader(title: title)
            Spacer()
            Text("В прототипе этого экрана нет").font(Inter.regular(14)).foregroundStyle(Mint.mintMuted)
            Spacer()
        }
    }
}

/// Шапка экрана: три зоны, заголовок строго по центру (mint-head).
struct MintHeader<L: View, R: View>: View {
    let title: String
    var left: L
    var right: R
    init(title: String, @ViewBuilder left: () -> L = { EmptyView() }, @ViewBuilder right: () -> R = { EmptyView() }) {
        self.title = title; self.left = left(); self.right = right()
    }
    var body: some View {
        ZStack {
            Text(title).font(Inter.medium(17.7)).foregroundStyle(Mint.title)
            HStack { left; Spacer(); right }
        }
        .padding(.horizontal, 17).padding(.top, 19).padding(.bottom, 12)
    }
}

extension MintHeader where L == EmptyView, R == EmptyView {
    init(title: String) { self.title = title; left = EmptyView(); right = EmptyView() }
}

/// Кнопка «назад» — белая таблетка 37×31 со стрелкой.
struct BackPill: View {
    let action: () -> Void
    var body: some View {
        Button(action: action) {
            // Исходник SVG смотрит вправо (в вебе — scaleX(-1)).
            MintIcon("back", 7, 13).scaleEffect(x: -1).foregroundStyle(Mint.mintMuted).frame(width: 37, height: 31)
        }
        .mintPill().buttonStyle(.plain)
    }
}

/// Стеклянная подложка под шапкой: размытие под самой шапкой и растворение
/// ниже неё. Материал нельзя маскировать — маска отключает размытие, поэтому
/// размытая часть и градиент-растворение — разные слои.
struct GlassTop: View {
    var fade: CGFloat = 24
    var body: some View {
        VStack(spacing: 0) {
            Rectangle().fill(.regularMaterial)
                .overlay(LinearGradient(colors: [Mint.background.opacity(0.9), Mint.background.opacity(0.6)], startPoint: .top, endPoint: .bottom))
            LinearGradient(colors: [Mint.background.opacity(0.6), Mint.background.opacity(0)], startPoint: .top, endPoint: .bottom)
                .frame(height: fade)
        }
        .allowsHitTesting(false)
    }
}
