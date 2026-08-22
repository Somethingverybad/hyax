package com.huyax.app;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.media.AudioAttributes;
import android.net.Uri;
import android.os.Build;
import androidx.core.app.NotificationCompat;
import androidx.core.app.NotificationManagerCompat;
import org.json.JSONObject;

/**
 * Полноэкранный входящий звонок «как у Telegram»: уведомление категории CALL
 * с full-screen intent (на заблокированном экране открывает приложение
 * поверх блокировки), рингтон call.mp3 из канала, кнопки Ответить/Отклонить.
 */
final class CallNotifications {
    static final String CHANNEL_ID = "calls";
    static final int NOTIFICATION_ID = 4242;
    static final String EXTRA_CALL = "voip_call";
    static final String EXTRA_ACTION = "voip_action";
    static final String ACTION_RING = "ring";
    static final String ACTION_ANSWER = "answer";
    static final String ACTION_DECLINE = "com.huyax.app.CALL_DECLINE";

    private CallNotifications() {}

    static void ensureChannel(Context ctx) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return;
        NotificationManager nm = ctx.getSystemService(NotificationManager.class);
        if (nm.getNotificationChannel(CHANNEL_ID) != null) return;
        NotificationChannel ch = new NotificationChannel(CHANNEL_ID, "Звонки", NotificationManager.IMPORTANCE_HIGH);
        Uri sound = Uri.parse("android.resource://" + ctx.getPackageName() + "/raw/call");
        AudioAttributes attrs = new AudioAttributes.Builder()
            .setUsage(AudioAttributes.USAGE_NOTIFICATION_RINGTONE)
            .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
            .build();
        ch.setSound(sound, attrs);
        ch.enableVibration(true);
        ch.setVibrationPattern(new long[] {0, 800, 600, 800, 600, 800});
        ch.setLockscreenVisibility(Notification.VISIBILITY_PUBLIC);
        ch.setBypassDnd(true);
        nm.createNotificationChannel(ch);
    }

    static JSONObject toJsPayload(java.util.Map<String, String> d) {
        JSONObject o = new JSONObject();
        try {
            o.put("callId", d.get("call_id"));
            o.put("chatId", d.get("chat_id"));
            o.put("fromUserId", d.get("from_user_id"));
            o.put("fromUsername", d.get("from_username"));
            o.put("fromUserAvatar", d.get("from_user_avatar"));
            o.put("callType", d.get("call_type") == null ? "audio" : d.get("call_type"));
            o.put("group", "1".equals(d.get("group")));
            o.put("chatName", d.get("chat_name") == null ? "" : d.get("chat_name"));
        } catch (Exception ignored) {}
        return o;
    }

    static void show(Context ctx, JSONObject call) {
        ensureChannel(ctx);
        boolean isGroup = call.optBoolean("group", false);
        String caller = call.optString("fromUsername", "ХУЯКС");
        String name = isGroup
            ? call.optString("chatName", "Группа") + " · " + caller
            : caller;
        String json = call.toString();

        Intent ring = new Intent(ctx, MainActivity.class)
            .setAction(Intent.ACTION_MAIN)
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP)
            .putExtra(EXTRA_CALL, json)
            .putExtra(EXTRA_ACTION, ACTION_RING);
        Intent answer = new Intent(ctx, MainActivity.class)
            .setAction(Intent.ACTION_MAIN)
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP)
            .putExtra(EXTRA_CALL, json)
            .putExtra(EXTRA_ACTION, ACTION_ANSWER);
        Intent decline = new Intent(ctx, CallActionReceiver.class)
            .setAction(ACTION_DECLINE)
            .putExtra(EXTRA_CALL, json);

        int flags = PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE;
        PendingIntent ringPi = PendingIntent.getActivity(ctx, 1, ring, flags);
        PendingIntent answerPi = PendingIntent.getActivity(ctx, 2, answer, flags);
        PendingIntent declinePi = PendingIntent.getBroadcast(ctx, 3, decline, flags);

        NotificationCompat.Builder b = new NotificationCompat.Builder(ctx, CHANNEL_ID)
            .setSmallIcon(R.mipmap.ic_launcher)
            .setContentTitle(name)
            .setContentText(isGroup ? "Звонок в группе" : "Входящий звонок")
            .setCategory(NotificationCompat.CATEGORY_CALL)
            .setPriority(NotificationCompat.PRIORITY_MAX)
            .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
            .setOngoing(true)
            .setAutoCancel(false)
            .setTimeoutAfter(45_000)
            .setFullScreenIntent(ringPi, true)
            .setContentIntent(ringPi)
            .addAction(0, "Отклонить", declinePi)
            .addAction(0, "Ответить", answerPi);

        Uri sound = Uri.parse("android.resource://" + ctx.getPackageName() + "/raw/call");
        b.setSound(sound).setVibrate(new long[] {0, 800, 600, 800, 600, 800});

        try {
            NotificationManagerCompat.from(ctx).notify(NOTIFICATION_ID, b.build());
        } catch (SecurityException ignored) {
            // Нет разрешения на уведомления (Android 13+) — звонок дойдёт по WebSocket.
        }
    }

    static void cancel(Context ctx) {
        NotificationManagerCompat.from(ctx).cancel(NOTIFICATION_ID);
    }
}
