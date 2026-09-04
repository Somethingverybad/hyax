import { Capacitor, registerPlugin } from "@capacitor/core";

interface PushSecretPlugin { get(): Promise<{ secret: string }>; }
const plugin = registerPlugin<PushSecretPlugin>("PushSecret");

/**
 * Ключ шифрования пушей этого устройства (32 байта, base64). Генерирует и
 * хранит нативная часть (Android — приватные SharedPreferences, iOS —
 * Keychain, общий с расширением уведомлений); сервер шифрует им текст пуша,
 * и через Apple/Google он идёт нечитаемым. В вебе/десктопе пушей нет — null.
 */
export async function getPushSecret(): Promise<string | null> {
  if (!Capacitor.isNativePlatform()) return null;
  try {
    return (await plugin.get()).secret || null;
  } catch {
    return null; // старая нативная сборка без плагина — пуши открытым текстом
  }
}
