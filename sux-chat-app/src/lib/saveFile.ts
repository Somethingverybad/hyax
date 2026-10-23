import { Capacitor } from "@capacitor/core";
import { toast } from "sonner";
import { applog, safePath } from "./applog";
import { t } from "./i18n";

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
      if (r.success) toast.success(t("Файл сохранён"));
      else if (!r.canceled) toast.error(t("Не удалось сохранить: {error}", { error: r.error || t("неизвестная ошибка") }));
    } catch {
      toast.error(t("Не удалось сохранить файл"));
    }
    return;
  }

  if (Capacitor.isNativePlatform()) {
    applog.info(`file save native ${safePath(url)} ${fileName}`);
    const id = `save-${Date.now()}`;
    toast.loading(t("Скачиваю…"), { id });
    // Имя — как у файла в сообщении, но без символов, которые не переживут
    // файловую систему; расширение сохраняем, по нему Файлы поймут тип.
    const safeName = (fileName || "file").replace(/[/\\:*?"<>|]+/g, "_").slice(0, 120);
    const path = `share/${Date.now()}-${safeName}`;
    try {
      const { Filesystem, Directory } = await import("@capacitor/filesystem");
      const { Share } = await import("@capacitor/share");
      // Папки share/ в кэше может не быть (система чистит кэш) — без неё
      // запись падала с ENOENT (баг-репорты 553367b8, 2064575c). recursive у
      // downloadFile на Android папку не создаёт — делаем сами; «уже есть» — не ошибка.
      await Filesystem.mkdir({ path: "share", directory: Directory.Cache, recursive: true }).catch(() => {});
      const res = await Filesystem.downloadFile({ url, path, directory: Directory.Cache, recursive: true });
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
      // В браузер больше не уводим: файл из хранилища открывался там вместо сохранения.
      toast.error(t("Не удалось скачать файл"));
    }
    return;
  }

  // Веб: ссылка на хранилище — другой домен, и браузер игнорирует у неё
  // download: открывал файл во вкладке. Качаем сами и отдаём как свой файл.
  applog.info(`file save web ${safePath(url)} ${fileName}`);
  const click = (href: string) => {
    const link = document.createElement("a");
    link.href = href;
    link.download = fileName;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };
  const id = `save-${Date.now()}`;
  toast.loading(t("Скачиваю…"), { id });
  try {
    const r = await fetch(url, { mode: "cors", credentials: "omit" });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const obj = URL.createObjectURL(await r.blob());
    toast.dismiss(id);
    click(obj);
    window.setTimeout(() => URL.revokeObjectURL(obj), 60_000);
  } catch (e) {
    toast.dismiss(id);
    applog.warn(`file save web failed: ${String((e as { message?: string })?.message || e)}`);
    click(url); // хранилище не пустило — обычная загрузка браузера
  }
}
