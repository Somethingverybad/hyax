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
            // id сообщения: удалят его — приложение уберёт это уведомление (message_deleted).
            if let m = payload["message_id"] as? String, !m.isEmpty {
                var info = content.userInfo
                info["message_id"] = m
                content.userInfo = info
            }
        }
        // Служебные фразы сервер пишет по-русски («Новое сообщение», «Новое
        // сообщение в секретном чате», «Стикер»…), и заглушка остаётся, если
        // расшифровать не вышло, — подставляем их на языке приложения (AppLang).
        content.title = AppLang.pushTitle(content.title)
        content.body = AppLang.pushBody(content.body)
        // Свой звук отправителя: нет файла — докачиваем и только потом
        // показываем (LazySound). Не вышло — сыграет то, что в пуше (обычно
        // стандартный звук).
        LazySound.attach(to: content, info: request.content.userInfo) { [weak self] in
            self?.deliver()
        }
    }

    private func deliver() {
        guard let handler = handler, let content = content else { return }
        self.handler = nil
        handler(content)
    }

    override func serviceExtensionTimeWillExpire() {
        deliver()
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

/// Звук уведомления по требованию. Раньше приложение заранее качало в
/// Library/Sounds весь каталог публичных паков (десятки мегабайт у каждого),
/// хотя большинство звуков человеку никто никогда не пришлёт. Теперь сервер
/// кладёт в пуш путь к файлу (snd, snd_caf, snd_v — chat/fcm.py sound_fields),
/// а здесь файл докачивается в общую папку App Group (Library/Sounds там iOS
/// тоже ищет) и пуш показывается уже с ним. Хранятся последние звуки, старые
/// вытесняются.
enum LazySound {
    static let group = "group.com.hyax.messenger"
    /// Адреса по очереди: CDN, затем сервер напрямую под двумя именами.
    static let origins = ["https://cdn.hyax.ru", "https://hyax.ru", "https://huyax.e-tree.su"]
    static let maxFiles = 40
    static let maxBytes = 15 * 1024 * 1024

    static var dir: URL? {
        FileManager.default.containerURL(forSecurityApplicationGroupIdentifier: group)?
            .appendingPathComponent("Library/Sounds", isDirectory: true)
    }

    static func attach(to content: UNMutableNotificationContent, info: [AnyHashable: Any], done: @escaping () -> Void) {
        // Без звука (тихое сообщение) — ничего не трогаем.
        guard content.sound != nil,
              let slug = info["snd"] as? String, !slug.isEmpty,
              let path = info["snd_caf"] as? String, path.hasPrefix("/"),
              let dir = dir else { done(); return }
        let version = (info["snd_v"] as? String) ?? "0"
        let safe = slug.filter { $0.isLetter || $0.isNumber || $0 == "-" || $0 == "_" }
        let name = "\(safe)-\(version).caf"
        let file = dir.appendingPathComponent(name)
        if FileManager.default.fileExists(atPath: file.path) {
            // Свежая отметка — чтобы при вытеснении он ушёл последним.
            try? FileManager.default.setAttributes([.modificationDate: Date()], ofItemAtPath: file.path)
            content.sound = UNNotificationSound(named: UNNotificationSoundName(rawValue: name))
            done()
            return
        }
        LazySound.download(path: path, origins: origins) { data in
            if let data = data, data.count > 0 {
                try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
                if (try? data.write(to: file, options: .atomic)) != nil {
                    content.sound = UNNotificationSound(named: UNNotificationSoundName(rawValue: name))
                    LazySound.trim(dir: dir, keep: name)
                }
            }
            done()
        }
    }

    private static func download(path: String, origins: [String], done: @escaping (Data?) -> Void) {
        guard let origin = origins.first, let url = URL(string: origin + path) else { done(nil); return }
        var req = URLRequest(url: url)
        req.timeoutInterval = 7
        URLSession.shared.dataTask(with: req) { data, resp, _ in
            if let data = data, (resp as? HTTPURLResponse)?.statusCode == 200, data.count > 0 {
                done(data)
            } else {
                LazySound.download(path: path, origins: Array(origins.dropFirst()), done: done)
            }
        }.resume()
    }

    /// Не больше maxFiles файлов и maxBytes байт: вытесняем давно не звучавшие.
    private static func trim(dir: URL, keep: String) {
        let keys: [URLResourceKey] = [.contentModificationDateKey, .fileSizeKey]
        guard var list = try? FileManager.default.contentsOfDirectory(at: dir, includingPropertiesForKeys: keys) else { return }
        list.sort {
            let a = (try? $0.resourceValues(forKeys: Set(keys)).contentModificationDate) ?? .distantPast
            let b = (try? $1.resourceValues(forKeys: Set(keys)).contentModificationDate) ?? .distantPast
            return a > b
        }
        var total = 0
        for (i, f) in list.enumerated() {
            total += (try? f.resourceValues(forKeys: Set(keys)).fileSize) ?? 0
            if f.lastPathComponent != keep && (i >= maxFiles || total > maxBytes) {
                try? FileManager.default.removeItem(at: f)
            }
        }
    }
}
