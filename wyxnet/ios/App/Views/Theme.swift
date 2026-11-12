// Темы «Мята» из мессенджера (sux-chat-app/src/themes/builtin.ts: mint-dark, mint).
// По умолчанию тёмная; светлая — в настройках.
import SwiftUI

struct Theme {
    let scheme: ColorScheme
    let background: Color
    let surface: Color
    let surface2: Color
    let border: Color
    let text: Color
    let muted: Color
    let primary: Color          // кнопка «Подключить»
    let primaryForeground: Color
    let primaryDeep: Color
    let accent: Color
    let destructive: Color
    let success: Color
    let warning: Color
    static let radius: CGFloat = 12

    static let mintDark = Theme(
        scheme: .dark,
        background: Color(hex: 0x222B27), surface: Color(hex: 0x2C3832), surface2: Color(hex: 0x37453D), border: Color(hex: 0x4C5F3A),
        text: .white, muted: Color(hex: 0x9AA59E),
        primary: Color(hex: 0xC7F964), primaryForeground: Color(hex: 0x2F5B53), primaryDeep: Color(hex: 0x9FCB45), accent: Color(hex: 0xC7F964),
        destructive: Color(hex: 0xFF6B5E), success: Color(hex: 0x6FCF7B), warning: Color(hex: 0xFFB10A))

    static let mintLight = Theme(
        scheme: .light,
        background: Color(hex: 0xF4F8F1), surface: .white, surface2: Color(hex: 0xEEF4EA), border: Color(hex: 0xE1E8DC),
        text: Color(hex: 0x23463F), muted: Color(hex: 0x6F7A74),
        primary: Color(hex: 0x2F5B53), primaryForeground: .white, primaryDeep: Color(hex: 0x24473F), accent: Color(hex: 0xC7F964),
        destructive: Color(hex: 0xD64545), success: Color(hex: 0x3E8E41), warning: Color(hex: 0xB8860B))

    static func named(_ id: String) -> Theme { id == "light" ? mintLight : mintDark }
}

extension Color {
    init(hex: UInt32) {
        self.init(red: Double((hex >> 16) & 0xFF) / 255, green: Double((hex >> 8) & 0xFF) / 255, blue: Double(hex & 0xFF) / 255)
    }
}

struct ThemedField: ViewModifier {
    let t: Theme
    func body(content: Content) -> some View {
        content
            .padding(.horizontal, 14).padding(.vertical, 13)
            .background(t.surface.opacity(t.scheme == .dark ? 0.6 : 0.9), in: RoundedRectangle(cornerRadius: 12, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: 12, style: .continuous).strokeBorder(Color.white.opacity(t.scheme == .dark ? 0.12 : 0.9), lineWidth: 1))
            .foregroundStyle(t.text)
    }
}

extension View {
    func themedField(_ t: Theme) -> some View { modifier(ThemedField(t: t)) }
}
