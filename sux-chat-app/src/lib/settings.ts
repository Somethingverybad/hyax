/**
 * Локальные настройки устройства: звуки интерфейса, анимация обоев. Живут в
 * localStorage — переживают перезапуск, но не переезжают на другой телефон.
 * Исключение — aura_anim: это настройка аккаунта (Profile.aura_anim), здесь
 * только её зеркало, чтобы компоненты читали синхронно; applyServerSettings
 * подтягивает значение с сервера при каждой загрузке профиля.
 */
import { applyServerQuickReaction } from "@/lib/reactions";

const PREFIX = "hyax:setting:";

export type LocalSettingKey = "sfx_send" | "wallpaper_anim" | "aura_anim";

const DEFAULTS: Record<LocalSettingKey, boolean> = { sfx_send: true, wallpaper_anim: true, aura_anim: true };

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

/** Настройки аккаунта из свежего профиля — в локальное зеркало (без записи на сервер). */
export function applyServerSettings(p: { aura_anim?: boolean; quick_reaction?: unknown } | null | undefined) {
  if (!p) return;
  if (typeof p.aura_anim === "boolean" && p.aura_anim !== getSetting("aura_anim")) setSetting("aura_anim", p.aura_anim);
  // Быстрая реакция — тоже настройка аккаунта (lib/reactions).
  applyServerQuickReaction(p as Parameters<typeof applyServerQuickReaction>[0]);
}
