// Связь с сервером WYX: вход по аккаунту мессенджера (JWT), профиль узлов, отчёты.
// Сам сервер (hyax.ru) из России доступен — через него клиент и узнаёт, куда ходить.
import Foundation

struct APIError: LocalizedError {
    let message: String
    var unauthorized = false
    var errorDescription: String? { message }
}

final class API {
    static let shared = API()
    private let keychain = Keychain(service: "com.hyax.wyxnet")
    private let session: URLSession = {
        let c = URLSessionConfiguration.ephemeral
        c.timeoutIntervalForRequest = 20
        c.waitsForConnectivity = false
        return URLSession(configuration: c)
    }()

    var base: URL { URL(string: UserDefaults.standard.string(forKey: "apiBase") ?? Pinned.apiBase)! }
    var access: String? { get { keychain["access"] } set { keychain["access"] = newValue } }
    var refresh: String? { get { keychain["refresh"] } set { keychain["refresh"] = newValue } }
    var username: String? {
        get { UserDefaults.standard.string(forKey: "username") }
        set { UserDefaults.standard.set(newValue, forKey: "username") }
    }
    var isLoggedIn: Bool { refresh != nil }

    static var version: String {
        let i = Bundle.main.infoDictionary
        return "\(i?["CFBundleShortVersionString"] ?? "?") (\(i?["CFBundleVersion"] ?? "?"))"
    }
    static var appTag: String { "ios \(version)" }

    var deviceId: String {
        if let d = UserDefaults.standard.string(forKey: "deviceId") { return d }
        let d = "wyxnet-" + UUID().uuidString.lowercased()
        UserDefaults.standard.set(d, forKey: "deviceId")
        return d
    }

    // MARK: вход

    func login(username: String, password: String) async throws {
        let body: [String: Any] = [
            "username": username, "password": password,
            "device_id": deviceId, "device_name": "WYX Net · iPhone",
            "platform": "ios", "app_version": API.version,
        ]
        let (data, resp) = try await send(path: "token/", method: "POST", body: body, auth: false)
        let obj = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any]
        guard resp.statusCode == 200, let a = obj?["access"] as? String, let r = obj?["refresh"] as? String else {
            throw APIError(message: API.detail(obj) ?? "Не удалось войти (\(resp.statusCode))")
        }
        access = a
        refresh = r
        self.username = username
    }

    func logout() {
        access = nil
        refresh = nil
        username = nil
    }

    private func refreshTokens() async throws {
        guard let r = refresh else { throw APIError(message: "Нужно войти", unauthorized: true) }
        let (data, resp) = try await send(path: "token/refresh/", method: "POST", body: ["refresh": r], auth: false)
        let obj = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any]
        guard resp.statusCode == 200, let a = obj?["access"] as? String else {
            if resp.statusCode == 401 || resp.statusCode == 400 { logout(); throw APIError(message: "Сеанс истёк — войдите снова", unauthorized: true) }
            throw APIError(message: API.detail(obj) ?? "Не удалось обновить сеанс (\(resp.statusCode))")
        }
        access = a
        if let nr = obj?["refresh"] as? String { refresh = nr }
    }

    // MARK: профиль и отчёты

    struct SignedProfile { let payload: String; let sig: String; let pub: String }

    func fetchProfile() async throws -> SignedProfile {
        let (data, resp) = try await authorized(path: "vpn/profile/", method: "GET")
        let obj = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any]
        guard resp.statusCode == 200 else {
            throw APIError(message: API.detail(obj) ?? "Профиль не получен (\(resp.statusCode))")
        }
        guard let payload = obj?["payload"] as? String else { throw APIError(message: "Профиль в неожиданном виде") }
        return SignedProfile(payload: payload, sig: obj?["sig"] as? String ?? "", pub: obj?["pub"] as? String ?? "")
    }

    func report(_ events: [[String: Any]]) async throws -> Int {
        let (data, resp) = try await authorized(path: "vpn/report/", method: "POST", body: ["events": events])
        let obj = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any]
        guard resp.statusCode == 200 else { throw APIError(message: API.detail(obj) ?? "Отчёт не принят (\(resp.statusCode))") }
        return obj?["saved"] as? Int ?? 0
    }

    // MARK: низкий уровень

    private func authorized(path: String, method: String, body: [String: Any]? = nil) async throws -> (Data, HTTPURLResponse) {
        if access == nil { try await refreshTokens() }
        var (data, resp) = try await send(path: path, method: method, body: body, auth: true)
        if resp.statusCode == 401 {
            try await refreshTokens()
            (data, resp) = try await send(path: path, method: method, body: body, auth: true)
            if resp.statusCode == 401 { logout(); throw APIError(message: "Сеанс истёк — войдите снова", unauthorized: true) }
        }
        return (data, resp)
    }

    private func send(path: String, method: String, body: [String: Any]?, auth: Bool) async throws -> (Data, HTTPURLResponse) {
        var req = URLRequest(url: base.appendingPathComponent(path))
        req.httpMethod = method
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        req.setValue("application/json", forHTTPHeaderField: "Accept")
        req.setValue(API.appTag, forHTTPHeaderField: "X-WYX-App")
        req.setValue("WYXNet/\(API.version) iOS", forHTTPHeaderField: "User-Agent")
        if auth, let a = access { req.setValue("Bearer \(a)", forHTTPHeaderField: "Authorization") }
        if let body { req.httpBody = try JSONSerialization.data(withJSONObject: body) }
        do {
            let (data, resp) = try await session.data(for: req)
            guard let http = resp as? HTTPURLResponse else { throw APIError(message: "Странный ответ сервера") }
            return (data, http)
        } catch let e as APIError {
            throw e
        } catch {
            throw APIError(message: "Сервер недоступен: \(error.localizedDescription)")
        }
    }

    private static func detail(_ obj: [String: Any]?) -> String? {
        if let d = obj?["detail"] as? String { return d }
        if let d = obj?["error"] as? String { return d }
        if let d = obj?["non_field_errors"] as? [String] { return d.joined(separator: " ") }
        return nil
    }
}
