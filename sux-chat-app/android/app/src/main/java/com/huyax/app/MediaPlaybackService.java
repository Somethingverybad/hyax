package com.huyax.app;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.content.pm.ServiceInfo;
import android.media.AudioManager;
import android.media.MediaMetadata;
import android.media.session.MediaSession;
import android.media.session.PlaybackState;
import android.os.Build;
import android.os.Handler;
import android.os.IBinder;
import android.os.Looper;
import android.os.PowerManager;
import android.os.SystemClock;
import android.util.Log;

/**
 * Музыка и эфир при заблокированном экране (MediaPlaybackPlugin,
 * src/lib/nativeMedia.ts).
 *
 * Звук играет WebView (src/lib/player.ts), служба держит процесс на переднем
 * плане: без неё Android 14+ через несколько секунд после блокировки
 * замораживает приложение, и музыка глохнет — в динамике и в наушниках
 * одинаково (баг-репорт 6ff984d2, TECNO / Android 15). Заодно — карточка
 * плеера в шторке и на экране блокировки, кнопки гарнитуры и пауза, когда
 * выдернули наушники.
 *
 * На паузе дольше 10 минут служба уходит — снова встанет, когда музыку
 * включат в приложении.
 */
public class MediaPlaybackService extends Service {

    private static final String TAG = "MediaPlayback";
    private static final int ID = 4252;
    static final String CHANNEL_ID = "music_playback";
    private static final String EXTRA_CMD = "cmd";
    /** Пауза дольше — служба уходит. */
    private static final long IDLE_MS = 10 * 60_000L;
    /** Между треками плеер на миг встаёт на паузу — процессор не отпускаем сразу,
     *  иначе следующий трек не успеет скачаться при погасшем экране. */
    private static final long WAKE_HOLD_MS = 20_000L;
    private static final long WAKE_MAX_MS = 4 * 3600_000L;

    /** Что играет — как прислал JS. */
    static final class Info {
        String title = "";
        String artist = "";
        boolean playing;
        boolean live;
        boolean hasPrev;
        boolean hasNext;
        long positionMs;
        long durationMs;
    }

    /** Команды кнопок в JS (MediaPlaybackPlugin). */
    interface Commands { void send(String cmd, double position); }
    static volatile Commands commands;

    static volatile MediaPlaybackService instance;
    private static volatile Info latest;

    private final Handler main = new Handler(Looper.getMainLooper());
    private final Runnable idle = this::quit;
    private final Runnable releaseWake = this::releaseWake;
    private MediaSession session;
    private PowerManager.WakeLock wake;
    private Info info = new Info();
    private boolean noisyRegistered;
    /** quit() уже был: обновления сюда не идут, иначе карточка осталась бы без службы. */
    private volatile boolean quitting;

    private final BroadcastReceiver noisy = new BroadcastReceiver() {
        @Override
        public void onReceive(Context ctx, Intent intent) {
            // Выдернули наушники — не орать на весь автобус.
            if (AudioManager.ACTION_AUDIO_BECOMING_NOISY.equals(intent.getAction()) && info.playing) send("pause", 0);
        }
    };

