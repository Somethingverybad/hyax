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
    var bio: String?
}

struct PinnedInfo: Codable, Hashable { var id: String; var sender_username: String?; var preview: String? }

struct Chat: Codable, Identifiable, Hashable {
    let id: String
    var participants: [Profile]
    var is_group: Bool?
    var kind: String?
    var name: String?
    var avatar_url: String?
    var creator: String?
    var unread_count: Int?
    var updated_at: String?
    var last_message: LastMessage?
    var last_message_at: String?
    var pinned_message: PinnedInfo?
    var secret: SecretInfo?
    var isSecret: Bool { secret != nil }

    /// Превью последнего сообщения (ChatSerializer.get_last_message).
    struct LastMessage: Codable, Hashable {
        var text: String?
        var sender_id: String?
        var read: Bool?
    }

    /// Собеседник в личном чате.
    func other(me: String) -> Profile? { participants.first { $0.id != me } ?? participants.first }
    var isGroupLike: Bool { is_group == true || kind == "group" || kind == "channel" }

    func title(me: String) -> String {
        if kind == "saved" { return "Избранное" }
        if isGroupLike { return name ?? "Группа" }
        return other(me: me)?.username ?? name ?? "Чат"
    }
}

struct Entity: Codable, Hashable { var type: String; var offset: Int; var length: Int }
struct Mention: Codable, Hashable { var id: String; var offset: Int; var length: Int }
struct Reaction: Codable, Hashable { var emoji: String; var count: Int; var mine: Bool? }
struct ReplyInfo: Codable, Hashable { var id: String; var sender_username: String?; var preview: String? }
struct ReadBy: Codable, Hashable { var id: String; var username: String?; var read_at: String? }
struct BotButton: Codable, Hashable { var text: String; var data: String }
struct ForwardedFrom: Codable, Hashable { var id: String; var username: String?; var avatar_url: String? }
struct ForwardedChat: Codable, Hashable { var id: String; var name: String?; var username: String? }
struct SoundInfo: Codable, Hashable { var id: String; var slug: String?; var name: String?; var url: String? }

struct Message: Codable, Identifiable, Hashable {
    let id: String
    var content: String?
    var entities: [Entity]?
    var mentions: [Mention]?
    var file_url: String?
    var file_name: String?
    var file_size: Int?
    var file_width: Int?
    var file_height: Int?
    var poster_url: String?
    var download_only: Bool?
    var sender_id: String?
    var sender: Profile?
    var created_at: String
    var is_edited: Bool?
    var voice_url: String?
    var voice_duration: Int?
    var voice_transcript: String?
    var video_url: String?
    var video_duration: Int?
    var video_mirror: Bool?
    var video_flip: Bool?
    var sticker: Sticker?
    var sound: SoundInfo?
    var reply_to: ReplyInfo?
    var reactions: [Reaction]?
    var read_by: [ReadBy]?
    var buttons: [[BotButton]]?
    var forwarded_from: ForwardedFrom?
    var forwarded_title: String?
    var forwarded_chat: ForwardedChat?
    var effect: String?
    var cipher: String?
    var geo_lat: Double?
    var geo_lng: Double?
    var comments_count: Int?
    var views_count: Int?
    /// Локальная отметка: отправляется, сервера ещё не дождались.
    var pending: Bool? = nil

    struct Sticker: Codable, Hashable { var id: String; var file_url: String; var emoji: String? }

    var createdDate: Date { ISO8601.parse(created_at) ?? Date() }
    var senderId: String? { sender_id ?? sender?.id }
    var isImage: Bool {
        guard let n = (file_name ?? file_url)?.lowercased() else { return false }
        return [".png", ".jpg", ".jpeg", ".webp", ".gif", ".heic"].contains { n.hasSuffix($0) }
    }
    var isVideoFile: Bool {
        guard let n = (file_name ?? file_url)?.lowercased() else { return false }
        return [".mp4", ".mov", ".m4v", ".webm"].contains { n.hasSuffix($0) }
    }
    var preview: String {
        if let c = content, !c.isEmpty { return c }
        if sticker != nil { return "Стикер" }
        if video_url != nil { return "Видео-сообщение" }
        if voice_url != nil { return "Голосовое сообщение" }
        if isImage { return "Фото" }
        if file_url != nil { return file_name ?? "Файл" }
        return ""
    }
}

