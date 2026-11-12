import NetworkExtension
import SwiftUI

/// Главный экран: одна большая кнопка и поле состояния. Узлы и прочее — в настройках.
struct MainView: View {
    @EnvironmentObject var model: AppModel
    private var t: Theme { model.theme }
    @State private var showLog = false
    @State private var showSettings = false
    @State private var pulse = false
    @State private var breathe = false
    @State private var pressed = false
    @State private var lastPhase: Phase = .off

    var body: some View {
        ZStack {
            GlassBackground(t: t, active: phase == .on)
            VStack(spacing: 0) {
                header
                Spacer(minLength: 24)
                bigButton
                Spacer(minLength: 24)
                statusBox
            }
            .padding(.horizontal, 20)
            .padding(.bottom, 16)
        }
        .preferredColorScheme(t.scheme)
        .sheet(isPresented: $showLog) { LogView() }
        .sheet(isPresented: $showSettings) { SettingsView() }
        .onChange(of: phase) { _, p in
            if p == .on, lastPhase != .on { Haptic.success() }
            if p == .trouble, lastPhase != .trouble { Haptic.warning() }
            lastPhase = p
        }
    }

    private var header: some View {
        HStack {
            GlassIconButton(t: t, system: "doc.text") { showLog = true }
            Spacer()
            VStack(spacing: 0) {
                Text("WYX").font(.system(size: 22, weight: .heavy)).tracking(-1).foregroundStyle(t.text)
                Text("сеть").font(.caption).foregroundStyle(t.muted)
            }
            Spacer()
            GlassIconButton(t: t, system: "gearshape") { showSettings = true }
        }
        .padding(.top, 8)
    }

    // MARK: состояние

    enum Phase { case off, busy, checking, on, trouble }

    private var phase: Phase {
        switch model.vpnStatus {
        case .connected:
            if model.status.state == .switching { return .busy }
            if model.status.state == .error || model.status.failures > 0 { return .trouble }
            return model.status.lastProbeMs == nil ? .checking : .on
        case .connecting, .reasserting, .disconnecting: return .busy
        default: return .off
        }
    }

    private var title: String {
        switch phase {
        case .off: return "Подключить"
        case .busy: return model.vpnStatus == .disconnecting ? "Отключаю…" : (model.status.state == .switching ? "Меняю узел…" : "Подключаю…")
        case .checking: return "Проверяю…"
        case .on: return "Защищено"
        case .trouble: return "Нет ответа"
        }
    }

    private var glow: Color {
        switch phase {
        case .off: return t.accent.opacity(0.0)
        case .busy, .checking: return t.accent.opacity(0.35)
        case .on: return t.accent
        case .trouble: return t.destructive
        }
    }

    private var icon: String {
        switch phase {
        case .on: return "checkmark.shield.fill"
        case .trouble: return "exclamationmark.shield"
        case .checking, .busy: return "shield.lefthalf.filled"
        case .off: return "power"
        }
    }

    // MARK: кнопка

