package com.huyax.app;

import android.content.ContentResolver;
import android.content.Context;
import android.content.Intent;
import android.database.Cursor;
import android.net.Uri;
import android.provider.OpenableColumns;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;

/**
 * «Поделиться → WYX» из других приложений (ACTION_SEND / SEND_MULTIPLE).
 *
 * Тот же контракт, что у iOS (ShareInboxPlugin.swift): MainActivity принимает
 * интент, файлы копируются из content:// во внутренний кеш, текст и список
 * ждут, пока JS заберёт их через take() (lib/shareInbox.ts) и покажет выбор
 * чата. При тёплом старте JS получает событие hyax:share-inbox; при холодном
 * сам спрашивает take() после загрузки.
 */
@CapacitorPlugin(name = "ShareInbox")
public class ShareInboxPlugin extends Plugin {

    private static final Object lock = new Object();
    private static final List<JSObject> items = new ArrayList<>();
    private static String text = "";
    private static boolean hasPending = false;

    /** Разобрать интент; true — если это было «поделиться». */
    static boolean accept(Context ctx, Intent intent) {
        if (intent == null) return false;
        String action = intent.getAction();
        boolean single = Intent.ACTION_SEND.equals(action);
        boolean multi = Intent.ACTION_SEND_MULTIPLE.equals(action);
        if (!single && !multi) return false;

        List<Uri> uris = new ArrayList<>();
        if (single) {
            Uri u = intent.getParcelableExtra(Intent.EXTRA_STREAM);
            if (u != null) uris.add(u);
        } else {
            List<Uri> list = intent.getParcelableArrayListExtra(Intent.EXTRA_STREAM);
            if (list != null) uris.addAll(list);
        }
        StringBuilder sb = new StringBuilder();
        CharSequence subject = intent.getCharSequenceExtra(Intent.EXTRA_SUBJECT);
        CharSequence body = intent.getCharSequenceExtra(Intent.EXTRA_TEXT);
        // Тему добавляем, только если она не повторяется в тексте (Telegram
        // кладёт в тему заголовок поста, в текст — его же с ссылкой).
        if (subject != null && subject.length() > 0 && (body == null || !body.toString().contains(subject))) sb.append(subject).append('\n');
        if (body != null) sb.append(body);

        File dir = new File(ctx.getCacheDir(), "share-inbox");
        //noinspection ResultOfMethodCallIgnored
        dir.mkdirs();
        List<JSObject> got = new ArrayList<>();
        ContentResolver cr = ctx.getContentResolver();
        for (Uri u : uris) {
            try {
                String name = displayName(cr, u);
                String type = cr.getType(u);
                File dst = new File(dir, UUID.randomUUID().toString().substring(0, 8) + "-" + name);
                try (InputStream in = cr.openInputStream(u); FileOutputStream out = new FileOutputStream(dst)) {
                    if (in == null) continue;
                    byte[] buf = new byte[64 * 1024];
                    int n;
                    while ((n = in.read(buf)) > 0) out.write(buf, 0, n);
                }
                JSObject o = new JSObject();
                o.put("path", "file://" + dst.getAbsolutePath());
                o.put("name", name);
                o.put("type", type != null ? type : "application/octet-stream");
                got.add(o);
            } catch (Exception ignored) { /* один файл не прочитался — остальные отправим */ }
        }
        if (got.isEmpty() && sb.length() == 0) return false;
        synchronized (lock) {
            items.clear();
            items.addAll(got);
            text = sb.toString();
            hasPending = true;
        }
        // Интент не должен сработать повторно при пересоздании активности.
        intent.setAction(Intent.ACTION_MAIN);
        intent.removeExtra(Intent.EXTRA_STREAM);
        intent.removeExtra(Intent.EXTRA_TEXT);
        return true;
    }

    private static String displayName(ContentResolver cr, Uri u) {
        String name = null;
        try (Cursor c = cr.query(u, new String[]{OpenableColumns.DISPLAY_NAME}, null, null, null)) {
            if (c != null && c.moveToFirst()) {
                int i = c.getColumnIndex(OpenableColumns.DISPLAY_NAME);
                if (i >= 0) name = c.getString(i);
            }
        } catch (Exception ignored) {}
        if (name == null || name.isEmpty()) name = u.getLastPathSegment();
        if (name == null || name.isEmpty()) name = "file";
        return name.replace('/', '_');
    }

    @PluginMethod
    public void take(PluginCall call) {
        JSObject ret = new JSObject();
        JSArray arr = new JSArray();
        synchronized (lock) {
            if (hasPending) {
                for (JSObject o : items) arr.put(o);
                ret.put("text", text);
                hasPending = false;
            } else {
                ret.put("text", "");
            }
        }
        ret.put("items", arr);
        call.resolve(ret);
    }

    @PluginMethod
    public void clear(PluginCall call) {
        File dir = new File(getContext().getCacheDir(), "share-inbox");
        File[] list = dir.listFiles();
        if (list != null) for (File f : list) //noinspection ResultOfMethodCallIgnored
            f.delete();
        synchronized (lock) { items.clear(); text = ""; }
        call.resolve();
    }
}
