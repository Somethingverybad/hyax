import NetworkExtension
import SwiftUI

/// Главный экран: одна большая кнопка и поле состояния. Узлы и прочее — в настройках.
struct MainView: View {
    @EnvironmentObject var model: AppModel
    private var t: Theme { model.theme }
    @State private var showLog = false
    @State private var showSettings = false
    @State private var pulse = false

    var body: some View {
        ZStack {
            t.background.ignoresSafeArea()
            VStack(spacing: 0) {
                header
                Spacer()
                bigButton
                Spacer()
                statusBox
            }
            .padding(.horizontal, 20)
            .padding(.bottom, 16)
        }
        .preferredColorScheme(t.scheme)
        .sheet(isPresented: $showLog) { LogView() }
        .sheet(isPresented: $showSettings) { SettingsView() }
    }

    private var header: some View {
        HStack {
            Button { showLog = true } label: {
                Image(systemName: "doc.text").font(.title3).foregroundStyle(t.muted).frame(width: 44, height: 44)
            }
            Spacer()
            Text("WYX").font(.system(size: 22, weight: .heavy)).tracking(-1).foregroundStyle(t.text)
            Spacer()
            Button { showSettings = true } label: {
                Image(systemName: "gearshape").font(.title3).foregroundStyle(t.muted).frame(width: 44, height: 44)
            }
        }
        .padding(.top, 4)
    }

    // MARK: состояние

    private enum Phase { case off, busy, checking, on, trouble }

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

    private var color: Color {
        switch phase {
        case .off: return t.surface2
        case .busy, .checking: return t.primaryDeep
        case .on: return t.primary
        case .trouble: return t.destructive
        }
    }

    private var bigButton: some View {
        Button {
            Task {
                if model.tunnel.isActive { model.disconnect() } else { await model.connect() }
            }
        } label: {
            ZStack {
                Circle().fill(color.opacity(phase == .off ? 0 : 0.18))
                    .frame(width: 290, height: 290)
                    .scaleEffect(pulse && (phase == .busy || phase == .checking) ? 1.06 : 1)
                    .animation(.easeInOut(duration: 1.2).repeatForever(autoreverses: true), value: pulse)
                Circle().fill(color)
                    .frame(width: 230, height: 230)
                    .overlay(Circle().stroke(Color.white.opacity(phase == .off ? 0.12 : 0.25), lineWidth: 1))
                    .shadow(color: color.opacity(phase == .off ? 0 : 0.5), radius: 30, y: 10)
                VStack(spacing: 10) {
                    Image(systemName: phase == .on ? "checkmark.shield.fill" : "power")
                        .font(.system(size: 54, weight: .semibold))
                    Text(title).font(.title3.weight(.semibold))
                }
                .foregroundStyle(phase == .off ? t.text : (phase == .on ? t.primaryForeground : .white))
            }
        }
        .buttonStyle(.plain)
        .disabled(model.busy || model.vpnStatus == .connecting || model.vpnStatus == .disconnecting)
        .onAppear { pulse = true }
        .animation(.easeInOut(duration: 0.3), value: title)
    }

    // MARK: поле состояния

    private var statusLines: [String] {
        var lines: [String] = []
        if model.tunnel.isActive {
            lines.append("Узел: \(model.status.nodeName ?? "—")")
            var l2: [String] = []
            if let ms = model.status.lastProbeMs { l2.append("задержка \(ms) мс") }
            l2.append("↑ \(bytes(model.status.up))  ↓ \(bytes(model.status.down))")
            lines.append(l2.joined(separator: " · "))
            if let since = model.status.since {
                lines.append("С \(since.formatted(date: .omitted, time: .shortened))" + (model.status.switches > 0 ? ", переключений: \(model.status.switches)" : ""))
            }
            if let e = model.status.lastError, model.status.failures > 0 { lines.append("Ошибка: \(e)") }
        } else {
            lines.append(model.username.map { "Аккаунт @\($0)" } ?? "")
            if let p = model.profile {
                lines.append("Узлов: \(p.nodes.count), живых из Москвы: \(p.nodes.filter(\.ok).count)")
                if let pref = model.settings.preferredNode, let n = p.nodes.first(where: { $0.id == pref }) {
                    lines.append("Выбран узел: \(n.name)")
                } else {
                    lines.append("Узел выбирается автоматически")
                }
            } else {
                lines.append("Список узлов не получен")
            }
        }
        if let note = model.profileNote { lines.append("⚠︎ \(note)") }
        if let e = model.error { lines.append("⚠︎ \(e)") }
        return lines.filter { !$0.isEmpty }
    }

    private var statusBox: some View {
        VStack(alignment: .leading, spacing: 6) {
            ForEach(Array(statusLines.enumerated()), id: \.offset) { i, line in
                Text(line)
                    .font(i == 0 ? .body.weight(.medium) : .footnote)
                    .foregroundStyle(line.hasPrefix("⚠︎") ? t.warning : (line.hasPrefix("Ошибка") ? t.destructive : (i == 0 ? t.text : t.muted)))
                    .frame(maxWidth: .infinity, alignment: .leading)
            }
        }
        .padding(16)
        .frame(maxWidth: .infinity, minHeight: 96, alignment: .topLeading)
        .background(t.surface, in: RoundedRectangle(cornerRadius: Theme.radius))
        .overlay(RoundedRectangle(cornerRadius: Theme.radius).stroke(t.border, lineWidth: 1))
        .onTapGesture { showLog = true }
    }

    private func bytes(_ b: Int) -> String {
        ByteCountFormatter.string(fromByteCount: Int64(b), countStyle: .binary)
    }
}
