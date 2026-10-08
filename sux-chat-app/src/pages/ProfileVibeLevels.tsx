import { useEffect, useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import ScreenHeader from "@/components/ScreenHeader";
import { api, type VibeLevel } from "@/api/client";
import { loadVibeLevels, vibeState } from "@/lib/vibeLevels";

/**
 * Профиль → Уровни вайбометра (только админ). С порога шкала и число в
 * профиле красятся в цвет уровня; «свечение» — шкала светится. Длина шкалы —
 * сколько баллов заполняют её на последнем уровне (и до первого, если
 * уровней нет). Между уровнями шкала — путь до следующего.
 */
type Row = VibeLevel & { key: string };
const newKey = () => Math.random().toString(36).slice(2);

export default function ProfileVibeLevels() {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [bar, setBar] = useState("10");
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState("15");

  useEffect(() => {
    api.getVibeLevels().then((c) => {
      setBar(String(c.bar_length));
      setRows(c.levels.map((l) => ({ ...l, key: newKey() })));
    }).catch(() => toast.error("Не удалось загрузить уровни"));
  }, []);

  const patch = (key: string, p: Partial<VibeLevel>) => setRows((r) => r && r.map((x) => (x.key === key ? { ...x, ...p } : x)));
  const add = () => setRows((r) => {
    const list = r || [];
    const top = list.reduce((m, x) => Math.max(m, x.min_vibe || 0), 0);
    return [...list, { key: newKey(), min_vibe: top + 10, name: "", color: "#8b5cf6", glow: true }];
  });

  const save = async () => {
    if (!rows || busy) return;
    setBusy(true);
    try {
      const saved = await api.saveVibeLevels({
        bar_length: Math.max(1, parseInt(bar, 10) || 10),
        levels: rows.map(({ key: _k, ...l }) => ({ ...l, min_vibe: Number(l.min_vibe) })),
      });
      setRows(saved.levels.map((l) => ({ ...l, key: newKey() })));
      setBar(String(saved.bar_length));
      void loadVibeLevels(true);
      toast.success("Уровни сохранены");
    } catch (e: any) {
      toast.error(e?.message || "Не удалось сохранить");
    } finally { setBusy(false); }
  };

  const cfg = { bar_length: Math.max(1, parseInt(bar, 10) || 10), levels: (rows || []).filter((r) => r.name && r.min_vibe > 0) };
  const pv = Math.max(0, parseInt(preview, 10) || 0);
  const st = vibeState(pv, cfg);

  return (
    <div className="h-screen flex flex-col bg-background">
      <ScreenHeader
        title="Уровни вайбометра"
        right={
          <button type="button" onClick={save} disabled={busy || !rows}
            className="px-2 h-10 text-body font-medium text-primary active:opacity-60 disabled:opacity-40">
            {busy ? "Сохраняю…" : "Готово"}
          </button>
        }
      />
      <div className="flex-1 overflow-y-auto">
        <div className="max-w-xl mx-auto px-4 py-4 space-y-3">
          <section className="ui-card rounded-lg bg-surface-2 border border-border p-4 space-y-3">
            <label className="flex items-center gap-3">
              <span className="flex-1">
                <span className="block text-body">Длина шкалы</span>
                <span className="block text-caption text-subtle">Баллов на полную шкалу на последнем уровне (и до первого)</span>
              </span>
              <input type="number" min={1} inputMode="numeric" value={bar} onChange={(e) => setBar(e.target.value)}
                className="w-24 h-10 px-3 rounded-md bg-background border border-border text-body text-right tabular-nums" />
            </label>
            <div className="border-t border-border pt-3">
              <div className="flex items-center gap-3">
                <span className="flex-1 text-small text-subtle">Предпросмотр для</span>
                <input type="number" min={0} inputMode="numeric" value={preview} onChange={(e) => setPreview(e.target.value)}
                  className="w-24 h-9 px-3 rounded-md bg-background border border-border text-small text-right tabular-nums" />
              </div>
              <div className="mt-2 flex items-center gap-2">
                <span className="flex-1 text-small" style={st.level ? { color: st.level.color } : undefined}>{st.level ? st.level.name : "Без уровня"}</span>
                <span className="text-small tabular-nums" style={st.level ? { color: st.level.color } : undefined}>{pv}</span>
              </div>
              <div className="mt-2 h-2 rounded-full bg-background">
                <div className={`h-full rounded-full ${st.level ? "" : "bg-primary"} ${st.glow ? "vibe-glow-bar" : ""}`}
                  style={{ width: `${Math.max(4, st.fill * 100)}%`, ...(st.level ? { background: st.level.color, ["--vibe-c" as string]: st.level.color } : {}) }} />
              </div>
              <p className="mt-1.5 text-caption text-subtle">{st.next ? `Следующий — «${st.next.name}» с ${st.next.min_vibe}` : "Последний уровень"}</p>
            </div>
          </section>

          {rows === null ? (
            <p className="py-8 text-center text-small text-subtle">Загружаю…</p>
          ) : (
            <>
              {rows.length === 0 && <p className="py-4 text-center text-small text-subtle">Уровней нет — шкала просто заполняется до длины шкалы.</p>}
              {[...rows].sort((a, b) => a.min_vibe - b.min_vibe).map((r) => (
                <section key={r.key} className="ui-card rounded-lg bg-surface-2 border border-border p-3.5 space-y-2.5">
                  <div className="flex items-center gap-2">
                    <input type="color" value={r.color} onChange={(e) => patch(r.key, { color: e.target.value })} aria-label="Цвет"
                      className="w-10 h-10 shrink-0 rounded-md border border-border bg-transparent p-0.5" />
                    <input value={r.name} maxLength={40} onChange={(e) => patch(r.key, { name: e.target.value })} placeholder="Название, например «Бронза»"
                      className="flex-1 min-w-0 h-10 px-3 rounded-md bg-background border border-border text-body" />
                    <button type="button" onClick={() => setRows((x) => x && x.filter((y) => y.key !== r.key))} aria-label="Удалить уровень"
                      className="w-10 h-10 shrink-0 rounded-md bg-surface-4 text-destructive flex items-center justify-center active:opacity-80">
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="text-small text-subtle">С</span>
                    <input type="number" min={1} inputMode="numeric" value={r.min_vibe || ""} onChange={(e) => patch(r.key, { min_vibe: parseInt(e.target.value, 10) || 0 })}
                      className="w-24 h-9 px-3 rounded-md bg-background border border-border text-small text-right tabular-nums" />
                    <span className="text-small text-subtle flex-1">баллов</span>
                    <label className="flex items-center gap-2 text-small">
                      <input type="checkbox" checked={r.glow} onChange={(e) => patch(r.key, { glow: e.target.checked })} className="w-4 h-4 accent-[hsl(var(--primary))]" />
                      Свечение
                    </label>
                  </div>
                </section>
              ))}
              <button type="button" onClick={add}
                className="w-full h-11 rounded-md border border-dashed border-border text-small font-medium flex items-center justify-center gap-2 active:bg-surface-3">
                <Plus className="w-4 h-4" />Добавить уровень
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
