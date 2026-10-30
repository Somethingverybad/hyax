package com.huyax.app;

import android.content.Context;
import android.net.Uri;
import android.os.Build;
import android.util.AttributeSet;
import android.util.Log;
import android.view.inputmethod.EditorInfo;
import android.view.inputmethod.InputConnection;
import android.webkit.MimeTypeMap;

import androidx.core.view.inputmethod.EditorInfoCompat;
import androidx.core.view.inputmethod.InputConnectionCompat;
import androidx.core.view.inputmethod.InputContentInfoCompat;

import com.getcapacitor.CapacitorWebView;

import org.json.JSONObject;

import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.util.UUID;

/**
 * WebView, который принимает картинки с клавиатуры (буфер Gboard, стикеры, GIF).
 *
 * Клавиатура вставляет картинку не обычной вставкой, а через commitContent и
 * только в поле, которое объявило нужные типы (EditorInfo.contentMimeTypes).
 * WebView их не объявляет, и клавиатура писала «WYX does not support image
 * pasting here» (баг-репорт cda6147d). Здесь объявляем image/*, присланный файл
 * копируем в кеш приложения и отдаём странице событием hyax:native-paste
 * {path, mime, name} — lib/nativePaste.ts делает из него обычную вставку в поле.
 *
 * Подставляется вместо CapacitorWebView своей разметкой
 * res/layout/capacitor_bridge_layout_main.xml (имя как у Capacitor).
 */
public class PasteWebView extends CapacitorWebView {
    private static final String TAG = "PasteWebView";
    private static final String[] MIME = { "image/*" };

    public PasteWebView(Context context, AttributeSet attrs) {
        super(context, attrs);
    }

    @Override
    public InputConnection onCreateInputConnection(EditorInfo outAttrs) {
        InputConnection ic = super.onCreateInputConnection(outAttrs);
        if (ic == null) return null;
        EditorInfoCompat.setContentMimeTypes(outAttrs, MIME);
        return InputConnectionCompat.createWrapper(ic, outAttrs, this::onCommitContent);
    }

    private boolean onCommitContent(InputContentInfoCompat info, int flags, android.os.Bundle opts) {
        if (Build.VERSION.SDK_INT >= 25 && (flags & InputConnectionCompat.INPUT_CONTENT_GRANT_READ_URI_PERMISSION) != 0) {
            try {
                info.requestPermission();
            } catch (Exception e) {
                Log.w(TAG, "нет доступа к картинке клавиатуры", e);
                return false;
            }
        }
        String mime = info.getDescription().getMimeTypeCount() > 0 ? info.getDescription().getMimeType(0) : "image/png";
        Uri uri = info.getContentUri();
        // Файл читаем не в потоке клавиатуры: он может быть большим (GIF).
        new Thread(() -> {
            try {
                File dir = new File(getContext().getCacheDir(), "paste");
                if (!dir.exists() && !dir.mkdirs()) throw new IllegalStateException("нет папки кеша");
                // Прошлые вставки уже отправлены — старше часа не держим.
                File[] old = dir.listFiles();
                if (old != null) for (File f : old) if (System.currentTimeMillis() - f.lastModified() > 3600_000L) f.delete();
                String ext = MimeTypeMap.getSingleton().getExtensionFromMimeType(mime);
                File out = new File(dir, UUID.randomUUID() + "." + (ext != null ? ext : "png"));
                try (InputStream in = getContext().getContentResolver().openInputStream(uri);
                     OutputStream os = new FileOutputStream(out)) {
                    if (in == null) throw new IllegalStateException("пустой поток");
                    byte[] buf = new byte[64 * 1024];
                    int n;
                    while ((n = in.read(buf)) > 0) os.write(buf, 0, n);
                }
                JSONObject d = new JSONObject();
                d.put("path", "file://" + out.getAbsolutePath());
                d.put("mime", mime);
                d.put("name", "image." + (ext != null ? ext : "png"));
                String js = "window.dispatchEvent(new CustomEvent('hyax:native-paste',{detail:" + d + "}))";
                post(() -> evaluateJavascript(js, null));
            } catch (Exception e) {
                Log.w(TAG, "не удалось принять картинку клавиатуры", e);
            } finally {
                try { info.releasePermission(); } catch (Exception ignored) { }
            }
        }, "paste-copy").start();
        return true;
    }
}
