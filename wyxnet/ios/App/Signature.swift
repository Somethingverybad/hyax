// Проверка подписи профиля: Ed25519 по байтам строки payload (backend/chat/vpn.py).
// Публичный ключ зашит сюда — подменить список узлов через провайдера или CDN нельзя.
import CryptoKit
import Foundation

enum Pinned {
    /// base64 публичного ключа сервера (manage.py vpn_pubkey). nil — отладочная сборка:
    /// принимаем ключ из ответа и пишем предупреждение в журнал.
    static let publicKey: String? = nil
    static let apiBase = "https://hyax.ru/api"
}

enum Signature {
    enum Failure: Error, LocalizedError {
        case missing, badKey, mismatch, invalid
        var errorDescription: String? {
            switch self {
            case .missing: return "Ответ сервера без подписи"
            case .badKey: return "Ключ подписи не разобран"
            case .mismatch: return "Ключ подписи не совпадает с зашитым в приложение"
            case .invalid: return "Подпись профиля не сходится"
            }
        }
    }

    /// Возвращает предупреждение (nil — всё строго в порядке) или бросает ошибку.
    static func verify(payload: String, sig: String, pub: String) throws -> String? {
        var warning: String?
        let expected: String
        if let pinned = Pinned.publicKey {
            expected = pinned
            if pub != pinned { throw Failure.mismatch }
        } else {
            if sig.isEmpty { return "Профиль без подписи (сервер без ключа) — отладка" }
            expected = pub
            warning = "Ключ подписи не зашит в сборку — принят ключ сервера (отладка)"
        }
        guard !sig.isEmpty else { throw Failure.missing }
        guard let pubData = Data(base64Encoded: expected), let sigData = Data(base64Encoded: sig),
              let key = try? Curve25519.Signing.PublicKey(rawRepresentation: pubData) else { throw Failure.badKey }
        guard key.isValidSignature(sigData, for: Data(payload.utf8)) else { throw Failure.invalid }
        return warning
    }
}
