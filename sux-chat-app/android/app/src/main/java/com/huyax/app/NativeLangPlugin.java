package com.huyax.app;

import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * Язык интерфейса из веб-части — для нативных текстов (см. NativeLang).
 * Страница вызывает setLang при запуске и при каждой смене языка
 * (src/lib/nativeLang.ts).
 */
@CapacitorPlugin(name = "NativeLang")
public class NativeLangPlugin extends Plugin {
    @PluginMethod
    public void setLang(PluginCall call) {
        String lang = call.getString("lang");
        if (!NativeLang.isSupported(lang)) {
            call.reject("lang: ru | en | ko");
            return;
        }
        if (NativeLang.set(getContext(), lang)) {
            // Названия каналов в системных настройках — на новом языке.
            MessageChannels.ensure(getContext());
        }
        call.resolve();
    }
}
