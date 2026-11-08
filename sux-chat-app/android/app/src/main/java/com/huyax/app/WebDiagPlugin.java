package com.huyax.app;

import android.app.ActivityManager;
import android.app.ApplicationExitInfo;
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
import java.util.List;

/**
 * Почему был белый экран: процесс отрисовки WebView умер (упал или его убила
 * система за память), а журнал веб-части обрывается на полуслове. Тот же
 * контракт, что у iOS (WebDiagPlugin.swift): запись — в SharedPreferences
 * сразу, синхронно (следом система закрывает и приложение), веб-часть после
 * перезапуска забирает её через take() (lib/crashGuard) и прикладывает к
 * автоотчёту о падении.
 *
 * take() отдаёт ещё и причину, по которой система закрыла прошлый процесс
 * приложения (ApplicationExitInfo, Android 11+): смахнули из недавних — это не
 * падение. На многих лаунчерах приложение в «недавних» остаётся живой плиткой,
 * не уходя в фон, и веб-часть не успевала узнать, что её закрывают (баг-репорт
 * 0bfcaf7b: автоотчёт о падении, а человек пишет «всё отлично»).
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
        JSObject exit = lastExit(getContext());
        if (exit != null) ret.put("exit", exit);
        call.resolve(ret);
    }

    /** Как закончился прошлый главный процесс приложения; null — до Android 11 или не узнать. */
    static JSObject lastExit(Context ctx) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.R) return null;
        try {
            ActivityManager am = (ActivityManager) ctx.getSystemService(Context.ACTIVITY_SERVICE);
            if (am == null) return null;
            String pkg = ctx.getPackageName();
            List<ApplicationExitInfo> list = am.getHistoricalProcessExitReasons(pkg, 0, 5);
            for (ApplicationExitInfo e : list) {
                // Только главный процесс: не «:remote» и прочие служебные.
                if (!pkg.equals(e.getProcessName())) continue;
                JSObject o = new JSObject();
                o.put("reason", e.getReason());
                o.put("t", e.getTimestamp());
                o.put("importance", e.getImportance());
                o.put("status", e.getStatus());
                String d = e.getDescription();
                if (d != null) o.put("desc", d.length() > 120 ? d.substring(0, 120) : d);
                return o;
            }
        } catch (Exception ignored) {
            // Диагностика не должна ронять приложение.
        }
        return null;
    }
}
