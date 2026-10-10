import Foundation
import CryptoKit
import Security

// Секретные чаты — байт в байт с sux-chat-app/src/lib/secret.ts:
// ECDH P-256 (открытый ключ — raw/x963, 65 байт) → HKDF-SHA-256 (соль — id
// чата, info «whoyax-secret-v1») → AES-256-GCM. Сообщение: base64(iv[12] ‖
// шифротекст ‖ тег[16]), внутри JSON {t, e, m}. Ключи — в Keychain этого
// устройства, на сервер не уходят; выход из аккаунта их стирает.

struct SecretInfo: Codable, Hashable {
    var state: String            // pending | active | declined
    var initiator_id: String
    var initiator_device: String?
    var initiator_pub: String
    var responder_device: String?
    var responder_pub: String?
    var accepted_at: String?
}

struct SecretMedia: Codable, Hashable {
    var k: String                // image | video | audio | file | voice | round
    var key: String
    var iv: String
    var mime: String
    var name: String
    var size: Int
    var w: Int?
    var h: Int?
    var dur: Int?
    var mi: Bool?
    var fl: Bool?
    var th: String?
}

struct SecretPayload: Codable, Hashable {
    var t: String
    var e: [Entity]?
    var m: SecretMedia?
}

enum Secret {
    private static let info = Data("whoyax-secret-v1".utf8)

    static var deviceId: String {
        let k = "hyax:device-id"
        if let s = UserDefaults.standard.string(forKey: k) { return s }
        let id = UUID().uuidString.lowercased()
        UserDefaults.standard.set(id, forKey: k)
        return id
    }

    /// Запись о чате в Keychain: своя открытая половина, закрытая (пока чат не
    /// принят) и общий ключ с отпечатком (когда вычислен).
    private struct Entry: Codable { var myPub: String; var priv: Data?; var key: Data?; var fp: String? }

    static func newKeyPair() -> (priv: P256.KeyAgreement.PrivateKey, pub: String) {
        let k = P256.KeyAgreement.PrivateKey()
        return (k, k.publicKey.x963Representation.base64EncodedString())
    }

    static func rememberPending(chatId: String, priv: P256.KeyAgreement.PrivateKey, myPub: String) {
        Keychain.set(Entry(myPub: myPub, priv: priv.rawRepresentation, key: nil, fp: nil), for: chatId)
    }

    static func hasLocalHalf(chatId: String) -> Bool { Keychain.get(Entry.self, for: chatId) != nil }

    /// Ключ чата на этом устройстве. Чат активен, а ключ ещё не вычислен —
    /// вычисляем из своей закрытой половины и открытой собеседника, храним.
    static func chatKey(chatId: String, info: SecretInfo?, myId: String) -> (key: SymmetricKey, fp: String)? {
        guard let info, var e = Keychain.get(Entry.self, for: chatId) else { return nil }
        if let k = e.key, let fp = e.fp { return (SymmetricKey(data: k), fp) }
        guard info.state == "active", let privRaw = e.priv, let priv = try? P256.KeyAgreement.PrivateKey(rawRepresentation: privRaw) else { return nil }
        let mine = info.initiator_id == myId ? info.initiator_pub : (info.responder_pub ?? "")
        guard mine == e.myPub else { return nil } // чат принят на другом устройстве
        let peerPub = info.initiator_id == myId ? (info.responder_pub ?? "") : info.initiator_pub
        guard let key = derive(chatId: chatId, priv: priv, peerPub: peerPub) else { return nil }
        let fp = fingerprint(chatId: chatId, info.initiator_pub, info.responder_pub ?? "")
        e.key = key.withUnsafeBytes { Data($0) }; e.fp = fp; e.priv = nil
        Keychain.set(e, for: chatId)
        return (key, fp)
    }

    private static func derive(chatId: String, priv: P256.KeyAgreement.PrivateKey, peerPub: String) -> SymmetricKey? {
        guard let raw = Data(base64Encoded: peerPub), let peer = try? P256.KeyAgreement.PublicKey(x963Representation: raw),
              let shared = try? priv.sharedSecretFromKeyAgreement(with: peer) else { return nil }
        // WebCrypto deriveBits(256) — это X-координата; у CryptoKit SharedSecret то же самое.
        return shared.hkdfDerivedSymmetricKey(using: SHA256.self, salt: Data(chatId.utf8), sharedInfo: info, outputByteCount: 32)
    }

