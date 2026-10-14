import Foundation
import Security

/// Язык интерфейса, выбранный в приложении (ru | en | ko), для текстов,
/// которые нативная часть формирует сама: меню форматирования, CallKit,
/// Spotlight, расширения «Поделиться» и уведомлений.
///
/// Страница сохраняет язык через плагин NativeLang (src/lib/nativeLang.ts).
/// Храним в двух местах, потому что доступ у расширений разный:
/// UserDefaults общей App Group видит расширение «Поделиться», а Keychain
/// общей группы — расширение уведомлений (у него нет App Group, только
/// Keychain, как у ключа пушей в PushSecretPlugin).
///
/// Файл входит во все три таргета, поэтому здесь только Foundation и Security.
/// Строки — в <lang>.lproj/Localizable.strings; русский текст передаётся
/// вторым аргументом и служит запасным, если ключа нет.
enum AppLang {
    static let supported = ["ru", "en", "ko"]

    private static let appGroup = "group.com.hyax.messenger"
    private static let defaultsKey = "hyax.lang"
    private static let keychainService = "com.hyax.messenger.lang"
    private static let keychainAccount = "lang"
    /// Та же группа, что у ключа пушей (см. entitlements App и NotificationService).
    private static let accessGroup = "BTQ69VVHX6.com.hyax.messenger.shared"

    /// Общие UserDefaults — только если у таргета есть App Group, иначе
    /// система молча подсунула бы локальные настройки расширения.
    private static var groupDefaults: UserDefaults? {
        guard FileManager.default.containerURL(forSecurityApplicationGroupIdentifier: appGroup) != nil else { return nil }
        return UserDefaults(suiteName: appGroup)
    }

    /// Язык, сохранённый приложением; nil — ещё не сохраняли.
    static var stored: String? {
        if let v = groupDefaults?.string(forKey: defaultsKey), supported.contains(v) { return v }
        if let v = readKeychain(), supported.contains(v) { return v }
        return nil
    }

    /// Текущий язык: выбранный в приложении, а до первой синхронизации —
    /// системный (как и веб-часть: ko, en, остальное — ru).
    static var current: String {
        return stored ?? system
    }

    static var system: String {
        let code = (Bundle.main.preferredLocalizations.first ?? Locale.preferredLanguages.first ?? "ru")
            .prefix(2).lowercased()
        return code == "ko" ? "ko" : code == "en" ? "en" : "ru"
    }

    static func set(_ lang: String) {
        guard supported.contains(lang) else { return }
        groupDefaults?.set(lang, forKey: defaultsKey)
        writeKeychain(lang)
    }

    /// Строка на текущем языке: ключ из Localizable.strings, ru — запасной текст.
    static func t(_ key: String, _ ru: String) -> String {
        guard let path = Bundle.main.path(forResource: current, ofType: "lproj"),
              let bundle = Bundle(path: path) else { return ru }
        return bundle.localizedString(forKey: key, value: ru, table: nil)
    }

    // MARK: - Пуши

    /// Служебные фразы, которые сервер кладёт в пуш по-русски
    /// (backend/chat/views.py, fcm.py). Порядок важен: длинные раньше коротких.
    private static let pushPhrases: [(ru: String, key: String)] = [
        ("Новое сообщение в секретном чате", "push.new_secret_message"),
        ("Новое сообщение", "push.new_message"),
        ("Голосовое сообщение", "push.voice_message"),
        ("Видео-сообщение", "push.video_message"),
        ("Стикер", "push.sticker"),
        ("Файл", "push.file"),
        ("📍 Геопозиция", "push.location"),
    ]

    /// Текст пуша: служебную фразу — на язык приложения. В группе сервер
    /// пишет «автор: фраза», поэтому переводим и хвост после «: ».
    static func pushBody(_ s: String) -> String {
        guard current != "ru" else { return s }
        for (ru, key) in pushPhrases {
            if s == ru { return t(key, ru) }
            if s.hasSuffix(": " + ru) { return String(s.dropLast(ru.count)) + t(key, ru) }
        }
        return s
    }

    /// Заголовок пуша: у группы без названия сервер пишет «Группа».
    static func pushTitle(_ s: String) -> String {
        guard current != "ru", s == "Группа" else { return s }
        return t("push.group", s)
    }

    // MARK: - Keychain

    private static func keychainQuery() -> [String: Any] {
        return [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: keychainService,
            kSecAttrAccount as String: keychainAccount,
            kSecAttrAccessGroup as String: accessGroup,
        ]
    }

    private static func readKeychain() -> String? {
        var q = keychainQuery()
        q[kSecReturnData as String] = true
        q[kSecMatchLimit as String] = kSecMatchLimitOne
        var out: AnyObject?
        guard SecItemCopyMatching(q as CFDictionary, &out) == errSecSuccess,
              let data = out as? Data else { return nil }
        return String(data: data, encoding: .utf8)
    }

    /// Пуш может прийти на заблокированный телефон — поэтому, как у ключа
    /// пушей, запись доступна после первой разблокировки (AfterFirstUnlock).
    private static func writeKeychain(_ lang: String) {
        let data = Data(lang.utf8)
        let q = keychainQuery()
        let status = SecItemUpdate(q as CFDictionary, [kSecValueData as String: data] as CFDictionary)
        if status == errSecItemNotFound {
            var add = q
            add[kSecValueData as String] = data
            add[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlock
            SecItemAdd(add as CFDictionary, nil)
        }
    }
}
