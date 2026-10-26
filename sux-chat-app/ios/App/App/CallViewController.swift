import UIKit
import WebKit
import Capacitor

/// Корневой контроллер WebView: регистрирует локальный плагин Voip —
/// плагины вне npm Capacitor сам не находит.
class CallViewController: CAPBridgeViewController {
    /// Выделен ли текст в поле ввода сообщения. Сообщает веб-часть
    /// (ChatWindow, selectionchange) через обработчик hyaxComposeSel.
    fileprivate var composeHasSelection = false {
        didSet {
            guard oldValue != composeHasSelection else { return }
            if #available(iOS 16.0, *) { UIMenuSystem.context.setNeedsRebuild() }
        }
    }

    override open func capacitorDidLoad() {
        // Клавиатура прячется жестом вниз, как в мессенджерах.
        webView?.scrollView.keyboardDismissMode = .interactive
        bridge?.registerPluginInstance(VoipPlugin())
        bridge?.registerPluginInstance(NativeCallPlugin())
        bridge?.registerPluginInstance(PushSecretPlugin())
        bridge?.registerPluginInstance(ChatNotificationsPlugin())
        bridge?.registerPluginInstance(KeyboardSyncPlugin())
        bridge?.registerPluginInstance(ShareInboxPlugin())
        bridge?.registerPluginInstance(NativeLangPlugin())
        bridge?.registerPluginInstance(MusicUploadPlugin())
        bridge?.registerPluginInstance(ScreenAwakePlugin())
        bridge?.registerPluginInstance(NativeSocketPlugin())
        webView?.configuration.userContentController.add(ComposeSelectionHandler(owner: self), name: "hyaxComposeSel")
    }

    /// Пункт «Форматирование» в системном меню выделения (как в Telegram и
    /// «Заметках»): Вырезать · Скопировать · Вставить · Форматирование ›.
    /// Веб-панель над полем здесь не видна — меню iOS ложится ровно на неё.
    override func buildMenu(with builder: UIMenuBuilder) {
        super.buildMenu(with: builder)
        guard #available(iOS 16.0, *), builder.system == .context, composeHasSelection else { return }
        // Подписи — на языке приложения (AppLang): меню собирается заново
        // при каждом показе, так что смена языка видна сразу.
        let items: [(String, String, String)] = [
            (AppLang.t("format.bold", "Жирный"), "bold", "bold"),
            (AppLang.t("format.italic", "Курсив"), "italic", "italic"),
            (AppLang.t("format.underline", "Подчёркнутый"), "underline", "underline"),
            (AppLang.t("format.strike", "Зачёркнутый"), "strike", "strikethrough"),
            (AppLang.t("format.code", "Моноширинный"), "code", "chevron.left.forwardslash.chevron.right"),
            (AppLang.t("format.spoiler", "Спойлер"), "spoiler", "eye.slash"),
            (AppLang.t("format.zalgo", "Зальго"), "zalgo", "waveform.path"),
            (AppLang.t("format.scramble", "Перемешать буквы"), "scramble", "shuffle"),
        ]
        let actions = items.map { title, type, icon in
            UIAction(title: title, image: UIImage(systemName: icon)) { [weak self] _ in
                self?.applyFormat(type)
            }
        }
        let menu = UIMenu(title: AppLang.t("format.menu", "Форматирование"), image: UIImage(systemName: "textformat"),
                          identifier: UIMenu.Identifier("com.hyax.format"), children: actions)
        if builder.menu(for: .standardEdit) != nil {
            builder.insertSibling(menu, afterMenu: .standardEdit)
        } else {
            builder.insertChild(menu, atEndOfMenu: .root)
        }
    }

    /// Применяет формат к выделению в поле ввода (lib/format.tsx через ChatWindow).
    private func applyFormat(_ type: String) {
        webView?.evaluateJavaScript("window.__hyaxFormat && window.__hyaxFormat('\(type)')", completionHandler: nil)
    }
}

/// Отдельный объект-обработчик: userContentController держит его сильной
/// ссылкой, а контроллер — слабой, без цикла.
private final class ComposeSelectionHandler: NSObject, WKScriptMessageHandler {
    weak var owner: CallViewController?
    init(owner: CallViewController) { self.owner = owner }
    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
        owner?.composeHasSelection = (message.body as? NSNumber)?.boolValue ?? false
    }
}