    private var bigButton: some View {
        let on = phase == .on
        let working = phase == .busy || phase == .checking
        return Button {
            Haptic.tap()
            Task {
                if model.tunnel.isActive { model.disconnect() } else { await model.connect() }
            }
        } label: {
            ZStack {
                // свечение
                Circle().fill(glow.opacity(0.55))
                    .frame(width: 250, height: 250)
                    .blur(radius: 40)
                    .scaleEffect(on ? (breathe ? 1.08 : 0.96) : 1)
                    .opacity(phase == .off ? 0 : 1)
                // кольца при работе
                ForEach(0..<2, id: \.self) { i in
                    Circle().strokeBorder(t.accent.opacity(working ? 0.35 : 0), lineWidth: 1.5)
                        .frame(width: 250, height: 250)
                        .scaleEffect(pulse ? 1.25 + CGFloat(i) * 0.12 : 0.95)
                        .opacity(pulse ? 0 : 0.8)
                        .animation(.easeOut(duration: 1.8).repeatForever(autoreverses: false).delay(Double(i) * 0.6), value: pulse)
                }
                // стеклянный диск
                Circle()
                    .fill(.ultraThinMaterial)
                    .frame(width: 236, height: 236)
                    .overlay(
                        Circle().fill(
                            on
                            ? LinearGradient(colors: [t.accent, t.primaryDeep], startPoint: .topLeading, endPoint: .bottomTrailing)
                            : LinearGradient(colors: [Color.white.opacity(t.scheme == .dark ? 0.10 : 0.6), Color.white.opacity(0.0)], startPoint: .topLeading, endPoint: .bottomTrailing)
                        )
                    )
                    .overlay(
                        // блик сверху
                        Circle().strokeBorder(
                            LinearGradient(colors: [Color.white.opacity(t.scheme == .dark ? 0.55 : 0.95), Color.white.opacity(0.05)], startPoint: .top, endPoint: .bottom),
                            lineWidth: 1.5)
                    )
                    .shadow(color: glow.opacity(on ? 0.45 : 0.2), radius: 28, y: 14)
                    .shadow(color: t.background.opacity(0.7), radius: 16, y: 8)
                VStack(spacing: 10) {
                    Image(systemName: icon)
                        .font(.system(size: 54, weight: .semibold))
                        .contentTransition(.symbolEffect(.replace))
                        .symbolEffect(.pulse, options: .repeating, isActive: working)
                    Text(title)
                        .font(.title3.weight(.semibold))
                        .contentTransition(.opacity)
                }
                .foregroundStyle(on ? t.primaryForeground : t.text)
            }
            .scaleEffect(pressed ? 0.96 : 1)
        }
        .buttonStyle(.plain)
        .simultaneousGesture(DragGesture(minimumDistance: 0).onChanged { _ in pressed = true }.onEnded { _ in pressed = false })
        .disabled(model.busy || model.vpnStatus == .connecting || model.vpnStatus == .disconnecting)
        .onAppear {
            pulse = true
            withAnimation(.easeInOut(duration: 2.6).repeatForever(autoreverses: true)) { breathe = true }
        }
        .animation(.spring(duration: 0.35, bounce: 0.25), value: pressed)
        .animation(.easeInOut(duration: 0.5), value: phase)
    }

    // MARK: поле состояния

    private var stateColor: Color {
        switch phase {
        case .on: return t.success
        case .trouble: return t.destructive
        case .off: return t.muted
        default: return t.warning
        }
    }

    private var stateText: String {
        switch phase {
        case .on: return "Трафик идёт через сеть WYX"
        case .trouble: return "Узел не отвечает, ищу другой"
        case .checking: return "Туннель поднят, проверяю связь"
        case .busy: return "Секунду…"
        case .off: return "Не подключено"
        }
    }

    private var statusBox: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack(spacing: 10) {
                Circle().fill(stateColor).frame(width: 9, height: 9)
                    .shadow(color: stateColor.opacity(0.8), radius: 6)
                Text(stateText).font(.subheadline.weight(.medium)).foregroundStyle(t.text)
                    .contentTransition(.opacity)
                Spacer()
            }
            if model.tunnel.isActive {
                HStack(spacing: 0) {
                    metric("Узел", model.status.nodeName ?? "—")
                    metric("Задержка", model.status.lastProbeMs.map { "\($0) мс" } ?? "…")
                    metric("Трафик", "↑\(bytes(model.status.up)) ↓\(bytes(model.status.down))")
                }
                if let e = model.status.lastError, model.status.failures > 0 {
                    Text(e).font(.caption).foregroundStyle(t.destructive).lineLimit(2)
                }
            } else {
                HStack(spacing: 0) {
                    metric("Аккаунт", model.username.map { "@\($0)" } ?? "—")
                    metric("Узлов", model.profile.map { "\($0.nodes.filter(\.ok).count) из \($0.nodes.count)" } ?? "—")
                    metric("Выбор", model.settings.preferredNode.flatMap { id in model.profile?.nodes.first { $0.id == id }?.name } ?? "авто")
                }
            }
            if let note = model.profileNote { warn(note) }
            if let e = model.error { warn(e) }
        }
        .padding(18)
        .frame(maxWidth: .infinity, alignment: .leading)
        .glassCard(t)
        .onTapGesture { showLog = true }
        .animation(.easeInOut(duration: 0.3), value: model.status)
    }

    private func metric(_ label: String, _ value: String) -> some View {
        VStack(alignment: .leading, spacing: 3) {
            Text(label).font(.caption2).foregroundStyle(t.muted)
            Text(value).font(.footnote.weight(.semibold).monospacedDigit()).foregroundStyle(t.text)
                .lineLimit(1).minimumScaleFactor(0.7)
                .contentTransition(.numericText())
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private func warn(_ text: String) -> some View {
        HStack(alignment: .top, spacing: 8) {
            Image(systemName: "exclamationmark.triangle.fill").font(.caption).foregroundStyle(t.warning)
            Text(text).font(.caption).foregroundStyle(t.muted)
        }
    }

    private func bytes(_ b: Int) -> String {
        ByteCountFormatter.string(fromByteCount: Int64(b), countStyle: .binary)
    }
}
