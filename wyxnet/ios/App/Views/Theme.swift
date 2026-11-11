// Цвета WYX (sux-chat-app/src/index.css, тёмная тема): фон почти чёрный, поверхности
// чуть светлее, акцент — красный, скругление 12.
import SwiftUI

enum WYX {
    static let background = Color(hue: 240 / 360, saturation: 0.03, brightness: 0.06)
    static let surface = Color(hue: 240 / 360, saturation: 0.02, brightness: 0.10)
    static let surface2 = Color(hue: 240 / 360, saturation: 0.02, brightness: 0.13)
    static let border = Color(hue: 240 / 360, saturation: 0.03, brightness: 0.17)
    static let primary = Color(hue: 4 / 360, saturation: 0.74, brightness: 0.82)      // hsl(4 74% 47%)
    static let primaryDeep = Color(hue: 2 / 360, saturation: 0.72, brightness: 0.62)  // hsl(2 72% 36%)
    static let success = Color(hue: 140 / 360, saturation: 0.55, brightness: 0.52)
    static let warning = Color(hue: 38 / 360, saturation: 0.85, brightness: 0.95)
    static let text = Color.white
    static let muted = Color.white.opacity(0.55)
    static let radius: CGFloat = 12
}

struct WYXField: ViewModifier {
    func body(content: Content) -> some View {
        content
            .padding(.horizontal, 14).padding(.vertical, 13)
            .background(WYX.surface, in: RoundedRectangle(cornerRadius: 10))
            .overlay(RoundedRectangle(cornerRadius: 10).stroke(WYX.border, lineWidth: 1))
            .foregroundStyle(WYX.text)
    }
}

extension View {
    func wyxField() -> some View { modifier(WYXField()) }
}
