import Foundation

// Клиент того же API, что у веб-клиента (sux-chat-app/src/api/client.ts).
// Прямой адрес, без CDN: CDN кэширует ответы API (см. память проекта).

struct Profile: Codable, Identifiable, Hashable {
    let id: String
    let username: String
    var avatar_url: String?
    var cover_url: String?
    var is_online: Bool?
    var is_bot: Bool?
    var hide_online: Bool?
}

struct Chat: Codable, Identifiable, Hashable {
    let id: String
    var participants: [Profile]
    var is_group: Bool?
    var kind: String?
    var name: String?
    var avatar_url: String?
    var unread_count: Int?
    var updated_at: String?
    var last_message: LastMessage?

    struct LastMessage: Codable, Hashable {
        var content: String?
        var created_at: String?
        var sender_username: String?
    }

    /// Собеседник в личном чате.
    func other(me: String) -> Profile? { participants.first { $0.id != me } ?? participants.first }

    func title(me: String) -> String {
        if kind == "saved" { return "Избранное" }
        if is_group == true || kind == "group" || kind == "channel" { return name ?? "Группа" }
        return other(me: me)?.username ?? name ?? "Чат"
    }
}

struct Message: Codable, Identifiable, Hashable {
    let id: String
    var content: String?
    var file_url: String?
    var file_name: String?
    var file_width: Int?
    var file_height: Int?
    var sender_id: String?
    var sender: Profile?
    var created_at: String
    var is_edited: Bool?
    var voice_url: String?
    var video_url: String?
    var sticker: Sticker?
    /// Локальная отметка: отправляется, сервера ещё не дождались.
    var pending: Bool? = nil

    struct Sticker: Codable, Hashable { var id: String; var file_url: String; var emoji: String? }

    var createdDate: Date { ISO8601.parse(created_at) ?? Date() }
    var isImage: Bool {
        guard let n = file_name?.lowercased() ?? file_url?.lowercased() else { return false }
        return n.hasSuffix(".png") || n.hasSuffix(".jpg") || n.hasSuffix(".jpeg") || n.hasSuffix(".webp") || n.hasSuffix(".gif") || n.hasSuffix(".heic")
    }
}

struct SyncResponse: Codable {
    var messages: [Message]
    var deleted: [String]
    var has_more: Bool?
    var now: String
}

struct TokenPair: Codable { var access: String; var refresh: String }
struct UploadResult: Codable { var file_url: String; var file_name: String?; var file_size: Int?; var width: Int?; var height: Int? }

enum ISO8601 {
    private static let withFrac: ISO8601DateFormatter = { let f = ISO8601DateFormatter(); f.formatOptions = [.withInternetDateTime, .withFractionalSeconds]; return f }()
    private static let plain: ISO8601DateFormatter = { let f = ISO8601DateFormatter(); f.formatOptions = [.withInternetDateTime]; return f }()
    static func parse(_ s: String) -> Date? { withFrac.date(from: s) ?? plain.date(from: s) }
}

enum APIError: LocalizedError {
    case http(Int, String)
    case unauthorized
    case network(Error)
    var errorDescription: String? {
        switch self {
        case .http(let code, let body): return "Сервер ответил \(code): \(body.prefix(200))"
        case .unauthorized: return "Нужно войти заново"
        case .network(let e): return e.localizedDescription
        }
    }
}

final class API {
    static let shared = API()
    /// WYX_API в окружении — для симулятора через локальный прокси (у симулятора
    /// при VPN на Mac не работает DNS): SIMCTL_CHILD_WYX_API=http://127.0.0.1:8080
    let origin = URL(string: ProcessInfo.processInfo.environment["WYX_API"] ?? "https://huyax.e-tree.su")!
    var base: URL { origin.appendingPathComponent("api") }

    private let defaults = UserDefaults.standard
    var access: String? { get { defaults.string(forKey: "access_token") } set { defaults.set(newValue, forKey: "access_token") } }
    var refresh: String? { get { defaults.string(forKey: "refresh_token") } set { defaults.set(newValue, forKey: "refresh_token") } }
    var isLoggedIn: Bool { access != nil }

    func logout() { access = nil; refresh = nil }

    /// Абсолютная ссылка на медиа: /media/… → с сервера; s3://… — через подпись.
    func mediaURL(_ path: String?) async -> URL? {
        guard let path, !path.isEmpty else { return nil }
        if path.hasPrefix("http") { return URL(string: path) }
        if path.hasPrefix("s3://") {
            let key = String(path.dropFirst(5))
            struct Signed: Codable { var url: String }
            if let s: Signed = try? await get("media/sign/", query: ["key": key]) { return URL(string: s.url) }
            return nil
        }
        return URL(string: origin.absoluteString + (path.hasPrefix("/") ? path : "/" + path))
    }

    // MARK: - Авторизация

    func login(username: String, password: String) async throws {
        let t: TokenPair = try await post("token/", body: ["username": username, "password": password], auth: false)
        access = t.access; refresh = t.refresh
    }