    static func fingerprint(chatId: String, _ a: String, _ b: String) -> String {
        let s = [a, b].sorted()
        let h = SHA256.hash(data: Data("\(chatId)|\(s[0])|\(s[1])".utf8))
        let hex = h.prefix(16).map { String(format: "%02X", $0) }.joined()
        return stride(from: 0, to: hex.count, by: 4).map { i in
            let st = hex.index(hex.startIndex, offsetBy: i); return String(hex[st..<hex.index(st, offsetBy: 4)])
        }.joined(separator: " ")
    }

    private static let emoji = Array("🍎🍊🍋🍉🍇🍓🍒🥝🥥🥑🌶🌽🥕🍄🌰🍞🧀🍕🌮🍩🍪🎂🍫🍬🍯☕🍵🥤🐶🐱🐭🐹🐰🦊🐻🐼🐨🐯🦁🐮🐷🐸🐵🐔🐧🐦🦆🦉🐺🐗🐴🦄🐝🐛🦋🐌🐞🐢🐍🐙🦀🐠🐬🐳")
    static func fingerprintEmoji(_ fp: String) -> String {
        let hex = fp.replacingOccurrences(of: " ", with: "")
        var bytes: [Int] = []
        var i = hex.startIndex
        while i < hex.endIndex, let j = hex.index(i, offsetBy: 2, limitedBy: hex.endIndex) { bytes.append(Int(hex[i..<j], radix: 16) ?? 0); i = j }
        return bytes.prefix(8).map { String(emoji[$0 % emoji.count]) }.joined(separator: " ")
    }

    // MARK: сообщения и файлы

    static func encryptPayload(key: SymmetricKey, _ p: SecretPayload) -> String? {
        guard let json = try? JSONEncoder().encode(p), let box = try? AES.GCM.seal(json, using: key) else { return nil }
        return (box.nonce.withUnsafeBytes { Data($0) } + box.ciphertext + box.tag).base64EncodedString()
    }

    static func decryptPayload(key: SymmetricKey, _ cipher: String) -> SecretPayload? {
        guard let all = Data(base64Encoded: cipher), all.count > 28,
              let nonce = try? AES.GCM.Nonce(data: all.prefix(12)),
              let box = try? AES.GCM.SealedBox(nonce: nonce, ciphertext: all.dropFirst(12).dropLast(16), tag: all.suffix(16)),
              let pt = try? AES.GCM.open(box, using: key) else { return nil }
        return try? JSONDecoder().decode(SecretPayload.self, from: pt)
    }

    /// Файл шифруется своим случайным ключом; ключ и iv уходят внутри сообщения.
    static func encryptFile(_ data: Data) -> (data: Data, key: String, iv: String)? {
        let key = SymmetricKey(size: .bits256)
        let nonce = AES.GCM.Nonce()
        guard let box = try? AES.GCM.seal(data, using: key, nonce: nonce) else { return nil }
        return (box.ciphertext + box.tag, key.withUnsafeBytes { Data($0) }.base64EncodedString(), nonce.withUnsafeBytes { Data($0) }.base64EncodedString())
    }

    static func decryptFile(_ data: Data, media: SecretMedia) -> Data? {
        guard let k = Data(base64Encoded: media.key), let ivd = Data(base64Encoded: media.iv), data.count > 16,
              let nonce = try? AES.GCM.Nonce(data: ivd),
              let box = try? AES.GCM.SealedBox(nonce: nonce, ciphertext: data.dropLast(16), tag: data.suffix(16)) else { return nil }
        return try? AES.GCM.open(box, using: SymmetricKey(data: k))
    }

    static func wipe() { Keychain.clear() }
}

/// Минимальная обёртка Keychain: по одной записи на чат.
enum Keychain {
    private static let service = "com.hyax.wyx.secret"
    static func set<T: Encodable>(_ v: T, for account: String) {
        guard let d = try? JSONEncoder().encode(v) else { return }
        let q: [String: Any] = [kSecClass as String: kSecClassGenericPassword, kSecAttrService as String: service, kSecAttrAccount as String: account]
        SecItemDelete(q as CFDictionary)
        var add = q; add[kSecValueData as String] = d; add[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
        SecItemAdd(add as CFDictionary, nil)
    }
    static func get<T: Decodable>(_ t: T.Type, for account: String) -> T? {
        let q: [String: Any] = [kSecClass as String: kSecClassGenericPassword, kSecAttrService as String: service, kSecAttrAccount as String: account,
                                kSecReturnData as String: true, kSecMatchLimit as String: kSecMatchLimitOne]
        var out: AnyObject?
        guard SecItemCopyMatching(q as CFDictionary, &out) == errSecSuccess, let d = out as? Data else { return nil }
        return try? JSONDecoder().decode(T.self, from: d)
    }
    static func clear() {
        SecItemDelete([kSecClass as String: kSecClassGenericPassword, kSecAttrService as String: service] as CFDictionary)
    }
}
