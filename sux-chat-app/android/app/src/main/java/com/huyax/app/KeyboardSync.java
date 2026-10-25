package com.huyax.app;

import android.os.Build;
import android.view.View;
import android.view.ViewGroup;
import android.view.Window;
import android.view.animation.Interpolator;
import android.webkit.WebView;
import androidx.annotation.NonNull;
import androidx.annotation.RequiresApi;
import androidx.core.graphics.Insets;
import androidx.core.view.ViewCompat;
import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsAnimationCompat;
import androidx.core.view.WindowInsetsCompat;
import com.getcapacitor.BridgeActivity;
import java.util.List;
import java.util.Locale;

/**
 * Клавиатура на Android 11+ — синхронно с её анимацией, как на iPhone
 * (KeyboardSyncPlugin.swift).
 *
 * Раньше WebView ужимался под клавиатуру паддингом родителя (MainActivity,
 * installImeResize). Но при анимации клавиатуры Android сразу отдаёт в
 * onApplyWindowInsets её итоговую высоту — раскладка встаёт в конечное
 * положение за один кадр, а сама клавиатура выезжает ещё ~285 мс: чат резко
 * прыгал вверх, а при закрытии поле ввода падало под ещё не уехавшую
 * клавиатуру. Так делают Telegram и WhatsApp: раскладка не скачет, вид
 * сдвигается в такт анимации системы.
 *
 * Как здесь:
 *  - WebView клавиатуру не видит (инсет IME вырезан): иначе Chrome сам
 *    ужимает визуальный viewport и панорамирует его к полю ввода;
 *  - в начале анимации странице уходит итоговое перекрытие, настоящая
 *    длительность и кривая системы (снятая с интерполятора) — страница
 *    поднимает поле ввода и ленту transform-ом с теми же временем и кривой;
 *  - поле вне поднимаемых панелей (формы, поиск, мини-приложения) — режим
 *    «cut»: в конце анимации открытия WebView ужимается (место под
 *    клавиатурой — разрыв не виден), при закрытии растёт сразу в начале.
 *
 * Включается только по вызову enable() со страницы: бандл без поддержки
 * (старый по воздуху) получает прежнее поведение MainActivity.
 */
@RequiresApi(api = Build.VERSION_CODES.R)
final class KeyboardSync {

    static KeyboardSync instance;

    private static final int IME = WindowInsetsCompat.Type.ime();
    /** Смена высоты без анимации системы: эмодзи, строка подсказок, плавающая клавиатура. */
    private static final int CHANGE_MS = 160;
    /** Точек кривой для CSS linear(): 17 — с запасом для любой гладкой кривой. */
    private static final int EASE_POINTS = 17;

    private final BridgeActivity activity;
    private boolean enabled = false;
    private boolean cut = false;
    private boolean animating = false;
    private boolean userDriven = false;
    private int lastSent = -1;

    KeyboardSync(BridgeActivity activity) {
        this.activity = activity;
        instance = this;
    }

    boolean isEnabled() {
        return enabled;
    }

    /** Страница берёт клавиатуру на себя. Только с главного потока. */
    void enable() {
        if (enabled) {
            claim();
            return;
        }
        WebView web = web();
        if (web == null) return;
        enabled = true;
        Window w = activity.getWindow();
        // Окно не подгоняется под системные панели и клавиатуру: на Android
        // 11–14 иначе ужимала бы раскладку уже система — тот же скачок.
        // Отступы под панели страница берёт из InsetsPlugin (--sat/--sab), как
        // на Android 15+, где окно и так во весь экран.
        WindowCompat.setDecorFitsSystemWindows(w, false);
        ViewCompat.setOnApplyWindowInsetsListener(web, (v, insets) -> {
            if (!animating) {
                int o = overlap(insets);
                if (o != lastSent) send(o, CHANGE_MS, null);
                setPad(cut ? o : 0);
            }
            WindowInsetsCompat stripped = new WindowInsetsCompat.Builder(insets)
                .setInsets(IME, Insets.NONE)
                .setVisible(IME, false)
                .build();
            return ViewCompat.onApplyWindowInsets(v, stripped);
        });
        setPad(0);
        claim();
        ViewCompat.requestApplyInsets(w.getDecorView());
    }

    /** Поле вне поднимаемых панелей: WebView ужимается под открытую клавиатуру. */
    void setCut(boolean value) {
        cut = value;
        if (enabled && !animating && lastSent > 0) setPad(cut ? lastSent : 0);
    }

    /**
     * Свой обработчик анимации — на корень окна, как и у штатного плагина
     * клавиатуры (у вида он один, последний заменяет прежний). Плагин ставит
     * свой из фонового потока при загрузке, поэтому свой ставим позже —
     * когда страница уже загружена и позвала enable().
     */
    void claim() {
        View decor = activity.getWindow().getDecorView();
        decor.post(() -> ViewCompat.setWindowInsetsAnimationCallback(decor, callback));
    }

