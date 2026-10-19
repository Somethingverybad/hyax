package com.huyax.app;

import android.app.Activity;
import android.content.ClipData;
import android.content.ContentResolver;
import android.content.Context;
import android.content.Intent;
import android.database.Cursor;
import android.net.Uri;
import android.provider.DocumentsContract;
import android.provider.DocumentsContract.Document;
import android.provider.OpenableColumns;
import androidx.activity.result.ActivityResult;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Collections;
import java.util.HashSet;
import java.util.List;
import java.util.Locale;
import java.util.Set;
import java.util.UUID;
import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

/**
 * Загрузка своих треков в фоне (src/lib/trackUploads.ts).
 *
 * Тот же контракт, что у iOS (MusicUploadPlugin.swift): `pick` — файлы или
 * папка (с вложенными) через системный выбор, аудио копируется в
 * cache/music-upload — доступ к выбранному временный, а отправка может идти
 * долго. `upload` — в очередь службы MusicUploadService (идёт и при
 * заблокированном экране). События — `picking`, `progress`, `done`, `failed`;
 * `list` — что ещё грузится и чем кончилось без интерфейса; `forget` — убрать.
 */
@CapacitorPlugin(name = "MusicUpload")
public class MusicUploadPlugin extends Plugin {

    /** Что принимает сервер (AUDIO_RE в backend/chat/views.py), без веб-форматов. */
    static final Set<String> AUDIO = new HashSet<>(Arrays.asList("mp3", "m4a", "aac", "flac", "wav", "ogg", "opus"));

    @Override
    public void load() {
        MusicUploadStore.listener = (name, data) -> {
            try { notifyListeners(name, JSObject.fromJSONObject(data)); } catch (JSONException ignored) {}
        };
        MusicUploadService.kick(getContext());
    }

    /** Из фона службу могли не пустить — догружаем, как приложение вернулось. */
    @Override
    protected void handleOnResume() {
        super.handleOnResume();
        MusicUploadService.kick(getContext());
    }

    // ===== выбор =====

    @PluginMethod
    public void pick(PluginCall call) {
        boolean folder = Boolean.TRUE.equals(call.getBoolean("folder", false));
        Intent intent;
        if (folder) {
            intent = new Intent(Intent.ACTION_OPEN_DOCUMENT_TREE);
        } else {
            intent = new Intent(Intent.ACTION_OPEN_DOCUMENT)
                .addCategory(Intent.CATEGORY_OPENABLE)
                .setType("audio/*")
                .putExtra(Intent.EXTRA_MIME_TYPES, new String[] {"audio/*", "application/ogg"})
                .putExtra(Intent.EXTRA_ALLOW_MULTIPLE, true);
        }
        try {
            startActivityForResult(call, intent, folder ? "pickedFolder" : "pickedFiles");
        } catch (Exception e) {
            call.reject("Не удалось открыть выбор файлов");
        }
    }

    @ActivityCallback
    private void pickedFiles(PluginCall call, ActivityResult result) {
        Intent data = result.getData();
        if (call == null) return;
        if (result.getResultCode() != Activity.RESULT_OK || data == null) { resolveFiles(call, new JSArray()); return; }
        List<Uri> uris = new ArrayList<>();
        ClipData clip = data.getClipData();
        if (clip != null) for (int i = 0; i < clip.getItemCount(); i++) uris.add(clip.getItemAt(i).getUri());
        else if (data.getData() != null) uris.add(data.getData());
        notifyCount(uris.size());
        Context ctx = getContext();
        new Thread(() -> {
            JSArray out = new JSArray();
            ContentResolver cr = ctx.getContentResolver();
            for (Uri u : uris) {
                JSObject f = take(ctx, cr, u, displayName(cr, u));
                if (f != null) out.put(f);
            }
            resolveFiles(call, out);
        }, "music-pick").start();
    }

    @ActivityCallback
    private void pickedFolder(PluginCall call, ActivityResult result) {
        Intent data = result.getData();
        if (call == null) return;
        if (result.getResultCode() != Activity.RESULT_OK || data == null || data.getData() == null) {
            resolveFiles(call, new JSArray());
            return;
        }
        Uri tree = data.getData();
        notifyCount(1);
        Context ctx = getContext();
        new Thread(() -> {
            ContentResolver cr = ctx.getContentResolver();
            List<String[]> found = new ArrayList<>();
            try {
                walk(cr, tree, DocumentsContract.getTreeDocumentId(tree), "", found, 0);
            } catch (Exception ignored) { /* провайдер не отдал папку целиком — что нашли */ }
            // По порядку путей — как лежит альбом.
            Collections.sort(found, (a, b) -> a[0].compareToIgnoreCase(b[0]));
            JSArray out = new JSArray();
            for (String[] it : found) {
                JSObject f = take(ctx, cr, DocumentsContract.buildDocumentUriUsingTree(tree, it[1]), it[2]);
                if (f != null) out.put(f);
            }
            resolveFiles(call, out);
        }, "music-pick").start();
    }

    private void notifyCount(int n) {
        JSObject d = new JSObject();
        d.put("count", n);
        notifyListeners("picking", d);
    }

    private static void resolveFiles(PluginCall call, JSArray files) {
        JSObject ret = new JSObject();
        ret.put("files", files);
        call.resolve(ret);
    }

