import Foundation
import Capacitor
import UIKit

/// Не гасить экран, пока идёт запись голосового или треугольника
/// (src/lib/screenAwake.ts): с автоблокировкой WebView теряет микрофон и
/// запись обрывается. Только на время записи — потом система снова гасит экран сама.
@objc(ScreenAwakePlugin)
public class ScreenAwakePlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "ScreenAwakePlugin"
    public let jsName = "ScreenAwake"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "keep", returnType: CAPPluginReturnPromise),
    ]

    @objc func keep(_ call: CAPPluginCall) {
        let on = call.getBool("on") ?? false
        DispatchQueue.main.async {
            UIApplication.shared.isIdleTimerDisabled = on
            call.resolve()
        }
    }
}
