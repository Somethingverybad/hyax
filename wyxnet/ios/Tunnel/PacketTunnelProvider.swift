// Расширение туннеля «Сети WYX»: весь трафик телефона → tun → hev-socks5-tunnel →
// локальный socks Xray → VLESS (Reality / XHTTP) на выбранный узел.
//
// Живость узла здесь проверяется через сам туннель (Health): запуск Xray ничего
// не говорит о сети — он лишь поднимает слушатель. Поэтому после старта проверки
// частые (3 с), после первого успеха — раз в 20 с; три провала подряд (два до первого
// успеха) — переключение на следующий узел, упавший попадает в конец очереди.
// Приложение узнаёт состояние через handleAppMessage и status.json.
import Foundation
import NetworkExtension

final class PacketTunnelProvider: NEPacketTunnelProvider {
    private let log = TunnelLog.shared
    private let q = DispatchQueue(label: "wyxnet.tunnel")

    private var profile: VpnProfile?
    private var settings = TunnelSettings()
    private var order: [VpnNode] = []
    private var current: VpnNode?
    private var status = TunnelStatus()

    private var generation = 0
    private var stopping = false
    private var probeWork: DispatchWorkItem?
    private var probeAttempt = 0
    private var consecutiveFailures = 0
    private var okOnThisNode = false
    private var lastOkReport = Date.distantPast
    private var lastOkLog = Date.distantPast
    private var connectedAt: Date?
    private var failedRecently: [String: Date] = [:]
    private var trafficSamples: [(at: Date, bytes: Int)] = []
    private var tun2socksStarted = false
    private var pathObserver: NSKeyValueObservation?

    // MARK: - Жизненный цикл

    override func startTunnel(options: [String: NSObject]?, completionHandler: @escaping (Error?) -> Void) {
        log.tag = "tun"
        let ver = XrayCore.version
        log.log("старт туннеля, Xray \(ver)")
        settings = TunnelSettings.load()
        guard let p = VpnProfile.loadSaved(), !p.nodes.isEmpty else {
            log.log("нет профиля — откройте приложение, чтобы получить список узлов")
            status = TunnelStatus(state: .error, lastError: "Нет профиля — откройте приложение")
            status.save()
            completionHandler(NSError(domain: "wyxnet", code: 1, userInfo: [NSLocalizedDescriptionKey: "Нет профиля"]))
            return
        }
        profile = p
        let preferred = (options?["node"] as? String) ?? settings.preferredNode
        order = p.order(preferred: preferred)
        status = TunnelStatus(state: .starting, xrayVersion: ver)
        status.save()

        setTunnelNetworkSettings(makeNetworkSettings()) { [weak self] err in
            guard let self else { return }
            if let err {
                self.log.log("настройки сети не применились: \(err.localizedDescription)")
                completionHandler(err)
                return
            }
            self.q.async {
                guard let node = self.startFirstAvailable() else {
                    self.setState(.error, error: "Ни один узел не запустился")
                    completionHandler(NSError(domain: "wyxnet", code: 2, userInfo: [NSLocalizedDescriptionKey: "Ни один узел не запустился"]))
                    return
                }
                self.startTun2Socks()
                self.became(node)
                completionHandler(nil)
                self.scheduleProbe(after: 1.5)
                self.observePath()
            }
        }
    }

    override func stopTunnel(with reason: NEProviderStopReason, completionHandler: @escaping () -> Void) {
        q.async {
            self.stopping = true
            self.probeWork?.cancel()
            self.pathObserver = nil
            self.log.log("остановка туннеля (\(reason.rawValue))")
            XrayCore.stop()
            Socks5Tunnel.quit()
            self.setState(.stopped)
            completionHandler()
        }
    }

    override func handleAppMessage(_ messageData: Data, completionHandler: ((Data?) -> Void)?) {
        q.async {
            let obj = (try? JSONSerialization.jsonObject(with: messageData)) as? [String: Any]
            switch obj?["cmd"] as? String {
            case TunnelCommand.switchNode:
                self.switchNode(to: obj?["node"] as? String, reason: "по команде из приложения")
            case TunnelCommand.probe:
                self.scheduleProbe(after: 0)
            default:
                break
            }
            self.refreshTraffic()
            completionHandler?(try? TunnelStatus.encoder.encode(self.status))
        }
    }

    override func sleep(completionHandler: @escaping () -> Void) {
        completionHandler()
    }

    override func wake() {
        q.async { self.scheduleProbe(after: 2) }
    }

    // MARK: - Сеть

