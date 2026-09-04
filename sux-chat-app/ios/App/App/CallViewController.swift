import UIKit
import Capacitor

/// Корневой контроллер WebView: регистрирует локальный плагин Voip —
/// плагины вне npm Capacitor сам не находит.
class CallViewController: CAPBridgeViewController {
    override open func capacitorDidLoad() {
        // Клавиатура прячется жестом вниз, как в мессенджерах.
        webView?.scrollView.keyboardDismissMode = .interactive
        bridge?.registerPluginInstance(VoipPlugin())
        bridge?.registerPluginInstance(NativeCallPlugin())
        bridge?.registerPluginInstance(PushSecretPlugin())
    }
}
