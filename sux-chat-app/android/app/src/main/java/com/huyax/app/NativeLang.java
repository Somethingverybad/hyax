package com.huyax.app;

import android.content.Context;
import android.content.SharedPreferences;
import android.content.res.Configuration;
import java.util.Locale;

/**
 * Язык интерфейса, выбранный в приложении (ru | en | ko), для текстов,
 * которые нативная часть формирует сама: уведомления о звонках и сообщениях,
 * названия каналов. Страница сохраняет его через плагин NativeLang
 * (src/lib/nativeLang.ts) в приватные SharedPreferences — FCM-сервис читает
 * их, даже когда приложение не запущено.
 *
 * Строки — native_strings.xml в res/values (ru), values-en и values-ko; язык берём через
 * контекст с подменённой локалью, так что системный язык телефона может быть
 * любым. Пока страница язык не сохраняла — системный (как и веб-часть:
 * ko, en, остальное — ru).
 */
final class NativeLang {
    private static final String PREFS = "hyax_lang";
    private static final String KEY = "lang";

    private NativeLang() {}

    static boolean isSupported(String lang) {
        return "ru".equals(lang) || "en".equals(lang) || "ko".equals(lang);
    }

    /** Сохранённый приложением язык; null — ещё не сохраняли. */
    static String stored(Context ctx) {
        String v = ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getString(KEY, null);
        return isSupported(v) ? v : null;
    }

    static String get(Context ctx) {
        String v = stored(ctx);
        return v != null ? v : system();
    }

    static String system() {
        String code = Locale.getDefault().getLanguage();
        return "ko".equals(code) ? "ko" : "en".equals(code) ? "en" : "ru";
    }

    /** true — язык поменялся. */
    static boolean set(Context ctx, String lang) {
        if (!isSupported(lang) || lang.equals(stored(ctx))) return false;
        SharedPreferences sp = ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
        sp.edit().putString(KEY, lang).apply();
        return true;
    }

    /** Контекст, ресурсы которого — на языке приложения. */
    static Context context(Context ctx) {
        Configuration cfg = new Configuration(ctx.getResources().getConfiguration());
        cfg.setLocale(Locale.forLanguageTag(get(ctx)));
        return ctx.createConfigurationContext(cfg);
    }

    static String str(Context ctx, int resId) {
        return context(ctx).getString(resId);
    }

    // Служебные фразы, которые сервер кладёт в пуш по-русски
    // (backend/chat/views.py, fcm.py). Порядок важен: длинные раньше коротких.
    private static final String[] PUSH_RU = {
        "Новое сообщение в секретном чате",
        "Новое сообщение",
        "Голосовое сообщение",
        "Видео-сообщение",
        "Стикер",
        "Файл",
        "📍 Геопозиция",
    };
    private static final int[] PUSH_RES = {
        R.string.push_new_secret_message,
        R.string.push_new_message,
        R.string.push_voice_message,
        R.string.push_video_message,
        R.string.push_sticker,
        R.string.push_file,
        R.string.push_location,
    };

    /**
     * Текст пуша: служебную фразу — на язык приложения. В группе сервер
     * пишет «автор: фраза», поэтому переводим и хвост после «: ».
     */
    static String pushBody(Context ctx, String s) {
        if (s == null || "ru".equals(get(ctx))) return s;
        Context l = null;
        for (int i = 0; i < PUSH_RU.length; i++) {
            String ru = PUSH_RU[i];
            boolean whole = s.equals(ru);
            if (!whole && !s.endsWith(": " + ru)) continue;
            if (l == null) l = context(ctx);
            String tr = l.getString(PUSH_RES[i]);
            return whole ? tr : s.substring(0, s.length() - ru.length()) + tr;
        }
        return s;
    }

    /** Заголовок пуша: у группы без названия сервер пишет «Группа». */
    static String pushTitle(Context ctx, String s) {
        if (!"Группа".equals(s) || "ru".equals(get(ctx))) return s;
        return str(ctx, R.string.group_default);
    }
}
