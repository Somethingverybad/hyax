import { useEffect, useState } from "react";
import { Check, Sparkles, Trash2, X } from "lucide-react";
import { toast } from "sonner";
import { api, type VibeReason } from "@/api/client";
import { t } from "@/lib/i18n";
import { cn } from "@/lib/utils";

/**
 * Админ начисляет или снимает вайб с причиной (chat/ideabox.py, VibeAdjustView).
 * Шаблоны причин («За приведённого тестировщика» +100) — тут же: выбрать,
 * сохранить новый, убрать. Всё попадает в историю вайбометра человека.
 */
export default function VibeAdjustSheet({ profileId, username, onClose, onDone }: {
  profileId: string; username: string; onClose: () => void; onDone: (vibe: number) => void;
}) {
  const [items, setItems] = useState<VibeReason[] | null>(null);
  const [picked, setPicked] = useState<number | null>(null);
  const [points, setPoints] = useState("");
  const [reason, setReason] = useState("");
  const [saveTpl, setSaveTpl] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api.getVibeReasons().then((r) => setItems(r.items)).catch(() => setItems([]));
  }, []);

  const pick = (r: VibeReason) => {
    if (picked === r.id) { setPicked(null); return; }
    setPicked(r.id); setPoints(String(r.points)); setReason(r.name); setSaveTpl(false);
  };
  const edit = (p: Partial<{ points: string; reason: string }>) => {
    // Правка руками — уже не шаблон один в один: сервер запишет своё.
    setPicked(null);
    if (p.points !== undefined) setPoints(p.points);
    if (p.reason !== undefined) setReason(p.reason);
  };
  const remove = async (r: VibeReason) => {
    try { setItems((await api.deleteVibeReason(r.id)).items); if (picked === r.id) setPicked(null); }
    catch (e: any) { toast.error(e?.message || t("Не получилось")); }
  };

  const n = parseInt(points, 10);
  const valid = Number.isFinite(n) && n !== 0 && reason.trim().length > 0;
  const submit = async () => {
    if (!valid || busy) return;
    setBusy(true);
    try {
      if (saveTpl && picked === null) {
        const r = await api.saveVibeReason({ name: reason.trim(), points: n });
        setItems(r.items);
      }
      const res = await api.adjustVibe(profileId, { points: n, reason: reason.trim(), template_id: picked ?? undefined });
      toast.success(t("{name}: вайб {delta} — уже {n}", { name: username, delta: n > 0 ? `+${n}` : String(n), n: res.vibe }));
      onDone(res.vibe);
      onClose();
    } catch (e: any) {
      toast.error(e?.message || t("Не получилось"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[95] bg-black/60 flex items-end md:items-center md:justify-center" onClick={onClose}>
      <div
        className="w-full md:w-[440px] max-h-[90vh] overflow-y-auto bg-surface-2 rounded-t-[16px] md:rounded-lg md:border md:border-border p-5 pb-[calc(var(--sab)+20px)] md:pb-5 relative"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="md:hidden absolute top-2 left-1/2 -translate-x-1/2 w-9 h-1 rounded-full bg-foreground/20" aria-hidden />
        <div className="flex items-center gap-2 mb-1">
          <Sparkles className="w-5 h-5 text-primary" />
          <h2 className="text-h2 flex-1">{t("Вайб: начислить или снять")}</h2>
          <button type="button" onClick={onClose} className="p-1.5 text-subtle" aria-label={t("Закрыть")}><X className="w-4 h-4" /></button>
        </div>
        <p className="text-caption text-subtle mb-3">{t("Запишется в историю вайбометра {name} с причиной; человек получит уведомление.", { name: username })}</p>

        {items === null ? (
          <p className="text-small text-subtle py-2">{t("Загрузка…")}</p>
        ) : items.length > 0 && (
          <div className="rounded-lg bg-surface-4 divide-y divide-border overflow-hidden mb-3">
            {items.map((r) => (
              <div key={r.id} className={cn("flex items-center gap-2 pl-4 pr-2 h-12", picked === r.id && "bg-surface-3")}>
                <button type="button" onClick={() => pick(r)} className="flex-1 min-w-0 h-full flex items-center gap-3 text-left text-body" aria-pressed={picked === r.id}>
                  <span className="flex-1 truncate">{r.name}</span>
                  <span className={cn("tabular-nums font-semibold shrink-0", r.points > 0 ? "text-online" : "text-destructive")}>{r.points > 0 ? `+${r.points}` : r.points}</span>
                  {picked === r.id && <Check className="w-4 h-4 text-primary shrink-0" />}
                </button>
                <button type="button" onClick={() => void remove(r)} className="w-9 h-9 shrink-0 flex items-center justify-center text-subtle active:text-destructive" aria-label={t("Убрать шаблон")}>
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            ))}
          </div>
        )}

        <div className="flex gap-2">
          <input
            type="number"
            inputMode="numeric"
            value={points}
            onChange={(e) => edit({ points: e.target.value })}
            placeholder={t("Баллы, ±")}
            className="w-28 shrink-0 h-11 rounded-md bg-surface-4 border border-transparent px-3 text-body outline-none focus:border-amber tabular-nums"
          />
          <input
            type="text"
            value={reason}
            onChange={(e) => edit({ reason: e.target.value.slice(0, 160) })}
            placeholder={t("За что")}
            className="flex-1 min-w-0 h-11 rounded-md bg-surface-4 border border-transparent px-3 text-body outline-none focus:border-amber"
          />
        </div>
        {picked === null && (
          <label className="mt-2 flex items-center gap-2 text-caption text-subtle">
            <input type="checkbox" className="w-4 h-4 accent-primary" checked={saveTpl} onChange={(e) => setSaveTpl(e.target.checked)} />
            {t("Сохранить как шаблон")}
          </label>
        )}

        <button
          type="button"
          onClick={submit}
          disabled={!valid || busy}
          className="mt-3 w-full h-11 rounded-md bg-primary text-primary-foreground font-medium active:opacity-90 disabled:opacity-40"
        >
          {busy ? t("Отправляю…") : Number.isFinite(n) && n < 0 ? t("Снять {n}", { n: Math.abs(n) }) : t("Начислить {n}", { n: Number.isFinite(n) ? n : "" })}
        </button>
      </div>
    </div>
  );
}
