import Foundation
import Capacitor
import Security
import UserNotifications

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
