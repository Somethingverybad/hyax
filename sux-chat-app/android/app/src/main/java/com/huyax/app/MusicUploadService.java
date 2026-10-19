package com.huyax.app;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.pm.ServiceInfo;
import android.os.Build;
import android.os.IBinder;
import android.os.PowerManager;
import android.util.Log;
import androidx.core.app.NotificationCompat;
import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.Iterator;
import java.util.UUID;
import org.json.JSONArray;
import org.json.JSONObject;

/**
 * Загрузка своих треков, пока экран заблокирован (MusicUploadPlugin).
 *
 * Служба переднего плана: без неё система усыпляет процесс, и загрузка
 * обрывается вместе с WebView. Треки — по одному, в шторке «Загрузка музыки»
 * с процентами. CDN оборвал или не принял большой файл — тот же запрос на
 * прямой адрес; сеть пропала — несколько попыток с паузой. Не вышло — запись
 * «failed», интерфейс покажет и повторит сам (src/lib/trackUploads.ts).
 * Кончилась очередь — служба уходит.
 */
public class MusicUploadService extends Service {

    private static final String TAG = "MusicUpload";
    private static final int ID = 4251;
    static final String CHANNEL_ID = "music_upload";
    private static final int MAX_ATTEMPTS = 4;

    private Thread worker;
    private volatile boolean stopping;
    private PowerManager.WakeLock wake;

