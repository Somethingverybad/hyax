package com.huyax.app;

import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.content.Context;
import android.media.AudioAttributes;
import android.net.Uri;
import android.os.Build;

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
    private static final String[] LEGACY = {"messages", "fcm_fallback_notification_channel"};

    private MessageChannels() {}

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
