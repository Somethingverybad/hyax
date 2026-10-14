import { Capacitor, registerPlugin } from "@capacitor/core";

/**
 * Язык интерфейса — нативной части (плагин NativeLang): на нём она пишет то,
 * что формирует сама, — уведомления о звонках и сообщениях, названия каналов
 * Android, меню форматирования iOS, CallKit, расширения «Поделиться» и
 * уведомлений. iOS хранит язык в общей App Group и в Keychain (их читают
 * расширения), Android — в SharedPreferences (их читает FCM-сервис, даже
 * когда приложение не запущено).
 *
 * Описания разрешений iOS система показывает на языке телефона — они
 * локализованы обычными InfoPlist.strings, сюда не относятся.
 */
interface NativeLangPlugin {
  setLang(o: { lang: "ru" | "en" | "ko" }): Promise<void>;
}
const plugin = registerPlugin<NativeLangPlugin>("NativeLang");

let synced: string | null = null;

/** Сохранить язык в нативной части. В браузере и на десктопе ничего не делает. */
export function syncNativeLang(lang: "ru" | "en" | "ko"): void {
  try {
    if (!Capacitor.isNativePlatform() || lang === synced) return;
  } catch {
    return;
  }
  synced = lang;
  plugin.setLang({ lang }).catch(() => {
    // Старая нативная сборка без плагина — молча пропускаем, повторим при следующем вызове.
    synced = null;
  });
}
