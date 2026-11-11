import NetworkExtension
import SwiftUI

struct MainView: View {
    @EnvironmentObject var model: AppModel
    @State private var showLog = false
    @State private var showSettings = false

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(spacing: 20) {
                    bigButton
                    details
                    if let note = model.profileNote { banner(note, color: .orange) }
                    if let e = model.error { banner(e, color: .red) }
                    nodes
                }
                .padding()
            }
            .navigationTitle("Сеть WYX")
            .toolbar {
                ToolbarItem(placement: .topBarLeading) {
                    Button { showLog = true } label: { Image(systemName: "doc.text") }
                }
                ToolbarItem(placement: .topBarTrailing) {
                    HStack {
                        Button { Task { await model.refreshProfile(force: true) } } label: { Image(systemName: "arrow.clockwise") }
                        Button { showSettings = true } label: { Image(systemName: "gearshape") }
                    }
                }
            }
            .sheet(isPresented: $showLog) { LogView() }
            .sheet(isPresented: $showSettings) { SettingsView() }
            .refreshable { await model.refreshProfile(force: true) }
        }
    }

    // MARK: кнопка

    private var phase: (title: String, color: Color, icon: String) {
        switch model.vpnStatus {
        case .connected:
            if model.status.state == .switching { return ("Переключаюсь…", .blue, "arrow.triangle.2.circlepath") }
            if model.status.state == .error || model.status.failures > 0 { return ("Нет ответа", .orange, "exclamationmark.shield") }
            if model.status.lastProbeMs == nil { return ("Проверяю…", .blue, "shield") }
            return ("Защищено", .green, "checkmark.shield.fill")
        case .connecting: return ("Подключаюсь…", .blue, "shield")
        case .reasserting: return ("Переподключаюсь…", .blue, "arrow.triangle.2.circlepath")
        case .disconnecting: return ("Отключаюсь…", .gray, "shield.slash")
        default: return ("Подключить", .gray, "shield.slash")
        }
    }

    private var bigButton: some View {
        Button {
            Task {
                if model.tunnel.isActive { model.disconnect() } else { await model.connect() }
            }
        } label: {
            VStack(spacing: 10) {
                Image(systemName: phase.icon).font(.system(size: 56, weight: .medium))
                Text(phase.title).font(.title3.bold())
            }
            .foregroundStyle(.white)
            .frame(width: 210, height: 210)
            .background(Circle().fill(phase.color.gradient).shadow(color: phase.color.opacity(0.4), radius: 18, y: 8))
        }
        .buttonStyle(.plain)
        .disabled(model.busy || model.vpnStatus == .connecting || model.vpnStatus == .disconnecting)
        .padding(.top, 12)
        .animation(.easeInOut, value: phase.title)
    }

    // MARK: подробности

    private var details: some View {
        VStack(spacing: 6) {
            if model.tunnel.isActive {
                Text(model.status.nodeName ?? "—").font(.headline)
                HStack(spacing: 16) {
                    if let ms = model.status.lastProbeMs { Label("\(ms) мс", systemImage: "speedometer") }
                    Label(bytes(model.status.up), systemImage: "arrow.up")
                    Label(bytes(model.status.down), systemImage: "arrow.down")
                }
                .font(.footnote.monospacedDigit()).foregroundStyle(.secondary)
                if let since = model.status.since {
                    Text("с \(since.formatted(date: .omitted, time: .shortened))" + (model.status.switches > 0 ? " · переключений: \(model.status.switches)" : ""))
                        .font(.caption).foregroundStyle(.tertiary)
                }
                if let e = model.status.lastError, model.status.failures > 0 {
                    Text(e).font(.caption).foregroundStyle(.orange).multilineTextAlignment(.center)
                }
            } else {
                Text(model.username.map { "@\($0)" } ?? "").font(.headline)
                Text(model.profile == nil ? "Список узлов не получен" : "Узлов: \(model.profile!.nodes.count), живых: \(model.profile!.nodes.filter(\.ok).count)")
                    .font(.footnote).foregroundStyle(.secondary)
            }
        }
    }

    private func banner(_ text: String, color: Color) -> some View {
        Text(text)
            .font(.footnote)
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(12)
            .background(color.opacity(0.12), in: RoundedRectangle(cornerRadius: 12))
            .foregroundStyle(color)
    }

    // MARK: узлы

    private var nodes: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack {
                Text("Узлы").font(.headline)
                Spacer()
                if model.settings.preferredNode != nil {
                    Button("Автовыбор") { model.settings.preferredNode = nil }.font(.footnote)
                }
            }
            if let p = model.profile {
                ForEach(p.nodes) { n in
                    Button { Task { await model.select(node: n) } } label: { row(n) }
                        .buttonStyle(.plain)
                }
            } else {
                Text("Потяните вниз, чтобы обновить.").font(.footnote).foregroundStyle(.secondary)
            }
        }
        .padding(.top, 8)
    }

    private func row(_ n: VpnNode) -> some View {
        let isCurrent = model.tunnel.isActive && model.status.nodeId == n.id
        let isPreferred = model.settings.preferredNode == n.id
        return HStack(spacing: 12) {
            Circle().fill(n.ok ? Color.green : Color.red).frame(width: 10, height: 10)
            VStack(alignment: .leading, spacing: 2) {
                Text(n.name).font(.body)
                Text("\(n.kind == "reality" ? "Reality" : "XHTTP") · \(n.ok ? (n.rtt_ms.map { "\($0) мс" } ?? "жив") : "не отвечает из Москвы")")
                    .font(.caption).foregroundStyle(.secondary)
            }
            Spacer()
            if isCurrent { Image(systemName: "checkmark.circle.fill").foregroundStyle(.green) }
            else if isPreferred { Image(systemName: "pin.fill").foregroundStyle(.secondary) }
        }
        .padding(12)
        .background(.quaternary.opacity(0.5), in: RoundedRectangle(cornerRadius: 12))
    }

    private func bytes(_ b: Int) -> String {
        ByteCountFormatter.string(fromByteCount: Int64(b), countStyle: .binary)
    }
}
