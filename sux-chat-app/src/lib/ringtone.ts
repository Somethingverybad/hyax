import { api, mediaUrl } from "@/api/client";
import { t as tr } from "@/lib/i18n";

/**
 * Звук входящего звонка (пока только веб и десктоп: на телефонах звонит
 * система — CallKit и канал уведомлений Android).
 *
 * Значение в профиле (Profile.ringtone): "" — стандартный, "classic" —
 * прежний, "sound:<id>" — любой звук из каталога уведомлений. Файлы встроенных
 * лежат в публичном бакете; играем их <audio>-элементом, а не через
 * AudioContext — у бакета нет CORS, и fetch оттуда не пройдёт.
 */
export const RINGTONE_DEFAULT_URL = "https://storage.yandexcloud.net/hyax-public/sounds/ringtone-default.mp3";
export const RINGTONE_CLASSIC_URL = "https://storage.yandexcloud.net/hyax-public/sounds/ringtone-classic.mp3";

// name — геттер: перевод берётся в момент показа, а не при загрузке модуля
// (иначе название застыло бы на языке, который был при старте).
export const BUILTIN_RINGTONES: { id: string; name: string; url: string }[] = [
  { id: "", get name() { return tr("Стандартный"); }, url: RINGTONE_DEFAULT_URL },
  { id: "classic", get name() { return tr("Классический"); }, url: RINGTONE_CLASSIC_URL },
];

/** Что сейчас выбрано — для подписи в настройках. */
export function ringtoneLabel(value: string | undefined, catalogName?: string | null): string {
  if (!value) return tr("Стандартный");
  if (value === "classic") return tr("Классический");
  if (value.startsWith("sound:")) return catalogName || tr("Из каталога");
  return tr("Стандартный");
}

/** Адрес файла для проигрывания; каталог спрашиваем у сервера. */
export async function resolveRingtoneUrl(value: string | undefined): Promise<string> {
  if (!value) return RINGTONE_DEFAULT_URL;
  if (value === "classic") return RINGTONE_CLASSIC_URL;
  if (value.startsWith("sound:")) {
    const id = value.slice("sound:".length);
    try {
      const s = (await api.getNotificationSounds()).find((x) => x.id === id);
      if (s?.url) return mediaUrl(s.url);
    } catch { /* каталог недоступен — стандартный */ }
  }
  return RINGTONE_DEFAULT_URL;
}

/** Зациклить звонок; возвращает «остановить». В браузере автозапуск без
 *  жеста может быть запрещён — тогда просто молчим, как и раньше. */
export function playRingtone(url: string, volume = 0.8): () => void {
  const el = new Audio(url);
  el.loop = true;
  el.volume = volume;
  el.play().catch(() => {});
  return () => { el.pause(); el.src = ""; };
}

/** Короткий прослух в настройках (не зациклен). */
export function previewRingtone(url: string): () => void {
  const el = new Audio(url);
  el.volume = 0.8;
  el.play().catch(() => {});
  const t = setTimeout(() => { el.pause(); }, 6000);
  return () => { clearTimeout(t); el.pause(); el.src = ""; };
}
