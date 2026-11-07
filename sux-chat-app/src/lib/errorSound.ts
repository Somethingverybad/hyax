import { toast } from "sonner";
import { isBusyWith } from "@/lib/busy";
import { playSfx } from "@/lib/sfx";

/**
 * Звук ошибки: любое сообщение об ошибке (toast.error) — короткий сигнал
 * /sounds/error.mp3. Не чаще раза в 2 с (пачка ошибок — один сигнал), только
 * на экране и не во время звонка или записи: звук в WebView перехватил бы
 * аудиосессию звонка, а в запись попал бы в микрофон.
 */
const GAP_MS = 2000;
let last = 0;
let installed = false;

export function installErrorSound() {
  if (installed) return;
  installed = true;
  const orig = toast.error;
  const patched: typeof toast.error = (...args) => {
    const now = Date.now();
    if (now - last > GAP_MS && document.visibilityState === "visible" && !isBusyWith("call") && !isBusyWith("record")) {
      last = now;
      void playSfx("/sounds/error.mp3", { volume: 0.5 }).catch(() => {});
    }
    return orig(...args);
  };
  (toast as { error: typeof toast.error }).error = patched;
}