struct SyncResponse: Codable {
    var messages: [Message]
    var deleted: [String]
    var has_more: Bool?
    var now: String
}

struct UnreadCount: Codable {
    var total_unread: Int
    var unread_by_chat: [String: Int]
    var mention_by_chat: [String: Bool]?
}

struct StickerPack: Codable, Identifiable, Hashable {
    let id: String
    var name: String
    var stickers_count: Int?
    var preview: String?
    var is_saved: Bool?
}
struct StickerItem: Codable, Identifiable, Hashable { let id: String; var file_url: String; var emoji: String?; var pack: String? }

struct TokenPair: Codable { var access: String; var refresh: String }
struct UploadResult: Codable { var file_url: String; var file_name: String?; var file_size: Int?; var width: Int?; var height: Int?; var poster_url: String? }

enum ISO8601 {
    private static let withFrac: ISO8601DateFormatter = { let f = ISO8601DateFormatter(); f.formatOptions = [.withInternetDateTime, .withFractionalSeconds]; return f }()
    private static let plain: ISO8601DateFormatter = { let f = ISO8601DateFormatter(); f.formatOptions = [.withInternetDateTime]; return f }()
    static func parse(_ s: String) -> Date? { withFrac.date(from: s) ?? plain.date(from: s) }
    static func string(_ d: Date) -> String { withFrac.string(from: d) }
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

/// Пустой ответ сервера (204 или {}), когда тело не нужно.
struct Empty: Codable {}

final class API {
    static let shared = API()
    /// WYX_API в окружении — для симулятора через локальный прокси (у симулятора
    /// при VPN на Mac не работает DNS): SIMCTL_CHILD_WYX_API=http://127.0.0.1:8080
    let origin: URL = {
        if let s = ProcessInfo.processInfo.environment["WYX_API"], let u = URL(string: s), u.host != nil { return u }
        return URL(string: "https://huyax.e-tree.su")!
    }()
    var base: URL { origin.appendingPathComponent("api") }
    var wsBase: URL {
        var c = URLComponents(url: origin, resolvingAgainstBaseURL: false)!
        c.scheme = c.scheme == "https" ? "wss" : "ws"
        return c.url!.appendingPathComponent("ws")
    }

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

    // MARK: - Профиль и чаты

    func currentProfile() async throws -> Profile { try await get("profiles/current/") }
    func profile(_ id: String) async throws -> Profile { try await get("profiles/\(id)/") }
    func chats() async throws -> [Chat] { try await get("chats/") }
    func chat(_ id: String) async throws -> Chat { try await get("chats/\(id)/") }
    func savedChat() async throws -> Chat { try await get("chats/saved/") }
    func unreadCount() async throws -> UnreadCount { try await get("messages/unread_count/") }

    // MARK: - Сообщения

    func sync(chat: String, since: String? = nil, before: String? = nil, limit: Int = 60) async throws -> SyncResponse {
        var q = ["chat": chat]
        if let since { q["since"] = since } else { q["limit"] = String(limit) }
        if let before { q["before"] = before }
        return try await get("messages/sync/", query: q)
    }

    func send(chat: String, content: String, entities: [Entity] = [], replyTo: String? = nil) async throws -> Message {
        var body: [String: Any] = ["chat": chat, "content": content]
        if !entities.isEmpty { body["entities"] = entities.map { ["type": $0.type, "offset": $0.offset, "length": $0.length] } }
        if let replyTo { body["reply_to_id"] = replyTo }
        return try await post("messages/", body: body)
    }