    private func makeNetworkSettings() -> NEPacketTunnelNetworkSettings {
        let s = NEPacketTunnelNetworkSettings(tunnelRemoteAddress: "198.18.0.254")
        let v4 = NEIPv4Settings(addresses: ["198.18.0.1"], subnetMasks: ["255.255.255.0"])
        v4.includedRoutes = [NEIPv4Route.default()]
        s.ipv4Settings = v4
        let v6 = NEIPv6Settings(addresses: ["fd00:7779:7878::2"], networkPrefixLengths: [64])
        v6.includedRoutes = [NEIPv6Route.default()]
        s.ipv6Settings = v6
        let dns = NEDNSSettings(servers: ["1.1.1.1", "8.8.8.8"])
        dns.matchDomains = [""]
        s.dnsSettings = dns
        s.mtu = 9000
        return s
    }

    private func observePath() {
        pathObserver = observe(\.defaultPath, options: [.new]) { [weak self] provider, _ in
            guard let self else { return }
            let p = provider.defaultPath
            self.q.async {
                self.log.log("сеть изменилась: \(p?.status == .satisfied ? "есть" : "нет"), \(p?.isExpensive == true ? "сотовая" : "wi-fi")")
                if p?.status == .satisfied { self.scheduleProbe(after: 3) }
            }
        }
    }

    private func netKind() -> String {
        guard let p = defaultPath else { return "" }
        return p.isExpensive ? "cell" : "wifi"
    }

    // MARK: - Xray и tun2socks

    private func startFirstAvailable() -> VpnNode? {
        guard let p = profile else { return nil }
        for node in order {
            if let err = XrayCore.run(configJSON: XrayConfig.build(node: node, uuid: p.user.uuid)) {
                log.log("узел \(node.name): ядро не запустилось — \(err)")
                VpnEvent(node: node.id, ok: false, error: "start: \(err.prefix(150))", net: netKind()).append()
                XrayCore.stop()
                continue
            }
            log.log("узел \(node.name) (\(node.kind), \(node.dialAddress):\(node.port)) — ядро запущено")
            return node
        }
        return nil
    }

    private func startTun2Socks() {
        guard !tun2socksStarted else { return }
        tun2socksStarted = true
        Socks5Tunnel.run(yaml: XrayConfig.tun2socksYAML) { [weak self] code in
            guard let self else { return }
            self.q.async {
                self.tun2socksStarted = false
                if !self.stopping { self.log.log("tun2socks завершился с кодом \(code)") }
            }
        }
    }

    private func became(_ node: VpnNode) {
        current = node
        connectedAt = Date()
        okOnThisNode = false
        consecutiveFailures = 0
        probeAttempt = 0
        trafficSamples.removeAll()
        status.nodeId = node.id
        status.nodeName = node.name
        status.since = Date()
        status.failures = 0
        status.lastProbeMs = nil
        // «подключено» условно — до первой удачной проверки; система всё равно считает туннель поднятым
        setState(.connected)
    }

    /// Переключение на другой узел: по команде (to) или на лучший из остальных.
    private func switchNode(to id: String?, reason: String) {
        if let fresh = VpnProfile.loadSaved() { profile = fresh }
        guard let p = profile else { return }
        let settingsNow = TunnelSettings.load()
        settings = settingsNow
        let cur = current
        var candidates: [VpnNode]
        if let id {
            candidates = p.nodes.filter { $0.id == id }
            if candidates.isEmpty { log.log("узла \(id) нет в профиле"); return }
        } else {
            let now = Date()
            candidates = p.nodes.filter { $0.id != cur?.id }
            // живые по пробнику и не падавшие у нас последние 10 минут — первыми; порядок сервера сохраняем
            candidates = candidates.enumerated().sorted { a, b in
                let fa = (failedRecently[a.element.id].map { now.timeIntervalSince($0) < 600 } ?? false)
                let fb = (failedRecently[b.element.id].map { now.timeIntervalSince($0) < 600 } ?? false)
                if fa != fb { return !fa }
                if a.element.ok != b.element.ok { return a.element.ok }
                return a.offset < b.offset
            }.map { $0.element }
        }
        guard !candidates.isEmpty else { log.log("переключаться некуда: других узлов нет"); return }

        generation += 1
        probeWork?.cancel()
        reasserting = true
        setState(.switching)
        if let cur { failedRecently[cur.id] = reason.contains("команде") || reason.contains("ротация") ? nil : Date() }
        XrayCore.stop()
        for next in candidates {
            if let err = XrayCore.run(configJSON: XrayConfig.build(node: next, uuid: p.user.uuid)) {
                log.log("узел \(next.name): ядро не запустилось — \(err)")
                failedRecently[next.id] = Date()
                XrayCore.stop()
                continue
            }
            log.log("переключение: \(cur?.name ?? "—") → \(next.name) (\(reason))")
            status.switches += 1
            became(next)
            reasserting = false
            scheduleProbe(after: 1.5)
            return
        }
        // никто не запустился — вернуть прежний
        if let cur, XrayCore.run(configJSON: XrayConfig.build(node: cur, uuid: p.user.uuid)) == nil {
            log.log("остаёмся на \(cur.name): другие узлы не запустились")
            became(cur)
        } else {
            setState(.error, error: "Ни один узел не запустился")
        }
        reasserting = false
        scheduleProbe(after: 5)
    }

