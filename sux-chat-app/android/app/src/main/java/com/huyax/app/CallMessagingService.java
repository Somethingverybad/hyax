package com.huyax.app;

import androidx.annotation.NonNull;
import com.google.firebase.messaging.FirebaseMessagingService;
import com.google.firebase.messaging.RemoteMessage;
import io.capawesome.capacitorjs.plugins.firebase.messaging.FirebaseMessagingPlugin;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Intent;
import android.os.Bundle;
import androidx.core.app.NotificationCompat;
import java.util.Map;
import org.json.JSONObject;

/**
 * Единственный FCM-сервис приложения (сервис плагина убран из манифеста —
 * Android доставляет пуш только одному). Звонки обрабатываем сами — они
 * приходят data-only и должны показать экран вызова даже при убитом
 * приложении; всё остальное отдаём плагину @capacitor-firebase/messaging.
 */
public class CallMessagingService extends FirebaseMessagingService {

    @Override
    public void onCreate() {
        super.onCreate();
        // Пуш может поднять процесс без активити — каналы нужны уже сейчас.
        MessageChannels.ensure(getApplicationContext());
    }

    @Override
    public void onNewToken(@NonNull String token) {
        super.onNewToken(token);
        FirebaseMessagingPlugin.onNewToken(token);
    }

    @Override
    public void onMessageReceived(@NonNull RemoteMessage remoteMessage) {
        super.onMessageReceived(remoteMessage);
        Map<String, String> data = remoteMessage.getData();
        String type = data.get("type");

        if ("incoming_call".equals(type)) {
            JSONObject call = CallNotifications.toJsPayload(data);
            if (MainActivity.isForeground) {
                // Приложение на экране — рисуем свой экран входящего без уведомления.
                VoipPlugin.deliverCall(call, false);
            } else {
                CallNotifications.show(getApplicationContext(), call);
            }
            return;
        }
        if ("call_ended".equals(type)) {
            CallNotifications.cancel(getApplicationContext());
            VoipPlugin.deliverEnded(data.get("call_id"));
            return;
        }
        // Шифрованный пуш о сообщении: текст в поле e (см. PushCrypto).
        // Уведомление строим сами — системе показывать нечего.
        if (data.containsKey("e")) {
            showEncryptedMessage(data);
            return;
        }
        FirebaseMessagingPlugin.onMessageReceived(remoteMessage);
    }

    private void showEncryptedMessage(Map<String, String> data) {
        JSONObject p = PushCrypto.decrypt(getApplicationContext(), data.get("e"));
        String title = p != null ? p.optString("title", "ХУЯКС") : "ХУЯКС";
        String body = p != null ? p.optString("body", "Новое сообщение") : "Новое сообщение";
        String chatId = p != null ? p.optString("chat_id", "") : "";
        String channel = data.get("ch");
        NotificationManager nm = (NotificationManager) getSystemService(NOTIFICATION_SERVICE);
        // Канал аудио-стикера заводит приложение после скачивания звука; если
        // его ещё нет — обычный канал сообщений, звук стандартный.
        if (channel == null || nm.getNotificationChannel(channel) == null) channel = MessageChannels.MESSAGES;

        // Тап открывает чат: плагин @capacitor-firebase/messaging считает
        // уведомление своим, если в intent есть google.message_id, и отдаёт
        // странице data.chat_id — ровно как раньше с системным уведомлением.
        Intent open = new Intent(this, MainActivity.class);
        open.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        Bundle extras = new Bundle();
        extras.putString("google.message_id", "hyax-" + System.currentTimeMillis());
        extras.putString("chat_id", chatId);
        open.putExtras(extras);
        int reqId = chatId.isEmpty() ? 1 : chatId.hashCode();
        PendingIntent pi = PendingIntent.getActivity(this, reqId, open,
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);

        NotificationCompat.Builder b = new NotificationCompat.Builder(this, channel)
            .setSmallIcon(getApplicationInfo().icon)
            .setContentTitle(title)
            .setContentText(body)
            .setStyle(new NotificationCompat.BigTextStyle().bigText(body))
            .setPriority(NotificationCompat.PRIORITY_HIGH)
            .setCategory(NotificationCompat.CATEGORY_MESSAGE)
            .setAutoCancel(true)
            .setContentIntent(pi);
        nm.notify(reqId, b.build());
    }
}
