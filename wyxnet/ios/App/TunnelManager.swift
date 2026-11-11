// Управление системным VPN-профилем (NETunnelProviderManager) и разговор с расширением.
import Foundation
import NetworkExtension

@MainActor
final class TunnelManager: ObservableObject {
    @Published var vpnStatus: NEVPNStatus = .invalid
    @Published var lastError: String?
    private var manager: NETunnelProviderManager?
    private var observer: NSObjectProtocol?

    func load() async {
        do {
            let all = try await NETunnelProviderManager.loadAllFromPreferences()
            manager = all.first { ($0.protocolConfiguration as? NETunnelProviderProtocol)?.providerBundleIdentifier == AppGroup.tunnelBundleId } ?? all.first
            bind()
        } catch {
            lastError = "Не удалось прочитать VPN-профиль: \(error.localizedDescription)"
        }
    }

    private func bind() {
        guard let m = manager else { vpnStatus = .invalid; return }
        vpnStatus = m.connection.status
        if let o = observer { NotificationCenter.default.removeObserver(o) }
        observer = NotificationCenter.default.addObserver(forName: .NEVPNStatusDidChange, object: m.connection, queue: .main) { [weak self] _ in
            Task { @MainActor in self?.vpnStatus = m.connection.status }
        }
    }

    /// Создать или починить профиль VPN в настройках системы (первый раз iOS спросит разрешение).
    func ensure() async throws -> NETunnelProviderManager {
        let m = manager ?? NETunnelProviderManager()
        let proto = (m.protocolConfiguration as? NETunnelProviderProtocol) ?? NETunnelProviderProtocol()
        proto.providerBundleIdentifier = AppGroup.tunnelBundleId
        proto.serverAddress = "WYX Net"
        proto.disconnectOnSleep = false
        m.protocolConfiguration = proto
        m.localizedDescription = "WYX Net"
        m.isEnabled = true
        try await m.saveToPreferences()
        try await m.loadFromPreferences()
        manager = m
        bind()
        return m
    }

    func start(nodeId: String?) async throws {
        let m = try await ensure()
        var options: [String: NSObject] = [:]
        if let nodeId { options["node"] = nodeId as NSString }
        try m.connection.startVPNTunnel(options: options.isEmpty ? nil : options)
    }

    func stop() {
        manager?.connection.stopVPNTunnel()
    }

    var isActive: Bool { [.connected, .connecting, .reasserting].contains(vpnStatus) }

    /// Команда расширению; ответ — TunnelStatus (nil, если туннель не поднят).
    func send(_ cmd: String, node: String? = nil) async -> TunnelStatus? {
        guard let session = manager?.connection as? NETunnelProviderSession, isActive else { return nil }
        var msg: [String: Any] = ["cmd": cmd]
        if let node { msg["node"] = node }
        guard let data = try? JSONSerialization.data(withJSONObject: msg) else { return nil }
        return await withCheckedContinuation { cont in
            do {
                try session.sendProviderMessage(data) { reply in
                    cont.resume(returning: reply.flatMap { try? TunnelStatus.decoder.decode(TunnelStatus.self, from: $0) })
                }
            } catch {
                cont.resume(returning: nil)
            }
        }
    }
}
