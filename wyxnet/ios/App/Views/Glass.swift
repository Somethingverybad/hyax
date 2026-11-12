// Объём и «стекло»: фон с медленно плывущими пятнами света, стеклянные карточки
// и круглые кнопки. Как у стеклянной темы мессенджера (index.css: --glass-glow,
// radial-gradient подсветки), только средствами SwiftUI (Material + тонкая грань).
import SwiftUI

/// Фон: базовый цвет темы и два мягких пятна (лайм и бирюза), которые медленно дышат.
struct GlassBackground: View {
    let t: Theme
    var active: Bool
    @State private var drift = false

    var body: some View {
        ZStack {
            t.background
            Circle()
                .fill(t.accent.opacity(active ? 0.28 : 0.14))
                .frame(width: 420, height: 420)
                .blur(radius: 110)
                .offset(x: drift ? -120 : -60, y: drift ? -300 : -240)
            Circle()
                .fill(Color(hex: 0x2F5B53).opacity(t.scheme == .dark ? 0.9 : 0.25))
                .frame(width: 460, height: 460)
                .blur(radius: 120)
                .offset(x: drift ? 150 : 90, y: drift ? 260 : 320)
            if active {
                Circle()
                    .fill(t.accent.opacity(0.10))
                    .frame(width: 520, height: 520)
                    .blur(radius: 140)
                    .offset(y: -40)
            }
        }
        .ignoresSafeArea()
        .onAppear {
            withAnimation(.easeInOut(duration: 9).repeatForever(autoreverses: true)) { drift = true }
        }
        .animation(.easeInOut(duration: 0.8), value: active)
    }
}

/// Стеклянная карточка: размытие, тонкая светлая грань сверху, тень в цвет фона.
struct GlassCard: ViewModifier {
    let t: Theme
    var radius: CGFloat = 20
    func body(content: Content) -> some View {
        content
            .background(
                RoundedRectangle(cornerRadius: radius, style: .continuous)
                    .fill(.ultraThinMaterial)
                    .overlay(
                        RoundedRectangle(cornerRadius: radius, style: .continuous)
                            .fill(LinearGradient(colors: [Color.white.opacity(t.scheme == .dark ? 0.06 : 0.5), .clear], startPoint: .top, endPoint: .bottom))
                    )
            )
            .overlay(
                RoundedRectangle(cornerRadius: radius, style: .continuous)
                    .strokeBorder(
                        LinearGradient(colors: [Color.white.opacity(t.scheme == .dark ? 0.22 : 0.9), Color.white.opacity(t.scheme == .dark ? 0.04 : 0.3)],
                                       startPoint: .topLeading, endPoint: .bottomTrailing),
                        lineWidth: 1)
            )
            .shadow(color: t.background.opacity(0.6), radius: 24, y: 12)
    }
}

/// Круглая стеклянная кнопка для шапки.
struct GlassIconButton: View {
    let t: Theme
    let system: String
    let action: () -> Void
    var body: some View {
        Button(action: action) {
            Image(systemName: system)
                .font(.system(size: 17, weight: .medium))
                .foregroundStyle(t.text.opacity(0.85))
                .frame(width: 44, height: 44)
                .background(Circle().fill(.ultraThinMaterial))
                .overlay(Circle().strokeBorder(Color.white.opacity(t.scheme == .dark ? 0.16 : 0.7), lineWidth: 1))
        }
        .buttonStyle(.plain)
    }
}

extension View {
    func glassCard(_ t: Theme, radius: CGFloat = 20) -> some View { modifier(GlassCard(t: t, radius: radius)) }
}

enum Haptic {
    static func tap() { UIImpactFeedbackGenerator(style: .medium).impactOccurred() }
    static func success() { UINotificationFeedbackGenerator().notificationOccurred(.success) }
    static func warning() { UINotificationFeedbackGenerator().notificationOccurred(.warning) }
}
