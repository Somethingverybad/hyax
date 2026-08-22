package com.huyax.app;

import androidx.annotation.NonNull;
import com.google.firebase.messaging.FirebaseMessagingService;
import com.google.firebase.messaging.RemoteMessage;
import io.capawesome.capacitorjs.plugins.firebase.messaging.FirebaseMessagingPlugin;
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
        FirebaseMessagingPlugin.onMessageReceived(remoteMessage);
    }
}
