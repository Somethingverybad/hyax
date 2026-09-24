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

    /// Пока идёт прогрев — уведомления не пересылаем: клавиатура не видна.
    private var prewarming = false

    override public func load() {
        NotificationCenter.default.addObserver(
            self, selector: #selector(willChangeFrame(_:)),
            name: UIResponder.keyboardWillChangeFrameNotification, object: nil)
        DispatchQueue.main.async { self.prewarmKeyboard() }
    }

    /// Первый показ клавиатуры за запуск у UIKit дорогой: раскладка,
    /// словарь автозамены, подсказки — всё грузится в этот момент, и на
    /// первом тапе в поле система замирала на ~200 мс, а панель ввода
    /// вставала на место рывком. Прогреваем заранее: невидимое поле с
    /// пустым inputView становится first responder и сразу отпускает фокус —
    /// на экране ничего не появляется, а клавиатура уже загружена.
    private func prewarmKeyboard() {
        guard let window = bridge?.webView?.window else { return }
        let field = UITextField(frame: .zero)
        field.inputView = UIView(frame: .zero)
        field.inputAccessoryView = nil
        field.autocorrectionType = .no
        field.isHidden = false
        field.alpha = 0
        window.addSubview(field)
        prewarming = true
        field.becomeFirstResponder()
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.15) {
            field.resignFirstResponder()
            field.removeFromSuperview()
            // Уведомление о скрытии приходит уже после resign — отпускаем чуть позже.
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.35) { self.prewarming = false }
        }
    }

    deinit { NotificationCenter.default.removeObserver(self) }

    @objc private func willChangeFrame(_ n: Notification) {
        if prewarming { return }
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
        // В JS — напрямую и синхронно, а не через notifyListeners: тот кладёт
        // вызов в DispatchQueue.main.async, а главная очередь в этот момент
        // занята показом клавиатуры, и событие доезжало на 50–130 мс позже
        // старта анимации. evaluateJavaScript отправляет IPC сразу.
        let js = "window.dispatchEvent(new CustomEvent('hyax:kbframe',{detail:{height:\(Double(height)),duration:\(duration * 1000),curve:\(curve),ts:\(ts)}}))"
        web.evaluateJavaScript(js, completionHandler: nil)
    }
}