    func sendFile(chat: String, upload: UploadResult, caption: String = "", replyTo: String? = nil) async throws -> Message {
        var body: [String: Any] = ["chat": chat, "content": caption, "file_url": upload.file_url,
                                   "file_name": upload.file_name ?? "file", "file_size": upload.file_size ?? 0]
        if let w = upload.width { body["file_width"] = w }
        if let h = upload.height { body["file_height"] = h }
        if let p = upload.poster_url { body["poster_url"] = p }
        if let replyTo { body["reply_to_id"] = replyTo }
        return try await post("messages/", body: body)
    }

    func sendVoice(chat: String, url: String, seconds: Int, replyTo: String? = nil) async throws -> Message {
        var body: [String: Any] = ["chat": chat, "voice_url": url, "voice_duration": seconds]
        if let replyTo { body["reply_to_id"] = replyTo }
        return try await post("messages/", body: body)
    }

    func sendSticker(chat: String, stickerId: String, replyTo: String? = nil) async throws -> Message {
        var body: [String: Any] = ["chat": chat, "content": NSNull(), "sticker_id": stickerId]
        if let replyTo { body["reply_to_id"] = replyTo }
        return try await post("messages/", body: body)
    }

    func edit(message: String, content: String, entities: [Entity]) async throws -> Message {
        try await post("messages/\(message)/edit/", body: ["content": content, "entities": entities.map { ["type": $0.type, "offset": $0.offset, "length": $0.length] }])
    }
    func remove(message: String, scope: String) async throws { let _: Empty = try await post("messages/\(message)/remove/", body: ["scope": scope]) }
    func pin(message: String, pin: Bool) async throws -> PinnedInfo? {
        struct R: Codable { var pinned_message: PinnedInfo? }
        let r: R = try await post("messages/\(message)/pin/", body: ["pin": pin]); return r.pinned_message
    }
    func react(message: String, emoji: String) async throws -> [Reaction] {
        struct R: Codable { var reactions: [Reaction] }
        let r: R = try await post("messages/\(message)/react/", body: ["emoji": emoji]); return r.reactions
    }
    func forward(message: String, to chat: String) async throws { let _: Empty = try await post("messages/\(message)/forward/", body: ["chat_id": chat]) }
    struct PressResult: Codable { var toast: String?; var toast_kind: String?; var open: String? }
    func press(message: String, data: String) async throws -> PressResult {
        try await post("messages/\(message)/press/", body: ["data": data, "caps": ["ideas_screen"]])
    }
    func markRead(chat: String) async { let _: Empty? = try? await post("messages/mark_chat_as_read/", body: ["chat_id": chat]) }

    func sendVideoNote(chat: String, url: String, seconds: Int, mirror: Bool, flip: Bool, replyTo: String? = nil) async throws -> Message {
        var body: [String: Any] = ["chat": chat, "video_url": url, "video_duration": seconds]
        if mirror { body["video_mirror"] = "1" }
        if flip { body["video_flip"] = "1" }
        if let replyTo { body["reply_to_id"] = replyTo }
        return try await post("messages/", body: body)
    }

    func sendLocation(chat: String, lat: Double, lng: Double, replyTo: String? = nil) async throws -> Message {
        var body: [String: Any] = ["chat": chat, "geo_lat": lat, "geo_lng": lng]
        if let replyTo { body["reply_to_id"] = replyTo }
        return try await post("messages/", body: body)
    }

    // MARK: - Секретные чаты

    func createSecretChat(peer: String, pub: String) async throws -> Chat {
        try await post("secret-chats/", body: ["peer_id": peer, "pub": pub, "device_id": Secret.deviceId])
    }
    func acceptSecretChat(_ chat: String, pub: String) async throws { let _: Empty = try await post("secret-chats/\(chat)/accept/", body: ["pub": pub, "device_id": Secret.deviceId]) }
    func declineSecretChat(_ chat: String) async throws { let _: Empty = try await post("secret-chats/\(chat)/decline/", body: [:]) }
    func sendSecret(chat: String, cipher: String, replyTo: String? = nil, fileURL: String? = nil, fileSize: Int? = nil) async throws -> Message {
        var body: [String: Any] = ["chat": chat, "cipher": cipher]
        if let replyTo { body["reply_to_id"] = replyTo }
        if let fileURL { body["file_url"] = fileURL; body["file_size"] = fileSize ?? 0 }
        return try await post("messages/", body: body)
    }
    func editSecret(message: String, cipher: String) async throws -> Message { try await post("messages/\(message)/edit/", body: ["cipher": cipher]) }

