import UIKit
import UserNotifications
import Security
#if canImport(FirebaseCore)
import FirebaseCore
import FirebaseMessaging
#endif

/// Пуши — как в WhoYaX: токен Firebase (FCM с APNs внутри) регистрируется на
/// сервере вместе с секретом устройства; сервер шифрует текст пуша этим
/// ключом, расширение уведомлений (WYXNotificationService) расшифровывает.
/// Без GoogleService-Info.plist для com.hyax.wyx Firebase не поднимаем.
final class PushDelegate: NSObject, UIApplicationDelegate, UNUserNotificationCenterDelegate {
    static var openChat: ((String) -> Void)?
    private var firebaseReady = false

    func application(_ application: UIApplication, didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]? = nil) -> Bool {
        UNUserNotificationCenter.current().delegate = self
        #if canImport(FirebaseCore)
        if Bundle.main.path(forResource: "GoogleService-Info", ofType: "plist") != nil {
            FirebaseApp.configure()
            Messaging.messaging().delegate = self
            firebaseReady = true
        }
        #endif
        return true
    }

    /// После входа: спросить разрешение и зарегистрироваться.
    static func enable() {
        UNUserNotificationCenter.current().requestAuthorization(options: [.alert, .sound, .badge]) { ok, _ in
            guard ok else { return }
            DispatchQueue.main.async { UIApplication.shared.registerForRemoteNotifications() }
        }
    }

    func application(_ application: UIApplication, didRegisterForRemoteNotificationsWithDeviceToken deviceToken: Data) {
        #if canImport(FirebaseCore)
        if firebaseReady { Messaging.messaging().apnsToken = deviceToken }
        #endif
        AppLog.shared.add("push: apns token получен")
    }

    func application(_ application: UIApplication, didFailToRegisterForRemoteNotificationsWithError error: Error) {
        AppLog.shared.add("push: регистрация не удалась: \(error.localizedDescription)")
    }

    func userNotificationCenter(_ center: UNUserNotificationCenter, willPresent notification: UNNotification) async -> UNNotificationPresentationOptions {
        [.banner, .sound, .badge]
    }

    func userNotificationCenter(_ center: UNUserNotificationCenter, didReceive response: UNNotificationResponse) async {
        if let c = response.notification.request.content.userInfo["chat_id"] as? String { await MainActor.run { PushDelegate.openChat?(c) } }
    }

    // MARK: секрет устройства (общий с расширением через Keychain group)

    static let keychainService = "com.hyax.wyx.push"
    static let keychainGroup = "BTQ69VVHX6.com.hyax.wyx.shared"

    static func secret() -> String {
        let q: [String: Any] = [kSecClass as String: kSecClassGenericPassword, kSecAttrService as String: keychainService, kSecAttrAccount as String: "secret",
                                kSecAttrAccessGroup as String: keychainGroup, kSecReturnData as String: true, kSecMatchLimit as String: kSecMatchLimitOne]
        var out: AnyObject?
        if SecItemCopyMatching(q as CFDictionary, &out) == errSecSuccess, let d = out as? Data { return d.base64EncodedString() }
        var bytes = [UInt8](repeating: 0, count: 32)
        _ = SecRandomCopyBytes(kSecRandomDefault, 32, &bytes)
        let d = Data(bytes)
        let add: [String: Any] = [kSecClass as String: kSecClassGenericPassword, kSecAttrService as String: keychainService, kSecAttrAccount as String: "secret",
                                  kSecAttrAccessGroup as String: keychainGroup, kSecValueData as String: d,
                                  kSecAttrAccessible as String: kSecAttrAccessibleAfterFirstUnlock]
        SecItemAdd(add as CFDictionary, nil)
        return d.base64EncodedString()
    }
}

#if canImport(FirebaseCore)
extension PushDelegate: MessagingDelegate {
    func messaging(_ messaging: Messaging, didReceiveRegistrationToken fcmToken: String?) {
        guard let fcmToken, API.shared.isLoggedIn else { return }
        Task {
            do { try await API.shared.registerPush(token: fcmToken, platform: "ios", secret: PushDelegate.secret()); AppLog.shared.add("push: токен зарегистрирован") }
            catch { AppLog.shared.add("push: не зарегистрирован: \(error.localizedDescription)") }
        }
    }
}
#endif
