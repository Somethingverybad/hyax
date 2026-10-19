package com.huyax.app;

import android.app.Activity;
import android.view.WindowManager;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * Не гасить экран, пока идёт запись голосового или треугольника
 * (src/lib/screenAwake.ts): с погасшим экраном WebView теряет микрофон и
 * запись обрывается. Тот же контракт, что у iOS (ScreenAwakePlugin.swift).
 */
@CapacitorPlugin(name = "ScreenAwake")
public class ScreenAwakePlugin extends Plugin {

    @PluginMethod
    public void keep(PluginCall call) {
        boolean on = Boolean.TRUE.equals(call.getBoolean("on", false));
        Activity a = getActivity();
        if (a == null) { call.resolve(); return; }
        a.runOnUiThread(() -> {
            if (on) a.getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
            else a.getWindow().clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
            call.resolve();
        });
    }
}