    // MARK: - Проверка связи

    private func scheduleProbe(after s: Double) {
        guard !stopping else { return }
        probeWork?.cancel()
        let w = DispatchWorkItem { [weak self] in self?.runProbe() }
        probeWork = w
        q.asyncAfter(deadline: .now() + s, execute: w)
    }

    private func runProbe() {
        guard let node = current, !stopping else { return }
        let gen = generation
        Health.probe(socksPort: XrayConfig.socksPort, attempt: probeAttempt) { [weak self] r in
            self?.q.async { self?.handleProbe(r, node: node, gen: gen) }
        }
    }

    private func handleProbe(_ r: Health.Result, node: VpnNode, gen: Int) {
        guard gen == generation, !stopping else { return }
        status.lastProbeAt = Date()
        refreshTraffic()
        if r.ok {
            let first = !okOnThisNode
            okOnThisNode = true
            consecutiveFailures = 0
            probeAttempt = 0
            status.lastProbeMs = r.ms
            status.failures = 0
            status.lastError = nil
            failedRecently[node.id] = nil
            if status.state != .connected { setState(.connected) }
            if first || Date().timeIntervalSince(lastOkLog) > 600 {
                log.log("связь через \(node.name): \(r.ms) мс, ↑\(fmt(status.up)) ↓\(fmt(status.down))")
                lastOkLog = Date()
            }
            if first || Date().timeIntervalSince(lastOkReport) > 300 {
                VpnEvent(node: node.id, ok: true, rtt_ms: r.ms, net: netKind()).append()
                lastOkReport = Date()
            }
            status.save()
            if !maybeRotateIdle() { scheduleProbe(after: 20) }
        } else {
            consecutiveFailures += 1
            probeAttempt += 1
            status.failures = consecutiveFailures
            status.lastError = r.error
            log.log("проверка через \(node.name) не прошла (\(consecutiveFailures)): \(r.error ?? "")")
            let threshold = okOnThisNode ? 3 : 2
            if consecutiveFailures >= threshold {
                VpnEvent(node: node.id, ok: false, error: r.error.map { String($0.prefix(150)) }, net: netKind()).append()
                if settings.autoSwitch, (profile?.nodes.count ?? 0) > 1, defaultPath?.status == .satisfied {
                    switchNode(to: nil, reason: "узел не отвечает")
                } else {
                    setState(.error, error: r.error)
                    scheduleProbe(after: 10)
                }
            } else {
                status.save()
                scheduleProbe(after: okOnThisNode ? 5 : 3)
            }
        }
    }

    /// Ротация в простое: давно на одном узле, трафика почти нет, есть другой живой.
    private func maybeRotateIdle() -> Bool {
        guard settings.rotateIdle, let since = connectedAt, let p = profile, let cur = current else { return false }
        guard Date().timeIntervalSince(since) > Double(settings.rotateMinutes) * 60 else { return false }
        guard let old = trafficSamples.first(where: { Date().timeIntervalSince($0.at) >= 600 }),
              let last = trafficSamples.last, last.bytes - old.bytes < 300 * 1024 else { return false }
        guard p.nodes.contains(where: { $0.id != cur.id && $0.ok }) else { return false }
        switchNode(to: nil, reason: "ротация в простое")
        return true
    }

    private func refreshTraffic() {
        let st = Socks5Tunnel.stats
        status.up = st.upBytes
        status.down = st.downBytes
        trafficSamples.append((Date(), st.upBytes + st.downBytes))
        if trafficSamples.count > 60 { trafficSamples.removeFirst(trafficSamples.count - 60) }
    }

    private func setState(_ s: TunnelStatus.State, error: String? = nil) {
        status.state = s
        if let error { status.lastError = error }
        if s == .stopped { status.nodeId = nil; status.nodeName = nil }
        status.updatedAt = Date()
        status.save()
    }

    private func fmt(_ bytes: Int) -> String {
        ByteCountFormatter.string(fromByteCount: Int64(bytes), countStyle: .binary)
    }
}