    /** Новое состояние плеера. Служба не идёт — запускаем, только если что-то
     *  играет: включают музыку из приложения, оно на экране, и Android пускает. */
    static void update(Context ctx, Info i) {
        latest = i;
        MediaPlaybackService s = instance;
        if (s != null && !s.quitting) {
            s.main.post(() -> s.apply(i));
            return;
        }
        if (!i.playing) return;
        Intent intent = new Intent(ctx, MediaPlaybackService.class);
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) ctx.startForegroundService(intent);
            else ctx.startService(intent);
        } catch (Exception e) {
            Log.w(TAG, "служба не запустилась: " + e);
        }
    }

    /** Плеер закрыли. */
    static void stop() {
        latest = null;
        MediaPlaybackService s = instance;
        if (s != null) s.main.post(s::quit);
    }

    static void ensureChannel(Context ctx) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return;
        NotificationManager nm = ctx.getSystemService(NotificationManager.class);
        String title = NativeLang.str(ctx, R.string.channel_music_playback);
        NotificationChannel existing = nm.getNotificationChannel(CHANNEL_ID);
        if (existing != null) {
            MessageChannels.rename(nm, existing, title);
            return;
        }
        NotificationChannel ch = new NotificationChannel(CHANNEL_ID, title, NotificationManager.IMPORTANCE_LOW);
        ch.setSound(null, null);
        ch.enableVibration(false);
        ch.setShowBadge(false);
        ch.setLockscreenVisibility(Notification.VISIBILITY_PUBLIC);
        nm.createNotificationChannel(ch);
    }

    @Override
    public void onCreate() {
        super.onCreate();
        instance = this;
        session = new MediaSession(this, "WYX");
        session.setCallback(new MediaSession.Callback() {
            @Override public void onPlay() { send("play", 0); }
            @Override public void onPause() { send("pause", 0); }
            @Override public void onSkipToNext() { send("next", 0); }
            @Override public void onSkipToPrevious() { send("prev", 0); }
            @Override public void onStop() { send("stop", 0); }
            @Override public void onSeekTo(long pos) { send("seek", pos / 1000.0); }
        });
        Intent open = new Intent(this, MainActivity.class)
            .setAction(Intent.ACTION_MAIN)
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        session.setSessionActivity(PendingIntent.getActivity(
            this, 7, open, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE));
        session.setActive(true);
        try {
            registerReceiver(noisy, new IntentFilter(AudioManager.ACTION_AUDIO_BECOMING_NOISY));
            noisyRegistered = true;
        } catch (Exception ignored) {}
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        String cmd = intent != null ? intent.getStringExtra(EXTRA_CMD) : null;
        if (cmd != null) {
            // Смахнули карточку на паузе — служба уходит, плеер в приложении остаётся.
            if ("dismiss".equals(cmd)) { if (!info.playing) quit(); }
            else send(cmd, 0);
            if (latest == null) stopSelf();
            return START_NOT_STICKY;
        }
        // Запущена через startForegroundService — startForeground обязателен,
        // даже если плеер успели закрыть, иначе Android уронит приложение.
        Info i = latest;
        ensureChannel(this);
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                startForeground(ID, notification(i != null ? i : info), ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PLAYBACK);
            } else {
                startForeground(ID, notification(i != null ? i : info));
            }
        } catch (Exception e) {
            Log.w(TAG, "startForeground: " + e);
            quit();
            return START_NOT_STICKY;
        }
        if (i == null) quit();
        else apply(i);
        return START_NOT_STICKY;
    }

    private void send(String cmd, double position) {
        Commands c = commands;
        if (c != null) c.send(cmd, position);
    }

    private void apply(Info i) {
        if (quitting) return;
        info = i;
        MediaMetadata.Builder meta = new MediaMetadata.Builder()
            .putString(MediaMetadata.METADATA_KEY_TITLE, i.title)
            .putString(MediaMetadata.METADATA_KEY_ARTIST, i.artist);
        if (i.durationMs > 0) meta.putLong(MediaMetadata.METADATA_KEY_DURATION, i.durationMs);
        session.setMetadata(meta.build());

        long actions = PlaybackState.ACTION_PLAY | PlaybackState.ACTION_PAUSE
            | PlaybackState.ACTION_PLAY_PAUSE | PlaybackState.ACTION_STOP;
        // Эфир идёт по расписанию: ни перемотки, ни переключения.
        if (!i.live) actions |= PlaybackState.ACTION_SEEK_TO;
        if (i.hasNext) actions |= PlaybackState.ACTION_SKIP_TO_NEXT;
        if (i.hasPrev) actions |= PlaybackState.ACTION_SKIP_TO_PREVIOUS;
        session.setPlaybackState(new PlaybackState.Builder()
            .setActions(actions)
            .setState(i.playing ? PlaybackState.STATE_PLAYING : PlaybackState.STATE_PAUSED,
                      i.positionMs, i.playing ? 1f : 0f, SystemClock.elapsedRealtime())
            .build());

        NotificationManager nm = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
        try { nm.notify(ID, notification(i)); } catch (Exception ignored) {}

        main.removeCallbacks(idle);
        main.removeCallbacks(releaseWake);
        if (i.playing) {
            holdWake();
        } else {
            main.postDelayed(releaseWake, WAKE_HOLD_MS);
            main.postDelayed(idle, IDLE_MS);
        }
    }

    private PendingIntent action(String cmd, int req) {
        Intent intent = new Intent(this, MediaPlaybackService.class).putExtra(EXTRA_CMD, cmd);
        return PendingIntent.getService(this, req, intent, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    }

    private Notification notification(Info i) {
        Context l = NativeLang.context(this);
        Notification.Builder b = Build.VERSION.SDK_INT >= Build.VERSION_CODES.O
            ? new Notification.Builder(this, CHANNEL_ID)
            : new Notification.Builder(this);
        b.setSmallIcon(R.mipmap.ic_launcher)
            .setContentTitle(i.title)
            .setContentText(i.artist)
            .setContentIntent(session.getController().getSessionActivity())
            .setVisibility(Notification.VISIBILITY_PUBLIC)
            .setCategory(Notification.CATEGORY_TRANSPORT)
            .setOnlyAlertOnce(true)
            .setShowWhen(false)
            .setOngoing(i.playing)
            .setDeleteIntent(action("dismiss", 16));
        int n = 0;
        int[] compact = new int[3];
        if (i.hasPrev) {
            b.addAction(new Notification.Action.Builder(android.R.drawable.ic_media_previous,
                l.getString(R.string.media_prev), action("prev", 11)).build());
            compact[n] = n; n++;
        }
        b.addAction(i.playing
            ? new Notification.Action.Builder(android.R.drawable.ic_media_pause, l.getString(R.string.media_pause), action("pause", 12)).build()
            : new Notification.Action.Builder(android.R.drawable.ic_media_play, l.getString(R.string.media_play), action("play", 13)).build());
        compact[n] = n; n++;
        if (i.hasNext) {
            b.addAction(new Notification.Action.Builder(android.R.drawable.ic_media_next,
                l.getString(R.string.media_next), action("next", 14)).build());
            compact[n] = n; n++;
        }
        b.addAction(new Notification.Action.Builder(android.R.drawable.ic_menu_close_clear_cancel,
            l.getString(R.string.media_stop), action("stop", 15)).build());
        int[] shown = new int[n];
        System.arraycopy(compact, 0, shown, 0, n);
        b.setStyle(new Notification.MediaStyle()
            .setMediaSession(session.getSessionToken())
            .setShowActionsInCompactView(shown));
        return b.build();
    }

    private void holdWake() {
        try {
            if (wake == null) {
                PowerManager pm = (PowerManager) getSystemService(Context.POWER_SERVICE);
                wake = pm.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "hyax:music-playback");
                wake.setReferenceCounted(false);
            }
            // Каждое обновление (смена трека, пауза-плей) продлевает срок.
            wake.acquire(WAKE_MAX_MS);
        } catch (Exception ignored) {}
    }

    private void releaseWake() {
        try { if (wake != null && wake.isHeld()) wake.release(); } catch (Exception ignored) {}
    }

    private void quit() {
        quitting = true;
        main.removeCallbacks(idle);
        main.removeCallbacks(releaseWake);
        releaseWake();
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.N) stopForeground(STOP_FOREGROUND_REMOVE);
            else stopForeground(true);
        } catch (Exception ignored) {}
        stopSelf();
    }

    /** Приложение смахнули из недавних — WebView закрыт, звука больше нет. */
    @Override
    public void onTaskRemoved(Intent rootIntent) {
        quit();
        super.onTaskRemoved(rootIntent);
    }

    @Override
    public void onDestroy() {
        if (instance == this) instance = null;
        main.removeCallbacksAndMessages(null);
        releaseWake();
        if (noisyRegistered) {
            try { unregisterReceiver(noisy); } catch (Exception ignored) {}
            noisyRegistered = false;
        }
        if (session != null) {
            session.setActive(false);
            session.release();
        }
        super.onDestroy();
    }

    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }
}
