package com.huyax.app;

import android.app.KeyguardManager;
import android.content.Intent;
import android.os.Build;
import android.os.Bundle;
import android.view.WindowManager;
import com.getcapacitor.BridgeActivity;
import org.json.JSONObject;

public class MainActivity extends BridgeActivity {

    /** Сервису пушей: рисовать уведомление о звонке или отдать экран JS. */
    static volatile boolean isForeground = false;

    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(VoipPlugin.class);
        registerPlugin(NativeCallPlugin.class);
        registerPlugin(InsetsPlugin.class);
        super.onCreate(savedInstanceState);
        MessageChannels.ensure(this);
        handleCallIntent(getIntent());
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        handleCallIntent(intent);
    }

    @Override
    public void onResume() {
        super.onResume();
        isForeground = true;
    }

    @Override
    public void onPause() {
        super.onPause();
        isForeground = false;
    }

    /** Запуск из уведомления о звонке: показать поверх блокировки и отдать JS. */
    private void handleCallIntent(Intent intent) {
        if (intent == null) return;
        String json = intent.getStringExtra(CallNotifications.EXTRA_CALL);
        String action = intent.getStringExtra(CallNotifications.EXTRA_ACTION);
        if (json == null || action == null) return;
        intent.removeExtra(CallNotifications.EXTRA_CALL);
        intent.removeExtra(CallNotifications.EXTRA_ACTION);

        showOverLockScreen();
        CallNotifications.cancel(this);
        try {
            VoipPlugin.deliverCall(new JSONObject(json), CallNotifications.ACTION_ANSWER.equals(action));
        } catch (Exception ignored) {}
    }

    private void showOverLockScreen() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O_MR1) {
            setShowWhenLocked(true);
            setTurnScreenOn(true);
            KeyguardManager km = getSystemService(KeyguardManager.class);
            if (km != null) km.requestDismissKeyguard(this, null);
        } else {
            getWindow().addFlags(
                WindowManager.LayoutParams.FLAG_SHOW_WHEN_LOCKED
                    | WindowManager.LayoutParams.FLAG_TURN_SCREEN_ON
                    | WindowManager.LayoutParams.FLAG_DISMISS_KEYGUARD
            );
        }
    }
}
