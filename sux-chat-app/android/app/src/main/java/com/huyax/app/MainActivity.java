package com.huyax.app;

import android.app.KeyguardManager;
import android.content.Intent;
import android.os.Build;
import android.os.Bundle;
import android.view.View;
import android.view.ViewGroup;
import android.view.WindowInsets;
import android.view.WindowManager;
import android.webkit.WebView;
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
        registerPlugin(PushSecretPlugin.class);
        registerPlugin(RovHapticsPlugin.class);
        super.onCreate(savedInstanceState);
        MessageChannels.ensure(this);
        handleCallIntent(getIntent());
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) installImeResize();
    }

    /**
     * Клавиатура: ужимаем WebView ровно на то, насколько она его перекрывает.
     *
     * С targetSdk 35 на Android 15 окно всегда edge-to-edge, и
     * windowSoftInputMode=adjustResize система игнорирует: WebView остаётся во
     * весь экран, Chrome в одиночку ужимает только визуальный viewport и
     * панорамирует его к полю ввода — интерфейс прыгает при каждом росте поля
     * (баг-репорт 393ea44d, MI 8 / Android 15). На прошивках, где система окно
     * ужимает сама, перекрытие получается нулевым — и мы ничего не трогаем, так
     * что двойного сдвига не бывает. Отступ ставим родителю WebView: паддинг у
     * самого WebView содержимое не двигает.
     */
    private void installImeResize() {
        final View decor = getWindow().getDecorView();
        decor.setOnApplyWindowInsetsListener((v, insets) -> {
            WebView web = getBridge() != null ? getBridge().getWebView() : null;
            if (web != null && web.getParent() instanceof ViewGroup) {
                ViewGroup parent = (ViewGroup) web.getParent();
                int imeBottom = insets.getInsets(WindowInsets.Type.ime()).bottom;
                int[] d = new int[2];
                decor.getLocationOnScreen(d);
                int[] p = new int[2];
                parent.getLocationOnScreen(p);
                int imeTop = d[1] + decor.getHeight() - imeBottom;
                // Низ считаем по родителю, а не по WebView: высота родителя от
                // нашего паддинга не меняется. Считать от WebView нельзя — пока
                // раскладка не прошла, его высота старая, а паддинг уже новый,
                // перекрытие росло с каждым проходом, и инсеты крутились по
                // кругу до ANR.
                int parentBottom = p[1] + parent.getHeight();
                int overlap = imeBottom > 0 ? Math.max(0, parentBottom - imeTop) : 0;
                if (parent.getPaddingBottom() != overlap) {
                    parent.setPadding(parent.getPaddingLeft(), parent.getPaddingTop(), parent.getPaddingRight(), overlap);
                }
            }
            return v.onApplyWindowInsets(insets);
        });
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
