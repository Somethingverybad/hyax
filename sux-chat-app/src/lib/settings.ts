/**
 * Локальные настройки устройства (не синхронизируются): звуки интерфейса,
 * анимация обоев. Живут в localStorage — переживают перезапуск, но не
 * переезжают на другой телефон: это про конкретное устройство.
 */
const PREFIX = "hyax:setting:";

export type LocalSettingKey = "sfx_send" | "wallpaper_anim";

const DEFAULTS: Record<LocalSettingKey, boolean> = { sfx_send: true, wallpaper_anim: true };

export function getSetting(key: LocalSettingKey): boolean {
  try {
    const v = localStorage.getItem(PREFIX + key);
    return v === null ? DEFAULTS[key] : v === "1";
  } catch { return DEFAULTS[key]; }
}

export function setSetting(key: LocalSettingKey, value: boolean) {
  try { localStorage.setItem(PREFIX + key, value ? "1" : "0"); } catch { /* приватный режим */ }
  window.dispatchEvent(new CustomEvent("hyax:setting", { detail: { key, value } }));
}
