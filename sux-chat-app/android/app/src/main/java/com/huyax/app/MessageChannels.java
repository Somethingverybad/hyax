package com.huyax.app;

import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.content.Context;
import android.content.Intent;
import android.media.AudioAttributes;
import android.net.Uri;
import android.os.Build;
import androidx.core.content.FileProvider;
import java.io.File;

/**
 * Канал уведомлений о сообщениях.
 *
 * Android фиксирует звук канала при создании и больше его не меняет — если
 * канал однажды появился со стандартным звуком, исправить это можно только
 * новым идентификатором. Поэтому канал версионированный, а старые версии
 * удаляются. Создаём нативно при запуске (и в самом FCM-сервисе): пуш может
 * прийти раньше, чем загрузится веб-часть, и тогда система возьмёт свой
 * канал со своим звуком.
 */
final class MessageChannels {

    static final String MESSAGES = "messages_v2";
    static final String SOUND_GROUP = "sounds";
    private static final String[] LEGACY = {"messages", "fcm_fallback_notification_channel"};

    private MessageChannels() {}

    /**
     * Канал под конкретный аудио-стикер. Файл скачивается в рантайме, поэтому
     * ссылка идёт через FileProvider, а системному интерфейсу выдаётся право
     * на чтение — иначе звук молча заменится стандартным.
     */
    static void ensureSoundChannel(Context ctx, String slug, String title, File file) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return;
        NotificationManager nm = ctx.getSystemService(NotificationManager.class);
        if (nm == null) return;
        String id = "snd_" + slug;
        if (nm.getNotificationChannel(id) != null) return;

        Uri uri = FileProvider.getUriForFile(ctx, ctx.getPackageName() + ".fileprovider", file);
        for (String pkg : new String[] {"com.android.systemui", "android"}) {
            ctx.grantUriPermission(pkg, uri, Intent.FLAG_GRANT_READ_URI_PERMISSION);
        }
        NotificationChannel ch = new NotificationChannel(
            id, title == null || title.isEmpty() ? slug : title, NotificationManager.IMPORTANCE_HIGH);
        ch.setGroup(ensureGroup(nm));
        AudioAttributes attrs = new AudioAttributes.Builder()
            .setUsage(AudioAttributes.USAGE_NOTIFICATION)
            .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
            .build();
        ch.setSound(uri, attrs);
        ch.enableVibration(true);
        nm.createNotificationChannel(ch);
    }

    /** Аудио-стикеры складываем в отдельную группу, чтобы не засорять список. */
    private static String ensureGroup(NotificationManager nm) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            nm.createNotificationChannelGroup(
                new android.app.NotificationChannelGroup(SOUND_GROUP, "Аудио-стикеры"));
        }
        return SOUND_GROUP;
    }

    static void ensure(Context ctx) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return;
        NotificationManager nm = ctx.getSystemService(NotificationManager.class);
        if (nm == null) return;

        for (String old : LEGACY) {
            if (nm.getNotificationChannel(old) != null) nm.deleteNotificationChannel(old);
        }

        if (nm.getNotificationChannel(MESSAGES) == null) {
            NotificationChannel ch = new NotificationChannel(
                MESSAGES, "Сообщения", NotificationManager.IMPORTANCE_HIGH);
            Uri sound = Uri.parse("android.resource://" + ctx.getPackageName() + "/raw/receive");
            AudioAttributes attrs = new AudioAttributes.Builder()
                .setUsage(AudioAttributes.USAGE_NOTIFICATION)
                .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
                .build();
            ch.setSound(sound, attrs);
            ch.enableVibration(true);
            nm.createNotificationChannel(ch);
        }

        CallNotifications.ensureChannel(ctx);
    }
}
