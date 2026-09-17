import { Capacitor } from "@capacitor/core";
import { Preferences } from "@capacitor/preferences";
import { Directory, Filesystem } from "@capacitor/filesystem";
import { clearMessageCache } from "./messageCache";
import { clearSessionCache } from "./session-cache";
import { applog } from "./applog";

/**
 * Сброс кеша — всего, что приложение накопило и может скачать заново.
 *
 * Чистим: ленты сообщений и постов (IndexedDB), кеш профиля и списка чатов,
 * кеш участников, скачанные файлы звуков и отметку об их синхронизации,
 * HTTP-кеш service worker'а, закрытую плашку обновления.
 *
 * Не трогаем: токены входа (сброс кеша — не выход), тему и отметку о том,
 * что разрешения уже спрашивали (иначе системный диалог вылезет второй раз).
 *
 * Каждый шаг в своём try: если одно хранилище недоступно, остальные всё равно
 * очистятся. В конце — перезагрузка на /chat, чтобы сбросить и состояние в
 * памяти; иначе экран показывал бы уже удалённые данные.
 */
export async function clearAppCache(): Promise<void> {
  applog.info("cache reset");
  const steps: Array<[string, () => Promise<void> | void]> = [
    ["messages", () => clearMessageCache()],
    ["session", () => clearSessionCache()],
    ["localStorage", () => {
      for (const k of ["chat_participants_cache", "update_dismissed_version", "sound_pack"]) {
        localStorage.removeItem(k);
      }
    }],
    ["sounds-flag", () => Preferences.remove({ key: "notification_sounds_synced" }).then(() => undefined)],
    ["sounds-files", async () => {
      // Файлы .caf лежат только на iOS; на Android звуки хранит нативная часть.
      if (Capacitor.getPlatform() !== "ios") return;
      await Filesystem.rmdir({ path: "Sounds", directory: Directory.Library, recursive: true });
    }],
    ["http-cache", async () => {
      if (typeof caches === "undefined") return;
      for (const k of await caches.keys()) await caches.delete(k);
    }],
  ];

  for (const [name, run] of steps) {
    try {
      await run();
    } catch (e) {
      applog.warn(`cache reset: ${name} — ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  window.location.replace("/chat");
}
