package com.huyax.app;

import android.os.Build;
import android.view.DisplayCutout;
import android.view.View;
import android.view.WindowInsets;
import android.webkit.WebView;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * Вырезы экрана для вёрстки: то, чего в Android нет в env(safe-area-inset-*).
 *
 * В WebView эти значения всегда нули, в отличие от iOS, а окно приложения
 * рисуется во весь экран (статус-бар перекрыт, а с targetSdk 35 система
 * перекрывает ещё и нижнюю панель). Поэтому считаем инсеты сами и отдаём
 * странице — она раскладывает их по --sat/--sab/--sal/--sar (см. safeArea.ts).
 *
 * Считаем не высоту системных панелей, а их ПЕРЕКРЫТИЕ с WebView: под
 * статус-баром окно лежит целиком, а до нижней панели на большинстве прошивок
 * не достаёт — там отступ снизу не нужен вовсе. При открытой клавиатуре
 * система ужимает WebView, перекрытие снизу тоже обнуляется, и панель ввода
 * не получает лишнего отступа над клавиатурой.
 *
 * Значения — в пикселях устройства: масштаб WebView зависит от прошивки, и
 * надёжно узнать его на нативной стороне нельзя. Делит их на
 * devicePixelRatio уже страница.
 */
@CapacitorPlugin(name = "Insets")
public class InsetsPlugin extends Plugin {

    @PluginMethod
    public void get(PluginCall call) {
        getActivity().runOnUiThread(() -> {
            try {
                call.resolve(measure());
            } catch (Exception e) {
                call.reject("insets unavailable", e);
            }
        });
    }

    private JSObject measure() {
        JSObject r = new JSObject();
        r.put("top", 0);
        r.put("bottom", 0);
        r.put("left", 0);
        r.put("right", 0);
        r.put("below", 0);

        WebView web = getBridge() != null ? getBridge().getWebView() : null;
        if (web == null || web.getHeight() == 0) return r;
        View decor = getActivity().getWindow().getDecorView();
        WindowInsets insets = decor.getRootWindowInsets();
        if (insets == null) return r;

        int top, bottom, left, right;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            // Клавиатуру (Type.ime) намеренно не берём: она не вырез, а ресайз.
            android.graphics.Insets bars = insets.getInsets(
                WindowInsets.Type.systemBars() | WindowInsets.Type.displayCutout()
            );
            top = bars.top;
            bottom = bars.bottom;
            left = bars.left;
            right = bars.right;
        } else {
            top = insets.getStableInsetTop();
            bottom = insets.getStableInsetBottom();
            left = insets.getStableInsetLeft();
            right = insets.getStableInsetRight();
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
                DisplayCutout cut = insets.getDisplayCutout();
                if (cut != null) {
                    top = Math.max(top, cut.getSafeInsetTop());
                    bottom = Math.max(bottom, cut.getSafeInsetBottom());
                    left = Math.max(left, cut.getSafeInsetLeft());
                    right = Math.max(right, cut.getSafeInsetRight());
                }
            }
        }

        int[] d = new int[2];
        decor.getLocationOnScreen(d);
        int[] w = new int[2];
        web.getLocationOnScreen(w);

        // Часть экрана ниже WebView: там лежит панель навигации. Высота
        // клавиатуры от плагина Keyboard считается от низа ЭКРАНА, а не от низа
        // WebView, поэтому на эту полосу её нужно уменьшить — иначе панель
        // ввода уезжает выше клавиатуры и под ней видно ленту сообщений.
        r.put("below", Math.max(0, (d[1] + decor.getHeight()) - (w[1] + web.getHeight())));

        r.put("top", Math.max(0, (d[1] + top) - w[1]));
        r.put("bottom", Math.max(0, (w[1] + web.getHeight()) - (d[1] + decor.getHeight() - bottom)));
        r.put("left", Math.max(0, (d[0] + left) - w[0]));
        r.put("right", Math.max(0, (w[0] + web.getWidth()) - (d[0] + decor.getWidth() - right)));
        return r;
    }
}