    func register(username: String, password: String) async throws {
        struct R: Codable { var message: String?; var error: String? }
        let _: R = try await post("auth/register/", body: ["username": username, "password": password, "accept_terms": true], auth: false)
        try await login(username: username, password: password)
    }

    private func refreshAccess() async -> Bool {
        guard let refresh else { return false }
        struct R: Codable { var access: String }
        do {
            let r: R = try await post("token/refresh/", body: ["refresh": refresh], auth: false)
            access = r.access
            return true
        } catch { return false }
    }

    // MARK: - Данные

    func currentProfile() async throws -> Profile { try await get("profiles/current/") }
    func chats() async throws -> [Chat] { try await get("chats/") }
    func savedChat() async throws -> Chat { try await get("chats/saved/") }

    func sync(chat: String, since: String? = nil, limit: Int = 60) async throws -> SyncResponse {
        var q = ["chat": chat]
        if let since { q["since"] = since } else { q["limit"] = String(limit) }
        return try await get("messages/sync/", query: q)
    }

    func send(chat: String, content: String) async throws -> Message {
        try await post("messages/", body: ["chat": chat, "content": content])
    }

    func sendFile(chat: String, upload: UploadResult) async throws -> Message {
        var body: [String: Any] = ["chat": chat, "content": "", "file_url": upload.file_url,
                                   "file_name": upload.file_name ?? "photo.jpg", "file_size": upload.file_size ?? 0]
        if let w = upload.width { body["file_width"] = w }
        if let h = upload.height { body["file_height"] = h }
        return try await post("messages/", body: body)
    }

    func markRead(chat: String) async {
        struct R: Codable { var status: String? }
        let _: R? = try? await post("messages/mark_chat_as_read/", body: ["chat_id": chat])
    }

    func upload(data: Data, name: String, mime: String) async throws -> UploadResult {
        let boundary = "----wyx\(UUID().uuidString)"
        var req = URLRequest(url: base.appendingPathComponent("upload/"))
        req.httpMethod = "POST"
        req.setValue("multipart/form-data; boundary=\(boundary)", forHTTPHeaderField: "Content-Type")
        if let access { req.setValue("Bearer \(access)", forHTTPHeaderField: "Authorization") }
        var b = Data()
        b.append("--\(boundary)\r\nContent-Disposition: form-data; name=\"file\"; filename=\"\(name)\"\r\nContent-Type: \(mime)\r\n\r\n".data(using: .utf8)!)
        b.append(data)
        b.append("\r\n--\(boundary)--\r\n".data(using: .utf8)!)
        req.httpBody = b
        let (d, r) = try await URLSession.shared.data(for: req)
        guard let http = r as? HTTPURLResponse, (200..<300).contains(http.statusCode) else {
            throw APIError.http((r as? HTTPURLResponse)?.statusCode ?? 0, String(data: d, encoding: .utf8) ?? "")
        }
        return try JSONDecoder().decode(UploadResult.self, from: d)
    }

    // MARK: - Транспорт

    private func get<T: Decodable>(_ path: String, query: [String: String] = [:]) async throws -> T {
        var comps = URLComponents(url: base.appendingPathComponent(path), resolvingAgainstBaseURL: false)!
        var items = query.map { URLQueryItem(name: $0.key, value: $0.value) }
        items.append(URLQueryItem(name: "_", value: String(Int(Date().timeIntervalSince1970 * 1000)))) // мимо кэшей
        comps.queryItems = items
        var req = URLRequest(url: comps.url!)
        req.httpMethod = "GET"
        return try await run(req)
    }

    private func post<T: Decodable>(_ path: String, body: [String: Any], auth: Bool = true) async throws -> T {
        var req = URLRequest(url: base.appendingPathComponent(path))
        req.httpMethod = "POST"
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        req.httpBody = try JSONSerialization.data(withJSONObject: body)
        return try await run(req, auth: auth)
    }

    private func run<T: Decodable>(_ request: URLRequest, auth: Bool = true, retried: Bool = false) async throws -> T {
        var req = request
        req.setValue("application/json", forHTTPHeaderField: "Accept")
        if auth, let access { req.setValue("Bearer \(access)", forHTTPHeaderField: "Authorization") }
        let (data, resp): (Data, URLResponse)
        do { (data, resp) = try await URLSession.shared.data(for: req) } catch { throw APIError.network(error) }
        let code = (resp as? HTTPURLResponse)?.statusCode ?? 0
        if code == 401, auth, !retried, await refreshAccess() {
            return try await run(request, auth: auth, retried: true)
        }
        if code == 401, auth { logout(); throw APIError.unauthorized }
        guard (200..<300).contains(code) else { throw APIError.http(code, String(data: data, encoding: .utf8) ?? "") }
        if T.self == Optional<Any>.self { fatalError() }
        do { return try JSONDecoder().decode(T.self, from: data) }
        catch {
            // Пустой ответ на запрос без тела (mark_chat_as_read) — не ошибка.
            if data.isEmpty, let v = try? JSONDecoder().decode(T.self, from: "{}".data(using: .utf8)!) { return v }
            throw error
        }
    }
}