    /** Разбудить очередь. Из фона Android 12+ может не дать запустить службу —
     *  тогда записи ждут, пока приложение вернётся на экран (plugin.handleOnResume). */
    static boolean kick(Context ctx) {
        if (MusicUploadStore.next(ctx) == null) return true;
        Intent intent = new Intent(ctx, MusicUploadService.class);
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) ctx.startForegroundService(intent);
            else ctx.startService(intent);
            return true;
        } catch (Exception e) {
            Log.w(TAG, "служба не запустилась: " + e);
            return false;
        }
    }

    static void ensureChannel(Context ctx) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return;
        NotificationManager nm = ctx.getSystemService(NotificationManager.class);
        String title = NativeLang.str(ctx, R.string.channel_music_upload);
        NotificationChannel existing = nm.getNotificationChannel(CHANNEL_ID);
        if (existing != null) {
            MessageChannels.rename(nm, existing, title);
            return;
        }
        NotificationChannel ch = new NotificationChannel(CHANNEL_ID, title, NotificationManager.IMPORTANCE_LOW);
        ch.setSound(null, null);
        ch.enableVibration(false);
        nm.createNotificationChannel(ch);
    }

    private Notification notification(String name, int progress) {
        int[] c = MusicUploadStore.counts(this);
        int done = c[1] - c[0];
        Context l = NativeLang.context(this);
        Intent open = new Intent(this, MainActivity.class)
            .setAction(Intent.ACTION_MAIN)
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        PendingIntent pi = PendingIntent.getActivity(
            this, 6, open, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        String title = l.getString(R.string.music_upload_title);
        if (c[1] > 1) title += " · " + Math.min(done + 1, c[1]) + "/" + c[1];
        return new NotificationCompat.Builder(this, CHANNEL_ID)
            .setSmallIcon(R.mipmap.ic_launcher)
            .setContentTitle(title)
            .setContentText(name == null ? "" : name)
            .setProgress(100, progress, progress <= 0)
            .setOngoing(true)
            .setSilent(true)
            .setOnlyAlertOnce(true)
            .setCategory(NotificationCompat.CATEGORY_PROGRESS)
            .setContentIntent(pi)
            .build();
    }

    private void show(String name, int progress) {
        NotificationManager nm = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
        try { nm.notify(ID, notification(name, progress)); } catch (Exception ignored) {}
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        ensureChannel(this);
        Notification n = notification(null, 0);
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                startForeground(ID, n, ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC);
            } else {
                startForeground(ID, n);
            }
        } catch (Exception e) {
            Log.w(TAG, "startForeground: " + e);
            stopSelf();
            return START_NOT_STICKY;
        }
        synchronized (this) {
            if (worker == null || !worker.isAlive()) {
                stopping = false;
                worker = new Thread(this::loop, "music-upload");
                worker.start();
            }
        }
        return START_NOT_STICKY;
    }

    /** Android 15: у dataSync лимит времени — уходим, остальное догрузит следующий запуск. */
    @Override
    public void onTimeout(int startId, int fgsType) {
        stopping = true;
        stopSelf();
    }

    @Override
    public void onDestroy() {
        stopping = true;
        if (worker != null) worker.interrupt();
        releaseWake();
        super.onDestroy();
    }

    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }

    private void holdWake() {
        if (wake == null) {
            PowerManager pm = (PowerManager) getSystemService(Context.POWER_SERVICE);
            wake = pm.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "wyx:music-upload");
            wake.setReferenceCounted(false);
        }
        wake.acquire(30 * 60 * 1000L);
    }

    private void releaseWake() {
        if (wake != null && wake.isHeld()) wake.release();
    }

    private void loop() {
        try {
            while (!stopping) {
                JSONObject r = MusicUploadStore.next(this);
                if (r == null) break;
                holdWake();
                send(r);
            }
        } finally {
            releaseWake();
            synchronized (this) { worker = null; }
            if (!stopping) {
                stopForeground(true);
                stopSelf();
            }
        }
    }

    /** Одна загрузка: перебор адресов и попыток, итог — в запись и интерфейс. */
    private void send(JSONObject r) {
        String id = r.optString("id");
        File file = new File(r.optString("path"));
        if (!file.isFile()) {
            fail(r, 0, NativeLang.str(this, R.string.music_upload_missing));
            return;
        }
        JSONArray urls = r.optJSONArray("urls");
        int n = urls == null ? 0 : urls.length();
        int urlIndex = Math.max(0, Math.min(r.optInt("urlIndex"), n - 1));
        int attempts = r.optInt("attempts");
        if (n == 0) {
            fail(r, 0, null);
            return;
        }
        while (!stopping) {
            int[] status = new int[1];
            String reply = post(r, urls.optString(urlIndex), file, status);
            if (stopping || MusicUploadStore.get(this, id) == null) return;
            int http = status[0];
            if (http >= 200 && http < 300) {
                MusicUploadStore.patch(this, id, "path", "", false);
                //noinspection ResultOfMethodCallIgnored
                file.delete();
                try {
                    r.put("status", "done"); r.put("progress", 100); r.put("http", http);
                    r.put("response", reply == null ? "" : reply); r.put("token", ""); r.put("path", "");
                    r.remove("error");
                } catch (Exception ignored) {}
                // Пока шла загрузка, её могли забыть (forget) — не воскрешать.
                if (MusicUploadStore.get(this, id) == null) return;
                MusicUploadStore.put(this, r);
                MusicUploadStore.emit("done", r);
                return;
            }
            boolean retryable = http == 0 || http == 408 || http == 413 || http >= 500;
            if (retryable && urlIndex + 1 < n) {
                urlIndex++;
                MusicUploadStore.patch(this, id, "urlIndex", urlIndex, true);
                continue;
            }
            if (retryable && attempts + 1 < MAX_ATTEMPTS) {
                attempts++;
                MusicUploadStore.patch(this, id, "attempts", attempts, true);
                try { Thread.sleep(Math.min(60_000L, 5_000L << (attempts - 1))); } catch (InterruptedException e) { return; }
                if (MusicUploadStore.get(this, id) == null) return;
                continue;
            }
            fail(r, http, errorText(reply));
            return;
        }
    }

    private void fail(JSONObject r, int http, String error) {
        try {
            r.put("status", "failed"); r.put("progress", 0); r.put("http", http); r.put("token", "");
            if (error != null && !error.isEmpty()) r.put("error", error); else r.remove("error");
        } catch (Exception ignored) {}
        if (MusicUploadStore.get(this, r.optString("id")) == null) return;
        MusicUploadStore.put(this, r);
        MusicUploadStore.emit("failed", r);
    }

    private static String errorText(String reply) {
        if (reply == null) return null;
        try { return new JSONObject(reply).optString("error", null); } catch (Exception e) { return null; }
    }

    /** multipart/form-data: поля, затем файл "file" — потоком, с процентами. */
    private String post(JSONObject r, String target, File file, int[] status) {
        String id = r.optString("id");
        String name = r.optString("name", "track").replace('"', '\'').replace('\r', ' ').replace('\n', ' ');
        String boundary = "wyx-" + UUID.randomUUID();
        StringBuilder head = new StringBuilder();
        JSONObject fields = r.optJSONObject("fields");
        if (fields != null) {
            for (Iterator<String> it = fields.keys(); it.hasNext(); ) {
                String k = it.next();
                head.append("--").append(boundary).append("\r\nContent-Disposition: form-data; name=\"")
                    .append(k).append("\"\r\n\r\n").append(fields.optString(k)).append("\r\n");
            }
        }
        head.append("--").append(boundary).append("\r\nContent-Disposition: form-data; name=\"file\"; filename=\"")
            .append(name).append("\"\r\nContent-Type: application/octet-stream\r\n\r\n");
        byte[] h = head.toString().getBytes(StandardCharsets.UTF_8);
        byte[] t = ("\r\n--" + boundary + "--\r\n").getBytes(StandardCharsets.UTF_8);
        long total = h.length + file.length() + t.length;
        HttpURLConnection c = null;
        try {
            c = (HttpURLConnection) new URL(target).openConnection();
            c.setRequestMethod("POST");
            c.setDoOutput(true);
            c.setConnectTimeout(30_000);
            c.setReadTimeout(180_000);
            c.setRequestProperty("Content-Type", "multipart/form-data; boundary=" + boundary);
            String token = r.optString("token", "");
            if (!token.isEmpty()) c.setRequestProperty("Authorization", "Bearer " + token);
            c.setFixedLengthStreamingMode(total);
            show(r.optString("name"), 0);
            int last = -1;
            long sent = 0;
            try (OutputStream out = c.getOutputStream(); InputStream in = new FileInputStream(file)) {
                out.write(h);
                sent += h.length;
                byte[] buf = new byte[64 * 1024];
                int k;
                while ((k = in.read(buf)) > 0) {
                    if (stopping) return null;
                    out.write(buf, 0, k);
                    sent += k;
                    int p = (int) Math.min(99, sent * 100 / total);
                    if (p != last) {
                        last = p;
                        MusicUploadStore.patch(this, id, "progress", p, false);
                        JSONObject ev = MusicUploadStore.get(this, id);
                        if (ev == null) return null; // загрузку забыли — бросаем
                        MusicUploadStore.emit("progress", ev);
                        if (p % 5 == 0) show(r.optString("name"), p);
                    }
                }
                out.write(t);
            }
            status[0] = c.getResponseCode();
            InputStream rs = status[0] >= 400 ? c.getErrorStream() : c.getInputStream();
            if (rs == null) return null;
            try (InputStream in = rs) {
                ByteArrayOutputStream bo = new ByteArrayOutputStream();
                byte[] buf = new byte[8192];
                int k;
                while ((k = in.read(buf)) > 0) bo.write(buf, 0, k);
                return bo.toString("UTF-8");
            }
        } catch (Exception e) {
            Log.w(TAG, "загрузка оборвалась: " + e);
            status[0] = 0;
            return null;
        } finally {
            if (c != null) c.disconnect();
        }
    }
}
