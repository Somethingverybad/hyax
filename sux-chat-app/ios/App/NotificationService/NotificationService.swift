import UserNotifications
import CryptoKit
import Security

/// Расширение уведомлений: пуш приходит с заглушкой «Новое сообщение» и
/// шифрованным полем e (AES-256-GCM ключом устройства, blob = nonce ‖ ct ‖ tag).
/// Ключ лежит в Keychain в общей группе (см. PushSecretPlugin в приложении).
/// Расшифровали — подставили имя и текст; нет — система покажет заглушку.
class NotificationService: UNNotificationServiceExtension {
    var handler: ((UNNotificationContent) -> Void)?
    var content: UNMutableNotificationContent?

    override func didReceive(_ request: UNNotificationRequest, withContentHandler contentHandler: @escaping (UNNotificationContent) -> Void) {
        handler = contentHandler
        content = (request.content.mutableCopy() as? UNMutableNotificationContent)
        guard let content = content else { contentHandler(request.content); return }
        if let blob = request.content.userInfo["e"] as? String,
           let payload = decrypt(blob) {
            if let t = payload["title"] as? String, !t.isEmpty { content.title = t }
            if let b = payload["body"] as? String, !b.isEmpty { content.body = b }
            if let c = payload["chat_id"] as? String, !c.isEmpty {
                content.threadIdentifier = c
                var info = content.userInfo
                info["chat_id"] = c
                content.userInfo = info
            }
        }
        contentHandler(content)
    }

    override func serviceExtensionTimeWillExpire() {
        if let handler = handler, let content = content { handler(content) }
    }

    private func decrypt(_ blobB64: String) -> [String: Any]? {
        guard let key = keychainSecret(), let blob = Data(base64Encoded: blobB64), blob.count > 12 + 16 else { return nil }
        do {
            let nonce = try AES.GCM.Nonce(data: blob.prefix(12))
            let rest = blob.dropFirst(12)
            let box = try AES.GCM.SealedBox(nonce: nonce, ciphertext: rest.dropLast(16), tag: rest.suffix(16))
            let plain = try AES.GCM.open(box, using: SymmetricKey(data: key))
            return try JSONSerialization.jsonObject(with: plain) as? [String: Any]
        } catch {
            return nil
        }
    }

    private func keychainSecret() -> Data? {
        let q: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: "com.hyax.messenger.push",
            kSecAttrAccount as String: "secret",
            kSecAttrAccessGroup as String: "BTQ69VVHX6.com.hyax.messenger.shared",
            kSecReturnData as String: true,
            kSecMatchLimit as String: kSecMatchLimitOne,
        ]
        var out: AnyObject?
        return SecItemCopyMatching(q as CFDictionary, &out) == errSecSuccess ? out as? Data : nil
    }
}