    private static boolean isAudio(String name) {
        int dot = name == null ? -1 : name.lastIndexOf('.');
        return dot > 0 && AUDIO.contains(name.substring(dot + 1).toLowerCase(Locale.ROOT));
    }

    /** Обойти папку и вложенные: [путь для сортировки, id документа, имя]. */
    private static void walk(ContentResolver cr, Uri tree, String docId, String prefix, List<String[]> out, int depth) {
        if (depth > 8) return;
        Uri children = DocumentsContract.buildChildDocumentsUriUsingTree(tree, docId);
        String[] cols = {Document.COLUMN_DOCUMENT_ID, Document.COLUMN_DISPLAY_NAME, Document.COLUMN_MIME_TYPE};
        try (Cursor c = cr.query(children, cols, null, null, null)) {
            if (c == null) return;
            while (c.moveToNext()) {
                String id = c.getString(0), name = c.getString(1), mime = c.getString(2);
                if (name == null || name.startsWith(".")) continue;
                if (Document.MIME_TYPE_DIR.equals(mime)) walk(cr, tree, id, prefix + name + "/", out, depth + 1);
                else if (isAudio(name)) out.add(new String[] {prefix + name, id, name});
            }
        }
    }

    /** Скопировать трек в нашу папку; не музыку пропускаем. */
    private static JSObject take(Context ctx, ContentResolver cr, Uri u, String name) {
        if (!isAudio(name)) return null;
        String ext = name.substring(name.lastIndexOf('.') + 1).toLowerCase(Locale.ROOT);
        File dst = new File(MusicUploadStore.dir(ctx), UUID.randomUUID() + "." + ext);
        try (InputStream in = cr.openInputStream(u); FileOutputStream out = new FileOutputStream(dst)) {
            if (in == null) return null;
            byte[] buf = new byte[64 * 1024];
            int n;
            while ((n = in.read(buf)) > 0) out.write(buf, 0, n);
        } catch (Exception e) {
            //noinspection ResultOfMethodCallIgnored
            dst.delete();
            return null;
        }
        JSObject f = new JSObject();
        f.put("path", dst.getAbsolutePath());
        f.put("name", name);
        f.put("size", dst.length());
        return f;
    }

    private static String displayName(ContentResolver cr, Uri u) {
        String name = null;
        try (Cursor c = cr.query(u, new String[] {OpenableColumns.DISPLAY_NAME}, null, null, null)) {
            if (c != null && c.moveToFirst()) {
                int i = c.getColumnIndex(OpenableColumns.DISPLAY_NAME);
                if (i >= 0) name = c.getString(i);
            }
        } catch (Exception ignored) {}
        if (name == null || name.isEmpty()) name = u.getLastPathSegment();
        return name == null ? "track" : name.replace('/', '_');
    }

    // ===== загрузка =====

    /** Только файлы из нашей папки: служба удаляет копию, когда трек дошёл. */
    private boolean ours(String path) {
        try {
            String base = MusicUploadStore.dir(getContext()).getCanonicalPath() + File.separator;
            return new File(path).getCanonicalPath().startsWith(base);
        } catch (Exception e) {
            return false;
        }
    }

    @PluginMethod
    public void upload(PluginCall call) {
        Context ctx = getContext();
        String id = call.getString("id", "");
        String path = call.getString("path", "");
        if (id == null || id.isEmpty() || path == null || !ours(path)) { call.reject("Нет файла"); return; }
        JSONArray urls = call.getArray("urls", new JSArray());
        JSONObject prev = MusicUploadStore.get(ctx, id);
        try {
            if (prev != null && "done".equals(prev.optString("status"))) {
                MusicUploadStore.emit("done", prev);
                call.resolve();
                return;
            }
            // Уже в очереди или отправляется — не сбивать её.
            if (prev != null && "uploading".equals(prev.optString("status"))) {
                call.resolve();
                MusicUploadService.kick(ctx);
                return;
            }
            JSONObject r = prev != null ? prev : new JSONObject();
            String file = prev != null ? prev.optString("path", "") : path;
            if (file.isEmpty() || !new File(file).isFile()) { call.reject("Файл недоступен — выберите его снова"); return; }
            r.put("id", id);
            r.put("path", file);
            r.put("name", call.getString("name", "track"));
            r.put("meta", call.getString("meta", ""));
            r.put("urls", urls);
            r.put("urlIndex", 0);
            r.put("attempts", 0);
            r.put("token", call.getString("token", ""));
            JSObject fields = call.getObject("fields", new JSObject());
            r.put("fields", fields == null ? new JSONObject() : fields);
            r.put("status", "uploading");
            r.put("progress", 0);
            r.put("http", 0);
            r.remove("error");
            MusicUploadStore.put(ctx, r);
            MusicUploadStore.emit("progress", r);
        } catch (JSONException e) {
            call.reject("Не удалось поставить в очередь");
            return;
        }
        MusicUploadService.kick(ctx);
        call.resolve();
    }

    @PluginMethod
    public void list(PluginCall call) {
        JSObject ret = new JSObject();
        ret.put("items", MusicUploadStore.list(getContext()));
        call.resolve(ret);
    }

    @PluginMethod
    public void forget(PluginCall call) {
        JSArray ids = call.getArray("ids", new JSArray());
        for (int i = 0; i < ids.length(); i++) MusicUploadStore.remove(getContext(), ids.optString(i));
        call.resolve();
    }
}
