import { useEffect, useState } from "react";
import { X, Download, RefreshCw } from "lucide-react";
import { checkForUpdate, type UpdateInfo } from "@/lib/updateCheck";
import { toast } from "sonner";

const DISMISS_KEY = "update_dismissed_version";

/** Состояние автообновления с десктопа (electron-updater, см. electron/main.cjs). */
type UpdaterState =
  | { state: "available"; version: string; notes?: string }
  | { state: "downloading"; percent: number }
  | { state: "downloaded"; version: string }
  | { state: "error"; message: string }
  | { state: "none" };

const dismissed = () => { try { return localStorage.getItem(DISMISS_KEY) || ""; } catch { return ""; } };
const dismiss = (v: string) => { try { localStorage.setItem(DISMISS_KEY, v); } catch { /* ignore */ } };

/**
 * Плашка «доступна новая версия».
 *
 * Десктоп обновляется сам: electron-updater скачивает новую версию в фоне и
 * ставит её при перезапуске — переустанавливать ничего не нужно. Если
 * автообновление недоступно (старая ad-hoc-сборка на mac, ошибка фида) —
 * запасной путь: скачать установщик и открыть его. Телефон/веб — ведём на
 * страницу загрузок. Закрыть можно, и для этой версии плашка больше не покажется.
 */
const UpdateBanner = () => {
  const api = (window as any).electronAPI;
  const [info, setInfo] = useState<UpdateInfo | null>(null);
  const [upd, setUpd] = useState<UpdaterState | null>(null);
  const [busy, setBusy] = useState(false);

  // Запасной путь через манифест version.json (телефон, веб, десктоп без апдейтера).
  const checkManifest = () => {
    checkForUpdate().then((u) => {
      if (!u) return;
      if (dismissed() === u.version) return;
      setInfo(u);
    });
  };

  useEffect(() => {
    if (!api?.checkUpdate || !api?.onUpdate) { checkManifest(); return; }
    const off = api.onUpdate((p: UpdaterState) => {
      if (p.state === "available" && dismissed() === p.version) return;
      if (p.state === "error") { checkManifest(); setUpd(null); return; }
      if (p.state === "none") { setUpd(null); return; }
      setUpd(p);
    });
    api.checkUpdate().then((r: { ok: boolean; reason?: string }) => {
      // dev-сборка или апдейтер недоступен — как раньше, по манифесту.
      if (!r?.ok) checkManifest();
    });
    return () => { off?.(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ---- Автообновление (десктоп) ----
  if (upd && upd.state !== "none" && upd.state !== "error") {
    const version = "version" in upd ? upd.version : "";
    const close = () => { if (version) dismiss(version); setUpd(null); };
    const act = async () => {
      if (upd.state === "available") {
        setBusy(true);
        const r = await api.downloadUpdate();
        setBusy(false);
        if (!r?.ok) toast.error("Не удалось скачать обновление");
      } else if (upd.state === "downloaded") {
        api.applyUpdate();
      }
    };
    return (
      <div className="shrink-0 bg-primary text-primary-foreground px-3 py-2 flex items-center gap-2">
        <div className="flex-1 min-w-0">
          <div className="text-sm font-semibold truncate">
            {upd.state === "downloaded" ? "Обновление готово" : "ХУЯКС ХУЯКС и новая версия, закачаешься"}
          </div>
          <div className="text-xs opacity-80 truncate">
            {upd.state === "downloading"
              ? `Качаю… ${upd.percent}%`
              : upd.state === "downloaded"
              ? `Версия ${upd.version} установится при перезапуске`
              : `Версия ${upd.version}${"notes" in upd && upd.notes ? ` — ${upd.notes}` : ""}`}
          </div>
        </div>
        {upd.state !== "downloading" && (
          <button
            type="button"
            onClick={act}
            disabled={busy}
            className="shrink-0 flex items-center gap-1 bg-primary-foreground text-primary text-sm font-semibold px-3 py-1.5 rounded-full disabled:opacity-60"
          >
            {upd.state === "downloaded" ? <RefreshCw className="w-4 h-4" /> : <Download className="w-4 h-4" />}
            {upd.state === "downloaded" ? "Перезапустить" : busy ? "Качаю…" : "Обновить"}
          </button>
        )}
        {upd.state !== "downloading" && (
          <button type="button" onClick={close} className="shrink-0 p-1.5" aria-label="Закрыть">
            <X className="w-4 h-4" />
          </button>
        )}
      </div>
    );
  }

  // ---- Запасной путь: манифест version.json ----
  if (!info) return null;

  const close = () => { dismiss(info.version); setInfo(null); };

  const update = async () => {
    if (info.desktop && info.fileUrl && api?.installUpdate) {
      setBusy(true);
      try {
        const r = await api.installUpdate(info.fileUrl, info.fileName || "hyax-update");
        if (r?.ok) toast.success("Установщик запущен — следуй подсказкам");
        else toast.error("Не удалось скачать обновление");
      } finally {
        setBusy(false);
      }
      return;
    }
    // Телефон/веб: ведём на страницу загрузок (или прямой файл для Android).
    const url = info.fileUrl || "https://huyax.e-tree.su/apk/";
    if (api?.openExternal) api.openExternal(url);
    else window.open(url, "_blank");
  };

  const canAct = info.desktop ? !!info.fileUrl : true;

  return (
    <div className="shrink-0 bg-primary text-primary-foreground px-3 py-2 flex items-center gap-2">
      <div className="flex-1 min-w-0">
        <div className="text-sm font-semibold truncate">ХУЯКС ХУЯКС и новая версия, закачаешься</div>
        <div className="text-xs opacity-80 truncate">
          Версия {info.version}{info.notes ? ` — ${info.notes}` : ""}
        </div>
      </div>
      {canAct && (
        <button
          type="button"
          onClick={update}
          disabled={busy}
          className="shrink-0 flex items-center gap-1 bg-primary-foreground text-primary text-sm font-semibold px-3 py-1.5 rounded-full disabled:opacity-60"
        >
          <Download className="w-4 h-4" />
          {info.desktop ? (busy ? "Качаю…" : "Обновить") : "Скачать"}
        </button>
      )}
      <button type="button" onClick={close} className="shrink-0 p-1.5" aria-label="Закрыть">
        <X className="w-4 h-4" />
      </button>
    </div>
  );
};

export default UpdateBanner;
