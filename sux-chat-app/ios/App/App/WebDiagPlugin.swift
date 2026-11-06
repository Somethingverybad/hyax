import Foundation
import Capacitor
import UIKit
import WebKit

/// Почему был белый экран (баг-репорты 4108eb14, 33a55eea): процесс WebView
/// iOS убивает сам — чаще всего за память, — Capacitor молча перезагружает
/// страницу, и журнал веб-части обрывается на полуслове. Узнать, что это
/// было, можно только здесь, в нативной части: момент гибели, было ли
/// приложение на экране, сколько памяти оставалось у приложения, были ли
/// перед этим предупреждения о нехватке памяти, нагрев. Пишем в
/// UserDefaults, веб-часть после перезапуска забирает (lib/crashGuard) и
/// прикладывает к автоотчёту о падении.
enum WebDiag {
    private static let key = "hyax.webdiag"
    private static let keep = 5
    /// Последние предупреждения о памяти (время, мс) — от них до гибели обычно секунды.
    private static var warnings: [Double] = []
    private static var terminations = 0
    private static var observing = false

    private static func now() -> Double { Date().timeIntervalSince1970 * 1000 }

    static func startObserving() {
        guard !observing else { return }
        observing = true
        NotificationCenter.default.addObserver(forName: UIApplication.didReceiveMemoryWarningNotification, object: nil, queue: .main) { _ in
            warnings.append(now())
            if warnings.count > 10 { warnings.removeFirst(warnings.count - 10) }
        }
    }

    /// Вызывается с главного потока из делегата навигации.
    static func recordTermination(_ webView: WKWebView) {
        terminations += 1
        let t = now()
        let state: String
        switch UIApplication.shared.applicationState {
        case .active: state = "active"
        case .inactive: state = "inactive"
        case .background: state = "background"
        @unknown default: state = "unknown"
        }
        let thermal: String
        switch ProcessInfo.processInfo.thermalState {
        case .nominal: thermal = "nominal"
        case .fair: thermal = "fair"
        case .serious: thermal = "serious"
        case .critical: thermal = "critical"
        @unknown default: thermal = "unknown"
        }
        var rec: [String: Any] = [
            "kind": "terminated",
            "t": t,
            "state": state,
            "thermal": thermal,
            "n": terminations,
            "uptimeS": Int(ProcessInfo.processInfo.systemUptime),
            "path": webView.url?.path ?? "",
            // Предупреждения о памяти за последнюю минуту: сколько и за сколько секунд до гибели последнее.
            "memWarnings": warnings.filter { t - $0 < 60_000 }.count,
        ]
        if let last = warnings.last { rec["lastWarningAgoS"] = Int((t - last) / 1000) }
        // Свободно приложению до лимита (сам WebView — отдельный процесс, но
        // давление на память у них общее).
        if #available(iOS 13.0, *) { rec["availMB"] = Int(os_proc_available_memory() / 1_048_576) }
        rec["lowPower"] = ProcessInfo.processInfo.isLowPowerModeEnabled
        var list = UserDefaults.standard.array(forKey: key) as? [[String: Any]] ?? []
        list.append(rec)
        if list.count > keep { list.removeFirst(list.count - keep) }
        UserDefaults.standard.set(list, forKey: key)
        // Процесс приложения может умереть следом — записываем сразу.
        UserDefaults.standard.synchronize()
    }

    static func take() -> [[String: Any]] {
        let list = UserDefaults.standard.array(forKey: key) as? [[String: Any]] ?? []
        UserDefaults.standard.removeObject(forKey: key)
        return list
    }
}

/// Встаёт делегатом навигации вместо делегата Capacitor и отдаёт ему всё,
/// кроме гибели процесса WebView: её сперва записывает, потом тоже отдаёт —
/// Capacitor перезагружает страницу как раньше. WKWebView держит делегата
/// слабой ссылкой, поэтому этот объект держит контроллер.
final class WebProcessWatch: NSObject, WKNavigationDelegate {
    private let target: NSObject & WKNavigationDelegate

    init(_ target: NSObject & WKNavigationDelegate) {
        self.target = target
        super.init()
    }

    override func responds(to aSelector: Selector!) -> Bool {
        super.responds(to: aSelector) || target.responds(to: aSelector)
    }

    override func forwardingTarget(for aSelector: Selector!) -> Any? {
        target.responds(to: aSelector) ? target : super.forwardingTarget(for: aSelector)
    }

    func webViewWebContentProcessDidTerminate(_ webView: WKWebView) {
        WebDiag.recordTermination(webView)
        target.webViewWebContentProcessDidTerminate?(webView)
    }
}

/// `take` — записи о гибели WebView с прошлого раза (и стереть их).
@objc(WebDiagPlugin)
public class WebDiagPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "WebDiagPlugin"
    public let jsName = "WebDiag"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "take", returnType: CAPPluginReturnPromise),
    ]

    @objc func take(_ call: CAPPluginCall) {
        call.resolve(["items": WebDiag.take()])
    }
}