    // MARK: - Чаты: создание, участники

    func createChat(participants: [String], groupName: String? = nil) async throws -> Chat {
        var body: [String: Any] = ["participants": participants]
        if let groupName { body["is_group"] = true; body["name"] = groupName }
        return try await post("chats/", body: body)
    }
    func profileByUsername(_ username: String) async throws -> Profile { try await get("profiles/by-username/\(username)/") }
    func searchUsers(_ q: String) async throws -> [Profile] { try await get("profiles/", query: ["search": q]) }
    func participants(chat: String) async throws -> [Profile] { try await get("chats/\(chat)/participants/") }
    func addParticipants(chat: String, ids: [String]) async throws { let _: Empty = try await post("chats/\(chat)/add_participants/", body: ["participants": ids]) }
    func leaveChat(_ chat: String) async throws { let _: Empty = try await post("chats/\(chat)/leave/", body: [:]) }
    func pinChat(_ chat: String, pinned: Bool) async throws { let _: Empty = try await post("chats/\(chat)/pin/", body: ["pin": pinned]) }

    // MARK: - Каналы

    func channel(_ id: String) async throws -> Channel { try await get("channels/\(id)/") }
    func channelPosts(_ id: String, before: String? = nil, limit: Int = 30) async throws -> PostsResponse {
        var q = ["limit": String(limit)]; if let before { q["before"] = before }
        return try await get("channels/\(id)/posts/", query: q)
    }
    func reactPost(_ id: String, value: String) async throws { let _: Empty = try await post("posts/\(id)/react/", body: ["value": value]) }
    func unreactPost(_ id: String) async throws {
        var req = URLRequest(url: base.appendingPathComponent("posts/\(id)/react/")); req.httpMethod = "DELETE"
        let _: Empty = try await run(req)
    }
    func postComments(_ id: String) async throws -> [PostComment] { try await get("posts/\(id)/comments/") }
    func addComment(_ id: String, content: String) async throws { let _: Empty = try await post("posts/\(id)/comments/", body: ["content": content]) }
    func markPostView(_ id: String) async { let _: Empty? = try? await post("posts/\(id)/view/", body: [:]) }
    func subscribeChannel(_ id: String) async throws { let _: Empty = try await post("channels/\(id)/subscribe/", body: [:]) }
    func leaveChannel(_ id: String) async throws { let _: Empty = try await post("channels/\(id)/leave/", body: [:]) }
    func muteChannel(_ id: String, muted: Bool) async throws { let _: Empty = try await post("channels/\(id)/mute/", body: ["muted": muted]) }
    func discoverChannels(_ q: String) async throws -> [Channel] { try await get("channels/discover/", query: ["q": q]) }
    func createChannel(name: String, username: String?, description: String?) async throws -> Channel {
        var body: [String: Any] = ["name": name]
        if let username, !username.isEmpty { body["username"] = username }
        if let description, !description.isEmpty { body["description"] = description }
        return try await post("channels/", body: body)
    }

    // MARK: - Стикеры

    func myStickerPacks() async throws -> [StickerPack] { try await get("sticker-packs/my_packs/") }
    func stickers(pack: String? = nil) async throws -> [StickerItem] { try await get("stickers/", query: pack.map { ["pack": $0] } ?? [:]) }

    // MARK: - Загрузка файлов

    func upload(data: Data, name: String, mime: String, path: String = "upload/") async throws -> UploadResult {
        let boundary = "----wyx\(UUID().uuidString)"
        var req = URLRequest(url: base.appendingPathComponent(path))
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
        if T.self == Empty.self { return Empty() as! T }
        return try JSONDecoder().decode(T.self, from: data)
    }
}
