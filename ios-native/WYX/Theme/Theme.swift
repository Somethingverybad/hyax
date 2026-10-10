import SwiftUI
import UIKit

// Тема «Мята» — те же значения, что в sux-chat-app/src/themes/builtin.ts
// (MINT / MINT_DARK) и mint.css. Размеры — макетные из Figma, делённые на 3.

extension Color {
    init(hex: UInt32, alpha: Double = 1) {
        self.init(.sRGB,
                  red: Double((hex >> 16) & 0xFF) / 255,
                  green: Double((hex >> 8) & 0xFF) / 255,
                  blue: Double(hex & 0xFF) / 255,
                  opacity: alpha)
    }
}

/// Цвет, зависящий от светлой/тёмной темы.
private func dyn(_ light: UInt32, _ dark: UInt32, alpha: Double = 1) -> Color {
    Color(UIColor { tc in
        let h = tc.userInterfaceStyle == .dark ? dark : light
        return UIColor(red: CGFloat((h >> 16) & 0xFF) / 255, green: CGFloat((h >> 8) & 0xFF) / 255,
                       blue: CGFloat(h & 0xFF) / 255, alpha: alpha)
    })
}

enum Mint {
    // Цвета темы
    static let background = dyn(0xF4F8F1, 0x222B27)
    static let foreground = dyn(0x23463F, 0xFFFFFF)
    static let surface1 = dyn(0xFFFFFF, 0x2C3832)
    static let surface2 = dyn(0xFFFFFF, 0x303D36)
    static let surface3 = dyn(0xEEF4EA, 0x37453D)
    static let surface4 = dyn(0xE2EBDB, 0x405046)
    static let muted = dyn(0x6F7A74, 0xBDBDBD)
    static let subtle = dyn(0x858E89, 0x9AA59E)
    static let primary = dyn(0x2F5B53, 0xC7F964)
    static let primaryFg = dyn(0xFFFFFF, 0x2F5B53)
    static let accent = Color(hex: 0xC7F964)
    static let accentFg = Color(hex: 0x2F5B53)
    static let online = dyn(0x5DBB2E, 0xC7F964)
    static let chatCanvas = dyn(0xE3EDDB, 0x1C2420)
    static let divider = dyn(0xE3E7E0, 0x3A4831)
    static let bubble = Color(hex: 0x2F5B53)          // и свои, и чужие — как в макете
    static let bubbleFg = Color.white
    static let deepMint = Color(hex: 0x345C54)

    // Вспомогательные цвета раскладки (mint.css)
    static let title = dyn(0x2F5B53, 0xFFFFFF)        // --mint-title
    static let ink = dyn(0x2F5B53, 0xC7F964)          // --mint-ink
    static let mintMuted = dyn(0xA2A2A2, 0xBDBDBD)    // --mint-muted
    static let label = dyn(0x000000, 0xFFFFFF)        // --mint-label
    static let hint = dyn(0x9CB2AB, 0x8FA59E)
    static let rowDivider = dyn(0xD9D9D9, 0x3C4A42)
    static let navOn = dyn(0x345C54, 0xC7F964, alpha: 0.1)
    static let attachSegment = dyn(0x345C54, 0xC7F964, alpha: 0.1)

    /// Фон экрана: тот же диагональный градиент, что рисует страница в вебе.
    static var pageGradient: LinearGradient {
        LinearGradient(colors: [background, chatCanvas], startPoint: .topLeading, endPoint: .bottomTrailing)
    }

    // Тени (CSS blur → radius ≈ blur/2)
    static func shadow<V: View>(_ v: V) -> some View {
        v.shadow(color: .black.opacity(0.2), radius: 8.3, x: 0, y: 4.3)
    }
}

enum Inter {
    static func regular(_ s: CGFloat) -> Font { .custom("Inter-Regular", size: s) }
    static func medium(_ s: CGFloat) -> Font { .custom("Inter-Medium", size: s) }
    static func semibold(_ s: CGFloat) -> Font { .custom("Inter-SemiBold", size: s) }
    static func bold(_ s: CGFloat) -> Font { .custom("Inter-Bold", size: s) }
}

/// Иконки макета (SVG из sux-chat-app/src/themes/mint/icons, в каталоге как template).
struct MintIcon: View {
    let name: String
    var size: CGSize
    init(_ name: String, _ w: CGFloat, _ h: CGFloat? = nil) { self.name = name; size = CGSize(width: w, height: h ?? w) }
    var body: some View {
        Image(name).renderingMode(.template).resizable().aspectRatio(contentMode: .fit)
            .frame(width: size.width, height: size.height)
    }
}

/// Белая таблетка/карточка «Мяты»: поверхность, в тёмной — с рамкой и
/// градиентом к акценту, мягкая тень.
struct MintSurface: ViewModifier {
    var radius: CGFloat
    var card = false
    @Environment(\.colorScheme) private var scheme
    func body(content: Content) -> some View {
        content
            .background(
                Group {
                    if scheme == .dark {
                        LinearGradient(colors: [Mint.surface1, Color(hex: 0x3D5A3C)], startPoint: .leading, endPoint: .trailing)
                    } else {
                        Mint.surface1
                    }
                }
            )
            .clipShape(RoundedRectangle(cornerRadius: radius, style: .continuous))
            .overlay(
                RoundedRectangle(cornerRadius: radius, style: .continuous)
                    .stroke(scheme == .dark ? Mint.accent.opacity(0.3) : .clear, lineWidth: 1)
            )
            .shadow(color: .black.opacity(scheme == .dark ? 0.35 : 0.2), radius: card ? 5.5 : 8.3, x: 0, y: card ? 5 : 4.3)
    }
}

extension View {
    func mintPill() -> some View { modifier(MintSurface(radius: 999)) }
    func mintCard(_ radius: CGFloat = 20) -> some View { modifier(MintSurface(radius: radius, card: true)) }
    /// Салатовая кнопка-таблетка.
    func mintLime() -> some View {
        self.background(Mint.accent).clipShape(Capsule())
            .shadow(color: .black.opacity(0.2), radius: 8.3, x: 0, y: 4.3)
    }
}

enum Haptic {
    static func light() { UIImpactFeedbackGenerator(style: .light).impactOccurred() }
    static func medium() { UIImpactFeedbackGenerator(style: .medium).impactOccurred() }
}
