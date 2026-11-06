package com.huyax.app;

import android.app.ActivityManager;
import android.content.Context;
import android.content.SharedPreferences;
import android.os.Build;
import android.webkit.RenderProcessGoneDetail;
import android.webkit.WebView;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.WebViewListener;
import com.getcapacitor.annotation.CapacitorPlugin;
import org.json.JSONArray;
import org.json.JSONObject;

/**
 * Почему был белый экран: процесс отрисовки WebView умер (упал или его убила
 * система за память), а журнал веб-части обрывается на полуслове. Тот же
 * контракт, что у iOS (WebDiagPlugin.swift): запись — в SharedPreferences
 * сразу, синхронно (следом система закрывает и приложение), веб-часть после
 * перезапуска забирает её через take() (lib/crashGuard) и прикладывает к
 * автоотчёту о падении.
 */
@CapacitorPlugin(name = "WebDiag")
public class WebDiagPlugin extends Plugin {

    private static final String PREFS = "hyax_webdiag";
    private static final String KEY = "items";
    private static final int KEEP = 5;

    /** Слушатель для Bridge (MainActivity): поведение прежнее — false, Capacitor решает сам. */
    static WebViewListener listener(Context ctx) {
        Context app = ctx.getApplicationContext();
        return new WebViewListener() {
            @Override
            public boolean onRenderProcessGone(WebView webView, RenderProcessGoneDetail detail) {
                record(app, detail);
                return false;
            }
        };
    }

    static void record(Context ctx, RenderProcessGoneDetail detail) {
        try {
            JSONObject rec = new JSONObject();
            rec.put("kind", "renderGone");
            rec.put("t", System.currentTimeMillis());
            rec.put("state", MainActivity.isForeground ? "active" : "background");
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O && detail != null) {
                // didCrash=false — процесс убила система (обычно за память).
                rec.put("didCrash", detail.didCrash());
                rec.put("priority", detail.rendererPriorityAtExit());
            }
            ActivityManager am = (ActivityManager) ctx.getSystemService(Context.ACTIVITY_SERVICE);
            if (am != null) {
                ActivityManager.MemoryInfo mi = new ActivityManager.MemoryInfo();
                am.getMemoryInfo(mi);
                rec.put("availMB", mi.availMem / 1048576);
                rec.put("lowMemory", mi.lowMemory);
            }
            SharedPreferences sp = ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
            JSONArray list = new JSONArray(sp.getString(KEY, "[]"));
            list.put(rec);
            JSONArray kept = new JSONArray();
            for (int i = Math.max(0, list.length() - KEEP); i < list.length(); i++) kept.put(list.get(i));
            sp.edit().putString(KEY, kept.toString()).commit();
        } catch (Exception ignored) {
            // Диагностика не должна ронять приложение.
        }
    }

    @PluginMethod
    public void take(PluginCall call) {
        SharedPreferences sp = getContext().getSharedPreferences(PREFS, Context.MODE_PRIVATE);
        JSArray items = new JSArray();
        try {
            JSONArray list = new JSONArray(sp.getString(KEY, "[]"));
            for (int i = 0; i < list.length(); i++) items.put(JSObject.fromJSONObject(list.getJSONObject(i)));
        } catch (Exception ignored) {
            // Битая запись — как будто не было.
        }
        sp.edit().remove(KEY).apply();
        JSObject ret = new JSObject();
        ret.put("items", items);
        call.resolve(ret);
    }
}
