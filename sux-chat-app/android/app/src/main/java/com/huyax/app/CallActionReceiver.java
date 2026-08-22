package com.huyax.app;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import org.json.JSONObject;

/** Кнопка «Отклонить» на уведомлении о звонке. */
public class CallActionReceiver extends BroadcastReceiver {
    @Override
    public void onReceive(Context context, Intent intent) {
        CallNotifications.cancel(context);
        String callId = null;
        try {
            String json = intent.getStringExtra(CallNotifications.EXTRA_CALL);
            if (json != null) callId = new JSONObject(json).optString("callId");
        } catch (Exception ignored) {}
        VoipPlugin.deliverEnded(callId);
    }
}
