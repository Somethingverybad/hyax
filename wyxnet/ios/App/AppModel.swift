// Состояние приложения: вход, профиль узлов (проверенный подписью), туннель, отчёты.
import Foundation
import NetworkExtension
import SwiftUI

@MainActor
final class AppModel: ObservableObject {
    @Published var loggedIn = API.shared.isLoggedIn
    @Published var username = API.shared.username
    @Published var profile: VpnProfile? = VpnProfile.loadSaved()
    @Published var profileNote: String?
    @Published var settings = TunnelSettings.load() { didSet { settings.save() } }
    @Published var status = TunnelStatus.load() ?? TunnelStatus()
    @Published var busy = false
    @AppStorage("appearance") var appearance = "dark"
    var theme: Theme { Theme.named(appearance) }
    @Published var error: String?
    let tunnel = TunnelManager()
    private let log = TunnelLog.shared
    private var pollTask: Task<Void, Never>?
    private var lastProfileFetch = Date.distantPast

    var vpnStatus: NEVPNStatus { tunnel.vpnStatus }
    var currentNode: VpnNode? { profile?.nodes.first { $0.id == status.nodeId } }

    func bootstrap() async {
        log.tag = "app"
        await tunnel.load()
        startPolling()
        guard loggedIn else { return }
        await refreshProfile(force: false)
        await uploadEvents()
    }

    // MARK: вход

    func login(username: String, password: String) async {
        busy = true; defer { busy = false }
        error = nil
        do {
            try await API.shared.login(username: username.trimmingCharacters(in: .whitespaces), password: password)
            self.username = API.shared.username
            loggedIn = true
            log.log("вход: \(username)")
            await refreshProfile(force: true)
        } catch {
            self.error = error.localizedDescription
        }
    }

    func logout() {
        if tunnel.isActive { tunnel.stop() }
        API.shared.logout()
        try? FileManager.default.removeItem(at: AppGroup.profileURL)
        profile = nil
        loggedIn = false
        username = nil
        log.log("выход")
    }

    // MARK: профиль

    func refreshProfile(force: Bool) async {
        guard loggedIn else { return }
        if !force, let p = profile, Date().timeIntervalSince(lastProfileFetch) < Double(p.ttl) { return }
        do {
            let s = try await API.shared.fetchProfile()
            let warning = try Signature.verify(payload: s.payload, sig: s.sig, pub: s.pub)
            let p = try VpnProfile.decode(s.payload)
            try Data(s.payload.utf8).write(to: AppGroup.profileURL, options: .atomic)
            profile = p
            profileNote = warning
            lastProfileFetch = Date()
            error = nil
            log.log("профиль обновлён: узлов \(p.nodes.count), живых \(p.nodes.filter(\.ok).count)" + (warning.map { "; \($0)" } ?? ""))
        } catch let e as APIError where e.unauthorized {
            logout()
            error = e.message
        } catch {
            self.error = error.localizedDescription
            log.log("профиль не обновлён: \(error.localizedDescription)")
        }
    }

    // MARK: туннель

    func connect(nodeId: String? = nil) async {
        busy = true; defer { busy = false }
        error = nil
        if profile == nil { await refreshProfile(force: true) }
        guard let p = profile, !p.nodes.isEmpty else {
            if error == nil { error = "Нет узлов — доступ к сети WYX не выдан?" }
            return
        }
        do {
            log.log("подключение" + (nodeId.map { " к \($0)" } ?? ""))
            try await tunnel.start(nodeId: nodeId ?? settings.preferredNode)
        } catch {
            self.error = "VPN не запустился: \(error.localizedDescription)"
            log.log(self.error!)
        }
    }

    func disconnect() {
        log.log("отключение по кнопке")
        tunnel.stop()
    }

    func select(node: VpnNode) async {
        settings.preferredNode = node.id
        if tunnel.isActive {
            if let s = await tunnel.send(TunnelCommand.switchNode, node: node.id) { status = s }
        } else {
            await connect(nodeId: node.id)
        }
    }

    func probeNow() async {
        if let s = await tunnel.send(TunnelCommand.probe) { status = s }
    }

    private func startPolling() {
        pollTask?.cancel()
        pollTask = Task { [weak self] in
            while !Task.isCancelled {
                guard let self else { return }
                if self.tunnel.isActive {
                    if let s = await self.tunnel.send(TunnelCommand.status) { self.status = s }
                } else if let s = TunnelStatus.load() {
                    self.status = s
                }
                try? await Task.sleep(nanoseconds: 2_000_000_000)
            }
        }
    }

    // MARK: отчёты

    /// Отправить накопленные расширением события и подрезать файл.
    func uploadEvents() async {
        guard loggedIn, let data = try? Data(contentsOf: AppGroup.eventsURL), !data.isEmpty else { return }
        let consumed = data.count
        let lines = data.split(separator: 0x0A)
        let events: [[String: Any]] = lines.compactMap { (try? JSONSerialization.jsonObject(with: $0)) as? [String: Any] }
        guard !events.isEmpty else { try? Data().write(to: AppGroup.eventsURL); return }
        do {
            var sent = 0
            for chunk in stride(from: 0, to: events.count, by: 200) {
                sent += try await API.shared.report(Array(events[chunk..<min(chunk + 200, events.count)]))
            }
            // убрать отправленное, оставить то, что расширение дописало за это время
            if let now = try? Data(contentsOf: AppGroup.eventsURL), now.count >= consumed {
                try? now.suffix(from: consumed).write(to: AppGroup.eventsURL, options: .atomic)
            }
            log.log("отчёты отправлены: \(sent)")
        } catch {
            log.log("отчёты не отправлены: \(error.localizedDescription)")
        }
    }
}