    private final WindowInsetsAnimationCompat.Callback callback =
        new WindowInsetsAnimationCompat.Callback(WindowInsetsAnimationCompat.Callback.DISPATCH_MODE_CONTINUE_ON_SUBTREE) {
            @Override
            public void onPrepare(@NonNull WindowInsetsAnimationCompat animation) {
                // До onApplyWindowInsets с итоговыми значениями: там их не трогаем.
                if (isIme(animation)) animating = true;
            }

            @NonNull
            @Override
            public WindowInsetsAnimationCompat.BoundsCompat onStart(
                @NonNull WindowInsetsAnimationCompat animation,
                @NonNull WindowInsetsAnimationCompat.BoundsCompat bounds
            ) {
                if (!isIme(animation) || !enabled) return bounds;
                WindowInsetsCompat root = ViewCompat.getRootWindowInsets(activity.getWindow().getDecorView());
                int target = root != null ? overlap(root) : 0;
                long duration = animation.getDurationMillis();
                userDriven = duration <= 0;
                // Закрытие: WebView растёт сразу — открывшаяся полоса ещё под клавиатурой.
                if (target == 0) setPad(0);
                if (!userDriven) send(target, duration, sample(animation.getInterpolator()));
                return bounds;
            }

            @NonNull
            @Override
            public WindowInsetsCompat onProgress(
                @NonNull WindowInsetsCompat insets,
                @NonNull List<WindowInsetsAnimationCompat> running
            ) {
                // Анимацию ведёт жест (например, «назад» с предпросмотром) —
                // длительности нет, отдаём кадры по ходу.
                if (enabled && userDriven) {
                    int o = overlap(insets);
                    if (o != lastSent) send(o, 0, null);
                }
                return insets;
            }

            @Override
            public void onEnd(@NonNull WindowInsetsAnimationCompat animation) {
                if (!isIme(animation)) return;
                animating = false;
                userDriven = false;
                if (!enabled) return;
                WindowInsetsCompat root = ViewCompat.getRootWindowInsets(activity.getWindow().getDecorView());
                int now = root != null ? overlap(root) : 0;
                if (now != lastSent) send(now, 0, null);
                // Открылась: в режиме «cut» WebView ужимается сейчас — под клавиатурой.
                setPad(cut ? now : 0);
            }
        };

    private static boolean isIme(WindowInsetsAnimationCompat a) {
        return (a.getTypeMask() & IME) != 0;
    }

    private WebView web() {
        return activity.getBridge() != null ? activity.getBridge().getWebView() : null;
    }

    /**
     * Насколько клавиатура перекрывает WebView, в пикселях устройства. Низ —
     * по родителю: его высота от нашего паддинга не меняется (см. MainActivity).
     */
    private int overlap(WindowInsetsCompat insets) {
        WebView web = web();
        if (web == null || !(web.getParent() instanceof ViewGroup)) return 0;
        if (!insets.isVisible(IME)) return 0;
        int imeBottom = insets.getInsets(IME).bottom;
        if (imeBottom <= 0) return 0;
        View decor = activity.getWindow().getDecorView();
        ViewGroup parent = (ViewGroup) web.getParent();
        int[] d = new int[2];
        decor.getLocationOnScreen(d);
        int[] p = new int[2];
        parent.getLocationOnScreen(p);
        int imeTop = d[1] + decor.getHeight() - imeBottom;
        return Math.max(0, p[1] + parent.getHeight() - imeTop);
    }

    private void setPad(int px) {
        WebView web = web();
        if (web == null || !(web.getParent() instanceof ViewGroup)) return;
        ViewGroup parent = (ViewGroup) web.getParent();
        if (parent.getPaddingBottom() != px) {
            parent.setPadding(parent.getPaddingLeft(), parent.getPaddingTop(), parent.getPaddingRight(), px);
        }
    }

    private static float[] sample(Interpolator ip) {
        if (ip == null) return null;
        float[] out = new float[EASE_POINTS];
        for (int i = 0; i < EASE_POINTS; i++) out[i] = ip.getInterpolation(i / (float) (EASE_POINTS - 1));
        return out;
    }

    /** Кадр клавиатуры — событием окна прямо из evaluateJavascript, как на iOS. */
    private void send(int px, long duration, float[] ease) {
        lastSent = px;
        WebView web = web();
        if (web == null) return;
        StringBuilder e = new StringBuilder();
        if (ease == null) {
            e.append("null");
        } else {
            e.append('[');
            for (int i = 0; i < ease.length; i++) {
                if (i > 0) e.append(',');
                e.append(String.format(Locale.US, "%.4f", ease[i]));
            }
            e.append(']');
        }
        String js = "window.dispatchEvent(new CustomEvent('hyax:kbframe',{detail:{px:" + px
            + ",duration:" + Math.max(0, duration) + ",ease:" + e + ",ts:" + System.currentTimeMillis() + "}}))";
        web.evaluateJavascript(js, null);
    }
}
