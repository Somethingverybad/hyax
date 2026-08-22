import UIKit
import Capacitor

/// Корневой контроллер WebView: регистрирует локальный плагин Voip —
/// плагины вне npm Capacitor сам не находит.
class CallViewController: CAPBridgeViewController {
    override open func capacitorDidLoad() {
        bridge?.registerPluginInstance(VoipPlugin())
        bridge?.registerPluginInstance(NativeCallPlugin())
    }
}
