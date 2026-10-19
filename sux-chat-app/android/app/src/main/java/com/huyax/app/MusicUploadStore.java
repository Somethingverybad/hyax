package com.huyax.app;

import android.content.Context;
import android.content.SharedPreferences;
import java.io.File;
import java.util.ArrayList;
import java.util.List;
import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

/**
 * Записи о загрузках треков (MusicUploadPlugin, MusicUploadService).
 *
 * Тот же контракт, что у iOS (MusicUploader.swift): у записи метка id из
 * интерфейса, имя, meta (строка интерфейса, возвращаем как есть), статус
 * uploading | done | failed, проценты, код ответа и текст ошибки. Лежат в
 * SharedPreferences — после перезапуска интерфейс спрашивает list() и видит,
 * что ещё грузится и чем кончилось без него. Порядок — порядок постановки.
 */
final class MusicUploadStore {
    interface Listener { void onEvent(String name, JSONObject data); }

    private static final String PREFS = "music_upload";
    private static final String KEY = "items";
    private static final Object lock = new Object();
    private static List<JSONObject> items;
    static volatile Listener listener;

    private MusicUploadStore() {}

    static File dir(Context ctx) {
        File d = new File(ctx.getCacheDir(), "music-upload");
        //noinspection ResultOfMethodCallIgnored
        d.mkdirs();
        return d;
    }

    private static SharedPreferences prefs(Context ctx) {
        return ctx.getApplicationContext().getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }

    private static void ensure(Context ctx) {
        if (items != null) return;
        items = new ArrayList<>();
        try {
            JSONArray arr = new JSONArray(prefs(ctx).getString(KEY, "[]"));
            for (int i = 0; i < arr.length(); i++) items.add(arr.getJSONObject(i));
        } catch (JSONException ignored) {}
    }

    private static void save(Context ctx) {
        JSONArray arr = new JSONArray();
        for (JSONObject o : items) arr.put(o);
        prefs(ctx).edit().putString(KEY, arr.toString()).apply();
    }

    private static int indexOf(String id) {
        for (int i = 0; i < items.size(); i++) if (id.equals(items.get(i).optString("id"))) return i;
        return -1;
    }

    static JSONObject get(Context ctx, String id) {
        synchronized (lock) {
            ensure(ctx);
            int i = indexOf(id);
            return i < 0 ? null : copy(items.get(i));
        }
    }

    static void put(Context ctx, JSONObject rec) {
        synchronized (lock) {
            ensure(ctx);
            int i = indexOf(rec.optString("id"));
            if (i < 0) items.add(copy(rec)); else items.set(i, copy(rec));
            save(ctx);
        }
    }

    /** Поменять поля записи (без сохранения на диск — для процентов). */
    static void patch(Context ctx, String id, String key, Object value, boolean persist) {
        synchronized (lock) {
            ensure(ctx);
            int i = indexOf(id);
            if (i < 0) return;
            try { items.get(i).put(key, value); } catch (JSONException ignored) {}
            if (persist) save(ctx);
        }
    }

    static void remove(Context ctx, String id) {
        synchronized (lock) {
            ensure(ctx);
            int i = indexOf(id);
            if (i < 0) return;
            JSONObject r = items.remove(i);
            String path = r.optString("path", "");
            //noinspection ResultOfMethodCallIgnored
            if (!path.isEmpty()) new File(path).delete();
            save(ctx);
        }
    }

    /** Следующая загрузка по очереди. */
    static JSONObject next(Context ctx) {
        synchronized (lock) {
            ensure(ctx);
            for (JSONObject o : items) if ("uploading".equals(o.optString("status"))) return copy(o);
            return null;
        }
    }

    static int[] counts(Context ctx) {
        synchronized (lock) {
            ensure(ctx);
            int left = 0, total = 0;
            for (JSONObject o : items) {
                String s = o.optString("status");
                if ("uploading".equals(s)) left++;
                if ("uploading".equals(s) || "done".equals(s)) total++;
            }
            return new int[] {left, total};
        }
    }

    /** Для интерфейса: без адресов, токена и путей. */
    static JSONArray list(Context ctx) {
        synchronized (lock) {
            ensure(ctx);
            JSONArray arr = new JSONArray();
            for (JSONObject o : items) arr.put(public_(o));
            return arr;
        }
    }

    static JSONObject public_(JSONObject r) {
        JSONObject d = new JSONObject();
        try {
            d.put("id", r.optString("id"));
            d.put("name", r.optString("name"));
            d.put("meta", r.optString("meta"));
            d.put("status", r.optString("status"));
            d.put("progress", r.optInt("progress"));
            d.put("http", r.optInt("http"));
            if (r.has("error")) d.put("error", r.optString("error"));
            if (r.has("response")) d.put("response", r.optString("response"));
        } catch (JSONException ignored) {}
        return d;
    }

    static void emit(String name, JSONObject rec) {
        Listener l = listener;
        if (l != null) l.onEvent(name, public_(rec));
    }

    private static JSONObject copy(JSONObject o) {
        try { return new JSONObject(o.toString()); } catch (JSONException e) { return new JSONObject(); }
    }
}
