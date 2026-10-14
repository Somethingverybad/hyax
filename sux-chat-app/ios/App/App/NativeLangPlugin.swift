import UIKit
import Capacitor

/// Язык интерфейса из веб-части — для нативных текстов (см. AppLang.swift).
/// Страница вызывает setLang при запуске и при каждой смене языка
/// (src/lib/nativeLang.ts).
@objc(NativeLangPlugin)
public class NativeLangPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "NativeLangPlugin"
    public let jsName = "NativeLang"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "setLang", returnType: CAPPluginReturnPromise),
    ]

    @objc func setLang(_ call: CAPPluginCall) {
        guard let lang = call.getString("lang"), AppLang.supported.contains(lang) else {
            call.reject("lang: ru | en | ko")
            return
        }
        let changed = AppLang.stored != lang
        AppLang.set(lang)
        if changed {
            // Карточка в Spotlight — с описанием на новом языке.
            DispatchQueue.main.async {
                (UIApplication.shared.delegate as? AppDelegate)?.indexForSpotlight()
            }
        }
        call.resolve()
    }
}
