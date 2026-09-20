import UIKit
import Capacitor
import CoreSpotlight

@UIApplicationMain
class AppDelegate: UIResponder, UIApplicationDelegate {

    var window: UIWindow?

    func application(_ application: UIApplication, didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]?) -> Bool {
        // PushKit надо зарегистрировать сразу при запуске: VoIP-пуш может быть
        // причиной самого запуска, и его нужно принять до загрузки WebView.
        VoipManager.shared.start()
        indexForSpotlight()
        return true
    }

    /// Spotlight ищет приложение только по имени под иконкой и кириллицу в
    /// латиницу не переводит: после переименования в WhoYaX запрос прежним
    /// названием ничего не находил. Кладём в системный индекс одну карточку
    /// приложения с прежними написаниями в ключевых словах — они нигде не
    /// показываются, в выдаче видно только «WhoYaX». Тап по карточке просто
    /// открывает приложение. Идентификатор постоянный: повторная индексация
    /// обновляет ту же запись, а не плодит новые.
    private func indexForSpotlight() {
        guard CSSearchableIndex.isIndexingAvailable() else { return }
        let attrs = CSSearchableItemAttributeSet(contentType: .item)
        attrs.title = "WhoYaX"
        attrs.contentDescription = "Мессенджер"
        attrs.keywords = ["хуякс", "хуяк", "hyax", "huyax", "whoyax", "вуякс", "мессенджер"]
        let item = CSSearchableItem(uniqueIdentifier: "app", domainIdentifier: "com.hyax.messenger.app", attributeSet: attrs)
        item.expirationDate = .distantFuture
        CSSearchableIndex.default().indexSearchableItems([item]) { error in
            if let error = error { NSLog("Spotlight: индексация не удалась: %@", error.localizedDescription) }
        }
    }

    func applicationWillResignActive(_ application: UIApplication) {
        // Sent when the application is about to move from active to inactive state. This can occur for certain types of temporary interruptions (such as an incoming phone call or SMS message) or when the user quits the application and it begins the transition to the background state.
        // Use this method to pause ongoing tasks, disable timers, and invalidate graphics rendering callbacks. Games should use this method to pause the game.
    }

    func applicationDidEnterBackground(_ application: UIApplication) {
        // Use this method to release shared resources, save user data, invalidate timers, and store enough application state information to restore your application to its current state in case it is terminated later.
        // If your application supports background execution, this method is called instead of applicationWillTerminate: when the user quits.
    }

    func applicationWillEnterForeground(_ application: UIApplication) {
        // Called as part of the transition from the background to the active state; here you can undo many of the changes made on entering the background.
    }

    func applicationDidBecomeActive(_ application: UIApplication) {
        // Restart any tasks that were paused (or not yet started) while the application was inactive. If the application was previously in the background, optionally refresh the user interface.
    }

    func applicationWillTerminate(_ application: UIApplication) {
        // Called when the application is about to terminate. Save data if appropriate. See also applicationDidEnterBackground:.
    }

    func application(_ app: UIApplication, open url: URL, options: [UIApplication.OpenURLOptionsKey: Any] = [:]) -> Bool {
        // Called when the app was launched with a url. Feel free to add additional processing here,
        // but if you want the App API to support tracking app url opens, make sure to keep this call
        return ApplicationDelegateProxy.shared.application(app, open: url, options: options)
    }

    func application(_ application: UIApplication, continue userActivity: NSUserActivity, restorationHandler: @escaping ([UIUserActivityRestoring]?) -> Void) -> Bool {
        // Called when the app was launched with an activity, including Universal Links.
        // Feel free to add additional processing here, but if you want the App API to support
        // tracking app url opens, make sure to keep this call
        // Тап по карточке из Spotlight (см. indexForSpotlight): приложение уже
        // открыто этим тапом, вести некуда — просто подтверждаем обработку.
        if userActivity.activityType == CSSearchableItemActionType { return true }
        return ApplicationDelegateProxy.shared.application(application, continue: userActivity, restorationHandler: restorationHandler)
    }

    // MARK: - Push (@capacitor-firebase/messaging)
    // Плагин слушает эти нотификации, чтобы отдать APNs-токен в Firebase SDK
    // и получить взамен FCM-токен. Без проброса токен на iOS не выдаётся.

    func application(_ application: UIApplication, didRegisterForRemoteNotificationsWithDeviceToken deviceToken: Data) {
        NotificationCenter.default.post(name: .capacitorDidRegisterForRemoteNotifications, object: deviceToken)
    }

    func application(_ application: UIApplication, didFailToRegisterForRemoteNotificationsWithError error: Error) {
        NotificationCenter.default.post(name: .capacitorDidFailToRegisterForRemoteNotifications, object: error)
    }

}
