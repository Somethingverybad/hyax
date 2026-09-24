import Foundation
import Capacitor
import UIKit

/// Кадр клавиатуры для JS — с моментом начала системной анимации.
///
/// Штатный плагин Keyboard отдаёт в JS только высоту: длительность и кривую из
/// уведомления он выбрасывает, а событие доходит до WebView через мост на
/// два-три кадра позже, чем клавиатура начала движение. Панель ввода стартовала
/// с опозданием и ехала по чужой кривой: при открытии клавиатура её накрывала,
/// при закрытии между ними зияла полоса.
///
/// Здесь — `keyboardWillChangeFrame` (приходит и на показ/скрытие, и на смену
/// высоты: эмодзи, строка подсказок) с высотой перекрытия WebView и временем
/// события по тем же часам, что `Date.now()` в JS. По нему JS запускает свою
/// анимацию с отрицательной задержкой — «с середины», ровно там, где клавиатура
/// уже находится.
@objc(KeyboardSyncPlugin)
public class KeyboardSyncPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "KeyboardSyncPlugin"
    public let jsName = "KeyboardSync"
    public let pluginMethods: [CAPPluginMethod] = []

    override public func load() {
        NotificationCenter.default.addObserver(
            self, selector: #selector(willChangeFrame(_:)),
            name: UIResponder.keyboardWillChangeFrameNotification, object: nil)
    }

    deinit { NotificationCenter.default.removeObserver(self) }

    @objc private func willChangeFrame(_ n: Notification) {
        // Время — первым делом, до любых вычислений: это момент старта анимации.
        let ts = Date().timeIntervalSince1970 * 1000
        guard let info = n.userInfo,
              let end = (info[UIResponder.keyboardFrameEndUserInfoKey] as? NSValue)?.cgRectValue,
              let web = bridge?.webView, let window = web.window else { return }
        let duration = (info[UIResponder.keyboardAnimationDurationUserInfoKey] as? Double) ?? 0.25
        let curve = (info[UIResponder.keyboardAnimationCurveUserInfoKey] as? Int) ?? 7
        // Перекрытие с WebView, а не высота клавиатуры: плавающая и
        // отстыкованная клавиатура (iPad) WebView не перекрывает вовсе.
        let kb = window.convert(end, from: nil)
        let wv = web.convert(web.bounds, to: window)
        let overlap = max(0, wv.maxY - max(kb.minY, wv.minY))
        let height = kb.minY >= window.bounds.maxY - 1 ? 0 : overlap
        notifyListeners("change", data: [
            "height": Double(height),
            "duration": duration * 1000,
            "curve": curve,
            "ts": ts,
        ])
    }
}
