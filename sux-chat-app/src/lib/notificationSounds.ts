import { Capacitor } from "@capacitor/core";
import { Directory, Filesystem } from "@capacitor/filesystem";
import { Preferences } from "@capacitor/preferences";
import { api, mediaUrl } from "@/api/client";

/**
 * Докачка звуков уведомлений («аудио-стикеров») на устройство.
 *
 * iOS ищет звук пуша не только в бандле приложения, но и в Library/Sounds
 * внутри контейнера — туда можно класть файлы в рантайме. Поэтому каталог
 * звуков живёт на сервере, а новые звуки не требуют пересборки приложения:
 * при запуске сверяем updated_at каталога со скачанным и добираем разницу.
 *
 * На Android и в вебе файлы не нужны: там звук в самом приложении играется
 * из сети, а пуш-канал использует ресурс APK (см. Chat.tsx).
 */

const SYNC_KEY = "notification_sounds_synced";

async function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error);
    reader.onloadend = () => {
      const dataUrl = reader.result as string;
      resolve(dataUrl.slice(dataUrl.indexOf(",") + 1));
    };
    reader.readAsDataURL(blob);
  });
}

export async function syncNotificationSounds(): Promise<void> {
  if (Capacitor.getPlatform() !== "ios") return;
  try {
    const sounds = await api.getNotificationSounds();
    const stored = JSON.parse(
      (await Preferences.get({ key: SYNC_KEY })).value || "{}"
    ) as Record<string, string>;

    let changed = false;
    for (const sound of sounds) {
      if (!sound.caf_url) continue;
      if (stored[sound.slug] === sound.updated_at) continue;
      const resp = await fetch(mediaUrl(sound.caf_url));
      if (!resp.ok) continue;
      const data = await blobToBase64(await resp.blob());
      await Filesystem.writeFile({
        path: `Sounds/${sound.slug}.caf`,
        data,
        directory: Directory.Library,
        recursive: true,
      });
      stored[sound.slug] = sound.updated_at;
      changed = true;
    }
    if (changed) {
      await Preferences.set({ key: SYNC_KEY, value: JSON.stringify(stored) });
    }
  } catch (error) {
    // Без звуков приложение полноценно работает — пуши со стандартным звуком.
    console.error("Не удалось синхронизировать звуки уведомлений:", error);
  }
}
