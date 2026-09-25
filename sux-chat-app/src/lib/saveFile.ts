import { Capacitor } from "@capacitor/core";
import { toast } from "sonner";
import { applog, safePath } from "./applog";

/**
 * Сохранить файл (трек, документ, картинку) на устройство.
 *
 * Телефон: раньше ссылка уходила в системный браузер — Safari открывал mp3
 * своим плеером, и сохранить файл было негде. Теперь качаем нативно во
 * временную папку и показываем системное окно «Поделиться»: в нём есть
 * «Сохранить в Файлы» с выбором папки, AirDrop, другие приложения. Файл во
 * временной папке удаляем, когда окно закрыто.
 *
 * Десктоп (Electron) — диалог сохранения; веб — обычная загрузка браузера.
 */
export async function saveFileToDevice(url: string, fileName: string): Promise<void> {
  const w = window as unknown as { electronAPI?: { saveFile?: (u: string, n: string) => Promise<{ success?: boolean; canceled?: boolean; error?: string }> } };
  if (w.electronAPI?.saveFile) {
    try {
      const r = await w.electronAPI.saveFile(url, fileName);
      if (r.success) toast.success("Файл сохранён");
      else if (!r.canceled) toast.error("Не удалось сохранить: " + (r.error || "неизвестная ошибка"));
    } catch {
      toast.error("Не удалось сохранить файл");
    }
    return;
  }

  if (Capacitor.isNativePlatform()) {
    applog.info(`file save native ${safePath(url)} ${fileName}`);
    const id = `save-${Date.now()}`;
    toast.loading("Скачиваю…", { id });
    // Имя — как у файла в сообщении, но без символов, которые не переживут
    // файловую систему; расширение сохраняем, по нему Файлы поймут тип.
    const safeName = (fileName || "file").replace(/[/\\:*?"<>|]+/g, "_").slice(0, 120);
    const path = `share/${Date.now()}-${safeName}`;
    try {
      const { Filesystem, Directory } = await import("@capacitor/filesystem");
      const { Share } = await import("@capacitor/share");
      const res = await Filesystem.downloadFile({ url, path, directory: Directory.Cache });
      toast.dismiss(id);
      const uri = res.path ? (await Filesystem.getUri({ path, directory: Directory.Cache })).uri : null;
      if (!uri) throw new Error("no path");
      try {
        await Share.share({ files: [uri], title: safeName });
      } catch (e: unknown) {
        // Закрыли окно, ничего не выбрав — это не ошибка.
        const msg = String((e as { message?: string })?.message || e);
        if (!/cancel/i.test(msg)) throw e;
      } finally {
        Filesystem.deleteFile({ path, directory: Directory.Cache }).catch(() => {});
      }
    } catch (e) {
      toast.dismiss(id);
      applog.warn(`file save native failed: ${String((e as { message?: string })?.message || e)}`);
      // Запасной путь — прежний: пусть хотя бы откроется в браузере.
      toast.error("Не удалось сохранить — открываю в браузере");
      window.open(url, "_blank");
    }
    return;
  }

  applog.info(`file save web ${safePath(url)} ${fileName}`);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  link.target = "_blank";
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}
