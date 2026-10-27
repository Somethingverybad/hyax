package com.huyax.app;

import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * Мост к KeyboardSync. Страница зовёт enable(), когда умеет сама двигать поле
 * ввода за клавиатурой (src/main.tsx); на Android до 11 и в сборках без этого
 * плагина вызов отклоняется — остаётся прежняя схема.
 */
@CapacitorPlugin(name = "KeyboardSync")
public class KeyboardSyncPlugin extends Plugin {

    @PluginMethod
    public void enable(PluginCall call) {
        KeyboardSync ks = KeyboardSync.instance;
        if (ks == null) {
            call.reject("unsupported");
            return;
        }
        getActivity().runOnUiThread(() -> {
            ks.enable();
            call.resolve();
        });
    }

    @PluginMethod
    public void setMode(PluginCall call) {
        KeyboardSync ks = KeyboardSync.instance;
        boolean cut = Boolean.TRUE.equals(call.getBoolean("cut", false));
        if (ks == null) {
            call.resolve();
            return;
        }
        getActivity().runOnUiThread(() -> {
            ks.setCut(cut);
            call.resolve();
        });
    }
}
