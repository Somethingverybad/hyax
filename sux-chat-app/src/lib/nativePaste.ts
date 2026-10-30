/**
 * Картинка из клавиатуры Android (буфер Gboard, стикеры, GIF) — баг-репорт
 * cda6147d: клавиатура вставляет картинки не обычной вставкой, а через
 * commitContent, и WebView отвечал, что поле их не принимает («WYX does not
 * support image pasting here»).
 *
 * Натив (android-polish, PasteWebView.java) объявляет клавиатуре image/*,
 * копирует присланный файл в кеш приложения и шлёт событие hyax:native-paste
 * {path, mime, name}. Здесь файл превращается в обычную вставку (paste с
 * clipboardData.files) в поле, где стоит курсор, — дальше как вставка с
 * компьютера: ChatWindow и ChannelView сами прикладывают файл.
 * Без натива (старая сборка, iPhone, веб) события нет — ничего не меняется.
 */
import { Capacitor } from "@capacitor/core";
import { toast } from "sonner";
import { t as tr } from "@/lib/i18n";
import { applog } from "@/lib/applog";

type Detail = { path?: string; mime?: string; name?: string };

export function installNativePaste() {
  if (Capacitor.getPlatform() !== "android") return;
  window.addEventListener("hyax:native-paste", (e) => {
    const { path, mime, name } = ((e as CustomEvent).detail || {}) as Detail;
    const target = document.activeElement as HTMLElement | null;
    applog.info(`paste: клавиатура прислала ${mime || "?"}`);
    if (!path) return;
    if (!target || !target.matches("textarea, input, [contenteditable='true']")) {
      toast(tr("Сюда картинку не вставить"));
      return;
    }
    void (async () => {
      try {
        const blob = await (await fetch(Capacitor.convertFileSrc(path))).blob();
        const file = new File([blob], name || "image", { type: mime || blob.type || "image/png" });
        const dt = new DataTransfer();
        dt.items.add(file);
        const ev = new ClipboardEvent("paste", { clipboardData: dt, bubbles: true, cancelable: true });
        target.dispatchEvent(ev);
        // Поле без вставки файлов (поиск, подпись) — вставку никто не принял.
        if (!ev.defaultPrevented) toast(tr("Сюда картинку не вставить"));
      } catch (err) {
        applog.warn(`paste: не прочитать файл клавиатуры: ${String(err)}`);
        toast.error(tr("Не удалось вставить картинку"));
      }
    })();
  });
}
