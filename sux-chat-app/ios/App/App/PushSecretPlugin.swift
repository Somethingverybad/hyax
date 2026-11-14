import Foundation
import Capacitor
import Security
import UserNotifications
import UIKit
import CryptoKit
import FirebaseMessaging

/// Ключ шифрования пушей: 32 случайных байта, живут в Keychain в группе,
/// общей с расширением уведомлений (оно расшифровывает текст пуша до показа).
/// Страница получает ключ и регистрирует его вместе с FCM-токеном.
enum PushSecret {
    static let service = "com.hyax.messenger.push"
    static let account = "secret"
    /// Группа доступа: <TeamID>.com.hyax.messenger.shared (см. entitlements обоих таргетов).
    static let accessGroup = "BTQ69VVHX6.com.hyax.messenger.shared"

    static func query() -> [String: Any] {
        return [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account,
            kSecAttrAccessGroup as String: accessGroup,
        ]
    }

    static func read() -> Data? {
        var q = query()
        q[kSecReturnData as String] = true
        q[kSecMatchLimit as String] = kSecMatchLimitOne
        var out: AnyObject?
        let status = SecItemCopyMatching(q as CFDictionary, &out)
        return status == errSecSuccess ? out as? Data : nil
    }

    /// Ключ, а при первом обращении — новый. Доступен и после перезагрузки до
    /// разблокировки (AfterFirstUnlock): пуш может прийти на заблокированный телефон.
    static func getOrCreate() -> Data? {
        if let d = read() { return d }
        var raw = [UInt8](repeating: 0, count: 32)
        guard SecRandomCopyBytes(kSecRandomDefault, raw.count, &raw) == errSecSuccess else { return nil }
        let data = Data(raw)
        var q = query()
        q[kSecValueData as String] = data
        q[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlock
        let status = SecItemAdd(q as CFDictionary, nil)
        return status == errSecSuccess ? data : read()
    }
}

@objc(PushSecretPlugin)
public class PushSecretPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "PushSecretPlugin"
    public let jsName = "PushSecret"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "get", returnType: CAPPluginReturnPromise),
    ]

    @objc func get(_ call: CAPPluginCall) {
        guard let d = PushSecret.getOrCreate() else { call.reject("keychain"); return }
        call.resolve(["secret": d.base64EncodedString()])
    }
}

/// Уведомления о сообщениях по чатам. Расширение (NotificationService) кладёт
/// chat_id в userInfo и threadIdentifier — по нему прочитанный чат убирает
/// свои: на этом устройстве (ChatNotificationsPlugin) и по тихому пушу
/// chat_read, когда прочитали на другом (AppDelegate).
enum ChatNotifs {
    static func chatId(_ n: UNNotification) -> String? {
        let c = n.request.content
        if let id = c.userInfo["chat_id"] as? String, !id.isEmpty { return id }
        return c.threadIdentifier.isEmpty ? nil : c.threadIdentifier
    }

    /// Удалили сообщение — убрать его уведомление (id кладёт расширение в userInfo).
    static func removeMessage(_ messageId: String, done: (() -> Void)? = nil) {
        guard !messageId.isEmpty else { done?(); return }
        let center = UNUserNotificationCenter.current()
        center.getDeliveredNotifications { list in
            let ids = list.filter { ($0.request.content.userInfo["message_id"] as? String) == messageId }.map { $0.request.identifier }
            if !ids.isEmpty { center.removeDeliveredNotifications(withIdentifiers: ids) }
            done?()
        }
    }

    static func remove(_ chatIds: Set<String>, done: (() -> Void)? = nil) {
        guard !chatIds.isEmpty else { done?(); return }
        let center = UNUserNotificationCenter.current()
        center.getDeliveredNotifications { list in
            let ids = list.filter { chatId($0).map { chatIds.contains($0) } ?? false }.map { $0.request.identifier }
            if !ids.isEmpty { center.removeDeliveredNotifications(withIdentifiers: ids) }
            done?()
        }
    }
}

@objc(ChatNotificationsPlugin)
public class ChatNotificationsPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "ChatNotificationsPlugin"
    public let jsName = "ChatNotifications"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "dismiss", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "list", returnType: CAPPluginReturnPromise),
    ]

    @objc func dismiss(_ call: CAPPluginCall) {
        let ids = Set((call.getArray("chatIds") ?? []).compactMap { $0 as? String })
        ChatNotifs.remove(ids) { call.resolve() }
    }

    @objc func list(_ call: CAPPluginCall) {
        UNUserNotificationCenter.current().getDeliveredNotifications { list in
            call.resolve(["chatIds": Array(Set(list.compactMap { ChatNotifs.chatId($0) }))])
        }
    }
}

/// Ответ прямо из уведомления: кнопка «Ответить» под пушем лички и группы.
/// Категорию MSG пушу ставит сервер (fcm.py, поле reply=1). Текст уходит на
/// сервер отсюда, без страницы: приложение могло быть выгружено, и токена
/// входа у нативной части нет. Подпись — ключом пушей этого устройства
/// (PushSecret), сервер знает его только для него (backend chat/push_reply.py).
enum PushReply {
    static let category = "MSG"
    static let action = "REPLY"
    /// Прямо на сервер, мимо CDN: POST он не кэширует, но и ждать его незачем.
    static let hosts = ["https://huyax.e-tree.su", "https://hyax.ru"]
    /// Роутер Capacitor держит обработчик слабой ссылкой — держим сами.
    private static var handler: PushReplyHandler?

