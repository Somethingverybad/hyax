// Состояние туннеля, которое расширение пишет в status.json, и сообщения приложение→расширение.
import Foundation

struct TunnelStatus: Codable, Equatable {
    enum State: String, Codable { case starting, connected, switching, error, stopped }
    var state: State = .stopped
    var nodeId: String? = nil
    var nodeName: String? = nil
    var since: Date? = nil
    var up: Int = 0
    var down: Int = 0
    var lastProbeMs: Int? = nil
    var lastProbeAt: Date? = nil
    var failures: Int = 0
    var switches: Int = 0
    var lastError: String? = nil
    var xrayVersion: String? = nil
    var updatedAt: Date = Date()

    static let encoder: JSONEncoder = { let e = JSONEncoder(); e.dateEncodingStrategy = .iso8601; return e }()
    static let decoder: JSONDecoder = { let d = JSONDecoder(); d.dateDecodingStrategy = .iso8601; return d }()

    func save() {
        try? TunnelStatus.encoder.encode(self).write(to: AppGroup.statusURL, options: .atomic)
    }
    static func load() -> TunnelStatus? {
        guard let d = try? Data(contentsOf: AppGroup.statusURL) else { return nil }
        return try? decoder.decode(TunnelStatus.self, from: d)
    }
}

/// Команды приложения расширению (NETunnelProviderSession.sendProviderMessage), JSON.
enum TunnelCommand {
    static let status = "status"      // → TunnelStatus
    static let switchNode = "switch"  // {"cmd":"switch","node":"<id>"} или без node — следующий
    static let probe = "probe"        // проверить связь сейчас
}

/// Отчёт о событии для POST /api/vpn/report/ — только здоровье узла, без адресов и трафика.
struct VpnEvent: Codable {
    var node: String?
    var ok: Bool
    var rtt_ms: Int?
    var error: String?
    var at: String
    var net: String?

    static let dateFormatter: ISO8601DateFormatter = { let f = ISO8601DateFormatter(); f.formatOptions = [.withInternetDateTime]; return f }()

    init(node: String?, ok: Bool, rtt_ms: Int? = nil, error: String? = nil, net: String? = nil) {
        self.node = node; self.ok = ok; self.rtt_ms = rtt_ms; self.error = error; self.net = net
        self.at = VpnEvent.dateFormatter.string(from: Date())
    }

    /// Дописать строкой в events.jsonl (расширение).
    func append() {
        guard let d = try? JSONEncoder().encode(self) else { return }
        let url = AppGroup.eventsURL
        if !FileManager.default.fileExists(atPath: url.path) { FileManager.default.createFile(atPath: url.path, contents: nil) }
        if let h = try? FileHandle(forWritingTo: url) {
            defer { try? h.close() }
            _ = try? h.seekToEnd()
            try? h.write(contentsOf: d + Data("\n".utf8))
        }
    }
}
