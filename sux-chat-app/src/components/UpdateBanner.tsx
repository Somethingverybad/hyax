import { useEffect, useState } from "react";
import { X, Download } from "lucide-react";
import { checkForUpdate, type UpdateInfo } from "@/lib/updateCheck";
import { toast } from "sonner";

const DISMISS_KEY = "update_dismissed_version";

/**
 * Плашка «доступна новая версия». Десктоп обновляется изнутри (скачивает и
 * запускает установщик), телефон/веб — ведёт на страницу загрузок. Закрыть
 * можно, и для этой версии плашка больше не покажется.
 */
const UpdateBanner = () => {
  const [info, setInfo] = useState<UpdateInfo | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let alive = true;
    checkForUpdate().then((u) => {
      if (!alive || !u) return;
      let dismissed = "";
      try { dismissed = localStorage.getItem(DISMISS_KEY) || ""; } catch { /* ignore */ }
      if (dismissed === u.version) return; // эту версию уже прятали
      setInfo(u);
    });
    return () => { alive = false; };
  }, []);

  if (!info) return null;

  const close = () => {
    try { localStorage.setItem(DISMISS_KEY, info.version); } catch { /* ignore */ }
    setInfo(null);
  };

  const update = async () => {
    const api = (window as any).electronAPI;
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

  const canAct = info.desktop ? !!info.fileUrl : !!info.fileUrl || true;

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