    /// Кнопки уведомлений — на языке приложения; при смене языка — заново.
    static func registerCategories() {
        let reply = UNTextInputNotificationAction(
            identifier: action,
            title: AppLang.t("push.reply", "Ответить"),
            options: [],
            textInputButtonTitle: AppLang.t("push.reply.send", "Отправить"),
            textInputPlaceholder: AppLang.t("push.reply.placeholder", "Сообщение"))
        let cat = UNNotificationCategory(identifier: category, actions: [reply], intentIdentifiers: [], options: [])
        UNUserNotificationCenter.current().setNotificationCategories([cat])
    }

    /// Встать перед обработчиком пушей Firebase: «Ответить» разбираем сами,
    /// остальное (тап по уведомлению — открыть чат) отдаём ему как было.
    /// Зовётся из capacitorDidLoad — плагины к этому времени уже загружены.
    static func install(_ router: NotificationRouter) {
        if router.pushNotificationHandler is PushReplyHandler { return }
        let h = PushReplyHandler(inner: router.pushNotificationHandler)
        handler = h
        router.pushNotificationHandler = h
    }

    static func send(chatId: String, text: String, completion: @escaping (Bool) -> Void) {
        guard let secret = PushSecret.read(), let token = Messaging.messaging().fcmToken, !token.isEmpty else {
            completion(false); return
        }
        let ts = Int(Date().timeIntervalSince1970)
        let mac = HMAC<SHA256>.authenticationCode(for: Data("\(token)\n\(chatId)\n\(ts)\n\(text)".utf8),
                                                  using: SymmetricKey(data: secret))
        let body: [String: Any] = ["token": token, "chat_id": chatId, "text": text, "ts": ts,
                                   "sig": Data(mac).base64EncodedString()]
        guard let json = try? JSONSerialization.data(withJSONObject: body) else { completion(false); return }
        post(json, host: 0, completion: completion)
    }

    private static func post(_ json: Data, host i: Int, completion: @escaping (Bool) -> Void) {
        guard i < hosts.count, let url = URL(string: hosts[i] + "/api/push/reply/") else { completion(false); return }
        var req = URLRequest(url: url, timeoutInterval: 12)
        req.httpMethod = "POST"
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        req.httpBody = json
        URLSession.shared.dataTask(with: req) { _, resp, err in
            let code = (resp as? HTTPURLResponse)?.statusCode ?? 0
            // 409 — эта подпись уже принята: первый запрос дошёл, ответ потерялся.
            if code == 201 || code == 409 { completion(true); return }
            // Сеть или сервер — пробуем следующий адрес; отказ (4xx) — нет смысла.
            if err != nil || code == 0 || code >= 500 { post(json, host: i + 1, completion: completion); return }
            completion(false)
        }.resume()
    }

    /// Не ушло — сказать об этом и оставить текст, чтобы не пропал.
    static func notifyFailed(_ text: String, chatId: String) {
        let c = UNMutableNotificationContent()
        c.title = AppLang.t("push.reply.failed", "Ответ не отправлен")
        c.body = text
        c.userInfo = ["chat_id": chatId]
        c.threadIdentifier = chatId
        UNUserNotificationCenter.current().add(
            UNNotificationRequest(identifier: "reply-failed-\(UUID().uuidString)", content: c, trigger: nil))
    }
}

final class PushReplyHandler: NSObject, NotificationHandlerProtocol {
    private let inner: NotificationHandlerProtocol?
    init(inner: NotificationHandlerProtocol?) { self.inner = inner }

    func willPresent(notification: UNNotification) -> UNNotificationPresentationOptions {
        return inner?.willPresent(notification: notification) ?? []
    }

    func didReceive(response: UNNotificationResponse) {
        guard response.actionIdentifier == PushReply.action, let r = response as? UNTextInputNotificationResponse else {
            inner?.didReceive(response: response)
            return
        }
        let text = r.userText.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !text.isEmpty, let chat = ChatNotifs.chatId(response.notification) else { return }
        // Приложение разбудили в фоне ради ответа: держим его, пока запрос не дойдёт.
        var task = UIBackgroundTaskIdentifier.invalid
        let finish = {
            if task != .invalid { UIApplication.shared.endBackgroundTask(task); task = .invalid }
        }
        task = UIApplication.shared.beginBackgroundTask(withName: "push-reply") { finish() }
        PushReply.send(chatId: chat, text: text) { ok in
            DispatchQueue.main.async {
                if ok {
                    // Ответил — значит, прочитал: остальные уведомления этого чата долой.
                    ChatNotifs.remove([chat]) { DispatchQueue.main.async(execute: finish) }
                } else {
                    PushReply.notifyFailed(text, chatId: chat)
                    finish()
                }
            }
        }
    }
}
