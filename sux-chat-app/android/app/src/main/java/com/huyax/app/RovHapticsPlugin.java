package com.huyax.app;

import android.content.Context;
import android.media.AudioAttributes;
import android.os.Build;
import android.os.VibrationAttributes;
import android.os.VibrationEffect;
import android.os.Vibrator;
import android.os.VibratorManager;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * Вибрация Р.Ё.В на Android — тем же интерфейсом, что Core Haptics на iOS
 * (RovHapticsPlugin.swift), плюс одиночный тычок tap.
 *
 * Зачем свой плагин, если есть @capacitor/haptics: тот вибрирует без
 * атрибутов, и система относит такую вибрацию к классу «касание» (usage
 * TOUCH). На MIUI с выключенным тактильным откликом её молча отбрасывает —
 * в dumpsys vibrator_manager каждая наша вибрация стояла как
 * ignored_for_settings, при том что уведомления (usage NOTIFICATION) играли.
 * Р.Ё.В — это сигнал от другого человека, и класс у него соответствующий:
 * COMMUNICATION_REQUEST. Его глушат только режимом «Не беспокоить», как и звонок.
 */
@CapacitorPlugin(name = "RovHaptics")
public class RovHapticsPlugin extends Plugin {

    private Vibrator vibrator() {
        Context ctx = getContext();
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            VibratorManager vm = (VibratorManager) ctx.getSystemService(Context.VIBRATOR_MANAGER_SERVICE);
            return vm != null ? vm.getDefaultVibrator() : null;
        }
        return (Vibrator) ctx.getSystemService(Context.VIBRATOR_SERVICE);
    }

    /** Проиграть эффект классом «коммуникация», а не «касание». */
    private void play(Vibrator v, VibrationEffect effect) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            v.vibrate(effect, VibrationAttributes.createForUsage(VibrationAttributes.USAGE_COMMUNICATION_REQUEST));
        } else if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            v.vibrate(effect, new VibrationAttributes.Builder()
                .setUsage(VibrationAttributes.USAGE_COMMUNICATION_REQUEST).build());
        } else {
            // До Android 11 класс задаётся через AudioAttributes.
            v.vibrate(effect, new AudioAttributes.Builder()
                .setUsage(AudioAttributes.USAGE_NOTIFICATION_COMMUNICATION_REQUEST)
                .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION).build());
        }
    }

    @PluginMethod
    public void supported(PluginCall call) {
        Vibrator v = vibrator();
        JSObject r = new JSObject();
        r.put("value", v != null && v.hasVibrator());
        call.resolve(r);
    }

    /** Сплошной гул: бесконечно повторяемая волна, пока не позовут stop. */
    @PluginMethod
    public void start(PluginCall call) {
        Vibrator v = vibrator();
        JSObject r = new JSObject();
        if (v == null || !v.hasVibrator() || Build.VERSION.SDK_INT < Build.VERSION_CODES.O) {
            r.put("value", false);
            call.resolve(r);
            return;
        }
        double intensity = call.getDouble("intensity", 1.0);
        int amp = (int) Math.max(1, Math.min(255, Math.round(intensity * 255)));
        // Длинный отрезок с крошечной паузой: без паузы некоторые моторы
        // «проседают» на бесконечном одном шаге, а пауза в 20 мс на ощупь не видна.
        VibrationEffect wave = VibrationEffect.createWaveform(new long[]{1000, 20}, new int[]{amp, 0}, 0);
        try {
            v.cancel();
            play(v, wave);
            r.put("value", true);
        } catch (Exception e) {
            r.put("value", false);
        }
        call.resolve(r);
    }

    @PluginMethod
    public void stop(PluginCall call) {
        Vibrator v = vibrator();
        if (v != null) {
            try { v.cancel(); } catch (Exception ignored) {}
        }
        call.resolve();
    }

    /** Одиночный тычок: heavy — сильнее и чуть длиннее. */
    @PluginMethod
    public void tap(PluginCall call) {
        Vibrator v = vibrator();
        if (v == null || !v.hasVibrator()) { call.reject("no vibrator"); return; }
        boolean heavy = Boolean.TRUE.equals(call.getBoolean("heavy", false));
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                play(v, VibrationEffect.createOneShot(heavy ? 60 : 43, heavy ? 255 : 180));
            } else {
                v.vibrate(heavy ? 60 : 43);
            }
            call.resolve();
        } catch (Exception e) {
            call.reject(e.getMessage());
        }
    }
}
