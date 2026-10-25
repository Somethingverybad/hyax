package com.huyax.app;

import android.content.Context;
import android.content.SharedPreferences;
import android.content.res.Configuration;
import android.os.Build;
import android.provider.Settings;
import android.view.View;
import android.view.ViewGroup;
import android.view.Window;
import android.webkit.WebView;
import androidx.annotation.NonNull;
import androidx.annotation.RequiresApi;
import androidx.core.graphics.Insets;
import androidx.core.view.ViewCompat;
import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsAnimationCompat;
import androidx.core.view.WindowInsetsCompat;
import com.getcapacitor.BridgeActivity;
import java.util.ArrayList;
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
 *  - в начале анимации странице уходит итоговое перекрытие, длительность и
 *    кривая — страница поднимает поле ввода и ленту transform-ом с ними.
 *    Кривую и длительность, которые объявляет система (285 мс,
 *    PathInterpolator), клавиатура не соблюдает: Gboard ведёт анимацию сам —
 *    ~400 мс с длинным хвостом (замер на Redmi, 25.10). Поэтому настоящий ход
 *    каждой анимации записываем по onProgress и запоминаем для этой
 *    клавиатуры (открытие и закрытие отдельно): следующая анимация идёт по
 *    нему. Первая — по замеренной кривой Gboard;
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
    // Запись хода текущей анимации: мс от onStart и доля пути 0..1.
    private long animStart;
    private int animTarget;
    private final List<long[]> track = new ArrayList<>();

    /** Замер Gboard на Redmi 2409BRN2CG (25.10): открытие и закрытие. */
    private static final float[] DEFAULT_SHOW = {0f, .09f, .26f, .42f, .55f, .66f, .76f, .83f, .88f, .92f, .945f, .963f, .975f, .984f, .99f, .995f, 1f};
    private static final float[] DEFAULT_HIDE = {0f, .035f, .153f, .352f, .527f, .648f, .761f, .834f, .884f, .921f, .946f, .963f, .974f, .983f, .989f, .995f, 1f};
    private static final long DEFAULT_SHOW_MS = 400, DEFAULT_HIDE_MS = 360, DEFAULT_OFFSET_MS = 20;

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
                if (o != lastSent) send(o, CHANGE_MS, null, 0);
                if (o > 0) saveSettled(o);
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
                int target = snap(root != null ? overlap(root) : 0);
                checkGen++; // отложенная сверка прошлой анимации больше не нужна
                long duration = animation.getDurationMillis();
                userDriven = duration <= 0;
                // Закрытие: WebView растёт сразу — открывшаяся полоса ещё под клавиатурой.
                if (target == 0) setPad(0);
                animStart = System.currentTimeMillis();
                animTarget = target;
                track.clear();
                if (!userDriven) {
                    Curve c = learned(target > 0);
                    send(target, c.duration, c.ease, c.offset);
                }
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
                    if (o != lastSent) send(o, 0, null, 0);
                }
                // Сырое перекрытие: нормируем потом по тому, куда клавиатура
                // реально пришла, — не по цели из onStart (её поправляет snap).
                if (enabled && track.size() < 200) track.add(new long[] {System.currentTimeMillis() - animStart, overlap(insets)});
                return insets;
            }

            @Override
            public void onEnd(@NonNull WindowInsetsAnimationCompat animation) {
                if (!isIme(animation)) return;
                animating = false;
                userDriven = false;
                if (!enabled) return;
                learn(animTarget > 0);
                WindowInsetsCompat root = ViewCompat.getRootWindowInsets(activity.getWindow().getDecorView());
                int now = root != null ? overlap(root) : 0;
                if (now != lastSent && !close(now, lastSent)) {
                    send(now, 0, null, 0);
                } else if (now != lastSent) {
                    // Чуть другая высота в конце — скорее всего тот же фантом:
                    // система поправит её сама. Сверяем через 300 мс, и если
                    // разница настоящая — едем к ней плавно.
                    final int gen = ++checkGen;
                    activity.getWindow().getDecorView().postDelayed(() -> {
                        if (gen != checkGen || animating) return;
                        WindowInsetsCompat r = ViewCompat.getRootWindowInsets(activity.getWindow().getDecorView());
                        int o = r != null ? overlap(r) : 0;
                        if (o != lastSent) send(o, CHANGE_MS, null, 0);
                        if (o > 0) saveSettled(o);
                        setPad(cut ? o : 0);
                    }, 300);
                }
                if (now > 0 && now == lastSent) saveSettled(now);
                // Открылась: в режиме «cut» WebView ужимается сейчас — под клавиатурой.
                setPad(cut ? lastSent : 0);
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

    private static final class Curve {
        final long duration;
        final long offset;
        final float[] ease;

        Curve(long duration, long offset, float[] ease) {
            this.duration = duration;
            this.offset = offset;
            this.ease = ease;
        }
    }

    private int checkGen = 0;

    /**
     * Устоявшаяся высота клавиатуры. Со второго открытия Gboard в начале
     * анимации отдаёт перекрытие на ~58 px больше настоящего (662 вместо 604
     * на Redmi, 25.10) и через полсекунды сам поправляет — поле ввода
     * подскакивало выше клавиатуры и опускалось. Близкая к запомненной
     * высота — это она; заметно другая (эмодзи, другая раскладка) — новая.
     */
    private String heightKey() {
        int o = activity.getResources().getConfiguration().orientation;
        return key(true) + (o == Configuration.ORIENTATION_LANDSCAPE ? ":land" : ":port") + ":h";
    }

    private void saveSettled(int px) {
        if (prefs().getInt(heightKey(), -1) != px) prefs().edit().putInt(heightKey(), px).apply();
    }

    private boolean close(int a, int b) {
        if (a <= 0 || b <= 0) return false;
        return Math.abs(a - b) <= Math.max(80, Math.max(a, b) * 0.12f);
    }

    private int snap(int target) {
        if (target <= 0) return target;
        int settled = prefs().getInt(heightKey(), -1);
        return close(target, settled) ? settled : target;
    }

    private SharedPreferences prefs() {
        return activity.getSharedPreferences("keyboard_sync", Context.MODE_PRIVATE);
    }

    /** Ключ — клавиатура (у каждой своя анимация) и направление. */
    private String key(boolean show) {
        String ime = null;
        try {
            ime = Settings.Secure.getString(activity.getContentResolver(), Settings.Secure.DEFAULT_INPUT_METHOD);
        } catch (Exception ignored) {}
        // v2: до 25.10 кривые учились по цели из onStart и укорачивались.
        return (ime == null ? "ime" : ime) + (show ? ":show" : ":hide") + ":v2";
    }

    private Curve learned(boolean show) {
        String v = prefs().getString(key(show), null);
        if (v != null) {
            try {
                String[] p = v.split(",");
                if (p.length == EASE_POINTS + 2) {
                    float[] e = new float[EASE_POINTS];
                    for (int i = 0; i < EASE_POINTS; i++) e[i] = Float.parseFloat(p[i + 2]);
                    return new Curve(Long.parseLong(p[0]), Long.parseLong(p[1]), e);
                }
            } catch (Exception ignored) {}
        }
        return show
            ? new Curve(DEFAULT_SHOW_MS, DEFAULT_OFFSET_MS, DEFAULT_SHOW)
            : new Curve(DEFAULT_HIDE_MS, DEFAULT_OFFSET_MS, DEFAULT_HIDE);
    }

    /**
     * Ход прошедшей анимации → кривая для следующей: момент, когда клавиатура
     * тронулась, время до 99,5% пути и 17 точек доли пути через равные
     * промежутки. С прошлым замером усредняем — один неровный не испортит.
     * Анимацию с провалом кадров (>60 мс) не учим: кривая вышла бы ломаной.
     */
    private void learn(boolean show) {
        List<long[]> raw = new ArrayList<>(track);
        track.clear();
        if (raw.size() < 8) return;
        long from = raw.get(0)[1], to = raw.get(raw.size() - 1)[1];
        long span = Math.abs(to - from);
        if (span < 40) return;
        List<long[]> t = new ArrayList<>(raw.size());
        for (long[] r : raw) t.add(new long[] {r[0], Math.min(1000, Math.round(1000.0 * Math.abs(r[1] - from) / span))});
        long start = -1, end = -1;
        for (int i = 0; i < t.size(); i++) {
            if (i > 0 && t.get(i)[0] - t.get(i - 1)[0] > 60) return;
            if (t.get(i)[1] == 0) start = t.get(i)[0];
            if (end < 0 && t.get(i)[1] >= 995) end = t.get(i)[0];
        }
        if (start < 0 || end <= start) return;
        long duration = end - start;
        if (duration < 80 || duration > 1500) return;
        float[] e = new float[EASE_POINTS];
        for (int k = 0; k < EASE_POINTS; k++) {
            double x = start + duration * (k / (double) (EASE_POINTS - 1));
            double y = 1;
            for (int i = 1; i < t.size(); i++) {
                long[] a = t.get(i - 1), b = t.get(i);
                if (a[0] <= x && x <= b[0]) {
                    double f = b[0] > a[0] ? (x - a[0]) / (double) (b[0] - a[0]) : 0;
                    y = (a[1] + (b[1] - a[1]) * f) / 1000.0;
                    break;
                }
            }
            e[k] = (float) Math.max(0, Math.min(1, y));
        }
        e[0] = 0f;
        e[EASE_POINTS - 1] = 1f;
        Curve prev = learned(show);
        long off = (prev.offset + start) / 2;
        long dur;
        float[] out = new float[EASE_POINTS];
        if (show) {
            // Открытия однородные — среднее с прошлым.
            dur = (prev.duration + duration) / 2;
            for (int k = 0; k < EASE_POINTS; k++) out[k] = (prev.ease[k] + e[k]) / 2;
        } else {
            // Закрытия бывают двух видов: по кривой клавиатуры (~360 мс с
            // хвостом) и быстрые системные (~200 мс, когда клавиатуру только
            // что открывали) — замер на Redmi, 25.10; объявленная длительность
            // у обоих 285. Учим самую медленную: при быстром закрытии поле в
            // конце чуть отстанет (полоска фона), но под клавиатуру не уйдёт.
            Curve now = new Curve(duration, start, e);
            dur = Math.max(prev.duration, duration);
            for (int k = 0; k < EASE_POINTS; k++) {
                double tk = dur * (k / (double) (EASE_POINTS - 1));
                out[k] = (float) Math.min(at(prev, tk), at(now, tk));
            }
            out[EASE_POINTS - 1] = 1f;
        }
        StringBuilder sb = new StringBuilder().append(dur).append(',').append(off);
        for (int k = 0; k < EASE_POINTS; k++) sb.append(',').append(String.format(Locale.US, "%.3f", out[k]));
        prefs().edit().putString(key(show), sb.toString()).apply();
    }

    /** Доля пути кривой c через t мс после старта (за концом — 1). */
    private static double at(Curve c, double t) {
        if (t >= c.duration) return 1;
        double x = t / c.duration * (EASE_POINTS - 1);
        int i = (int) Math.floor(x);
        if (i >= EASE_POINTS - 1) return 1;
        return c.ease[i] + (c.ease[i + 1] - c.ease[i]) * (x - i);
    }

    /**
     * Кадр клавиатуры — событием окна прямо из evaluateJavascript, как на iOS.
     * offset — через сколько мс после отправки клавиатура трогается: страница
     * начинает переход с этой задержкой минус время доставки события.
     */
    private void send(int px, long duration, float[] ease, long offset) {
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
            + ",duration:" + Math.max(0, duration) + ",ease:" + e + ",offset:" + offset
            + ",ts:" + System.currentTimeMillis() + "}}))";
        web.evaluateJavascript(js, null);
    }
}
