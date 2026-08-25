import { Capacitor } from "@capacitor/core";
import { Preferences } from "@capacitor/preferences";

/**
 * Однократный запрос доступа к камере и микрофону при первом открытии.
 *
 * Раньше разрешения спрашивались только в момент первого звонка/записи —
 * пользователь пугался «почему вдруг просит камеру». Теперь спрашиваем сразу
 * на старте, один раз (флаг в Preferences). getUserMedia в WebView поднимает
 * системные диалоги iOS/Android; треки сразу останавливаем — нам нужно только
 * разрешение, не поток.
 */

const ASKED_KEY = "media_perms_requested";

export async function requestMediaPermissionsOnce(): Promise<void> {
  if (!Capacitor.isNativePlatform()) return;
  try {
    const { value } = await Preferences.get({ key: ASKED_KEY });
    if (value === "1") return;
  } catch {
    /* нет доступа к Preferences — попросим всё равно, хуже не будет */
  }

  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      video: true,
      audio: true,
    });
    stream.getTracks().forEach((t) => t.stop());
  } catch {
    // Отказ — это осознанный выбор пользователя; звонок/запись потом
    // попросят снова точечно. Больше на старте не пристаём.
  }

  try {
    await Preferences.set({ key: ASKED_KEY, value: "1" });
  } catch {
    /* не смертельно */
  }
}
