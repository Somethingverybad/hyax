// Профиль «Сети WYX» — то, что отдаёт GET /api/vpn/profile/ (backend/chat/vpn.py).
// payload приходит строкой JSON и подписан Ed25519; хранится в App Group как есть.
import Foundation

struct VpnNode: Codable, Identifiable, Equatable {
    let id: String          // slug
    let name: String
    let kind: String        // "reality" | "xhttp"
    let host: String
    let port: Int
    let sni: String
    var ips: [String]? = nil
    let weight: Int
    let ok: Bool
    let rtt_ms: Int?
    let checked_at: String?
    // reality
    var pbk: String? = nil
    var sid: String? = nil
    var fp: String? = nil
    var flow: String? = nil
    // xhttp
    var path: String? = nil
    var mode: String? = nil
    var alpn: [String]? = nil

    /// Куда реально подключаться: IP из Москвы (пробник), иначе имя.
    var dialAddress: String { ips?.first ?? host }
    var isReality: Bool { kind == "reality" }
}

struct VpnUser: Codable, Equatable {
    let id: String
    let username: String
    let uuid: String
    let email: String
}

struct VpnProfile: Codable, Equatable {
    let v: Int
    let issued_at: String
    let ttl: Int
    let user: VpnUser
    let nodes: [VpnNode]

    static func decode(_ text: String) throws -> VpnProfile {
        try JSONDecoder().decode(VpnProfile.self, from: Data(text.utf8))
    }

    /// Сохранённый приложением (уже проверенный) профиль.
    static func loadSaved() -> VpnProfile? {
        guard let d = try? Data(contentsOf: AppGroup.profileURL),
              let text = String(data: d, encoding: .utf8) else { return nil }
        return try? decode(text)
    }

    /// Порядок попыток: выбранный вручную первым, дальше как отдал сервер (живые первыми).
    func order(preferred: String?) -> [VpnNode] {
        guard let p = preferred, let i = nodes.firstIndex(where: { $0.id == p }) else { return nodes }
        var list = nodes
        let n = list.remove(at: i)
        list.insert(n, at: 0)
        return list
    }
}
