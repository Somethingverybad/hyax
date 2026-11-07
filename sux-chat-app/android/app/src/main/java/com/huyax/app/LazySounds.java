package com.huyax.app;

import android.app.NotificationManager;
import android.content.Context;
import android.content.SharedPreferences;
import android.os.Build;
import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.util.Map;

/**
 * Звук уведомления по требованию. Раньше приложение заранее качало весь
 * каталог публичных паков и заводило канал под каждый звук (десятки мегабайт
 * и сотни каналов в настройках), хотя большинство звуков человеку никто не
 * пришлёт. Теперь сервер кладёт в пуш путь к файлу (snd, snd_src, snd_v,
 * snd_name — chat/fcm.py sound_fields), а CallMessagingService перед показом
 * уведомления докачивает звук и заводит его канал. Тот же контракт, что у
 * iOS (NotificationService.swift, LazySound).
 */
final class LazySounds {
    /** Адреса по очереди: CDN, затем сервер напрямую под двумя именами. */
    private static final String[] ORIGINS = {"https://cdn.hyax.ru", "https://hyax.ru", "https://huyax.e-tree.su"};
    private static final String PREFS = "hyax_lazy_sounds";

    private LazySounds() {}

    /** Канал snd_<slug> готов (был или только что заведён) — true. */
    static boolean ensure(Context ctx, Map<String, String> data) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O || data == null) return false;
        String slug = data.get("snd");
        String path = data.get("snd_src");
        if (slug == null || slug.isEmpty() || path == null || !path.startsWith("/")) return false;
        String version = data.get("snd_v") == null ? "0" : data.get("snd_v");
        String name = data.get("snd_name");
        NotificationManager nm = ctx.getSystemService(NotificationManager.class);
        if (nm == null) return false;
        SharedPreferences sp = ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
        File dir = new File(ctx.getFilesDir(), "sounds");
        File file = new File(dir, slug.replaceAll("[^A-Za-z0-9_-]", "") + ".mp3");
        boolean fresh = file.exists() && file.length() > 0 && version.equals(sp.getString(slug, ""));
        if (fresh && nm.getNotificationChannel("snd_" + slug) != null) return true;
        if (!fresh) {
            if (!dir.exists()) //noinspection ResultOfMethodCallIgnored
                dir.mkdirs();
            if (!download(path, file)) return false;
            sp.edit().putString(slug, version).apply();
        }
        MessageChannels.ensureSoundChannel(ctx, slug, name, file);
        return nm.getNotificationChannel("snd_" + slug) != null;
    }

    private static boolean download(String path, File target) {
        for (String origin : ORIGINS) {
            HttpURLConnection c = null;
            File tmp = new File(target.getPath() + ".part");
            try {
                c = (HttpURLConnection) new URL(origin + path).openConnection();
                c.setConnectTimeout(5000);
                c.setReadTimeout(6000);
                if (c.getResponseCode() != 200) continue;
                try (InputStream in = c.getInputStream(); FileOutputStream out = new FileOutputStream(tmp)) {
                    byte[] buf = new byte[8192];
                    int n;
                    while ((n = in.read(buf)) > 0) out.write(buf, 0, n);
                }
                if (tmp.length() > 0 && tmp.renameTo(target)) return true;
            } catch (Exception ignored) {
                // Следующий адрес.
            } finally {
                if (c != null) c.disconnect();
                //noinspection ResultOfMethodCallIgnored
                tmp.delete();
            }
        }
        return false;
    }

    /**
     * Один раз — убрать накачанный раньше каталог: файлы и каналы snd_*.
     * Нужные звуки вернутся сами, когда их пришлют.
     */
    static int cleanupOnce(Context ctx) {
        SharedPreferences sp = ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
        if (sp.getBoolean("_cleaned", false)) return 0;
        int freed = 0;
        File[] files = new File(ctx.getFilesDir(), "sounds").listFiles();
        if (files != null) for (File f : files) {
            freed += (int) (f.length() / 1024);
            //noinspection ResultOfMethodCallIgnored
            f.delete();
        }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            NotificationManager nm = ctx.getSystemService(NotificationManager.class);
            if (nm != null) for (android.app.NotificationChannel ch : nm.getNotificationChannels()) {
                if (ch.getId().startsWith("snd_")) nm.deleteNotificationChannel(ch.getId());
            }
        }
        sp.edit().clear().putBoolean("_cleaned", true).apply();
        return freed;
    }
}
