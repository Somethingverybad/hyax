import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Check, Plus, X } from "lucide-react";
import { toast } from "sonner";
import ScreenHeader from "@/components/ScreenHeader";
import Identicon from "@/components/Identicon";
import { Aura, AURA_SWATCHES, DEFAULT_AURA } from "@/components/Aura";
import { api } from "@/api/client";
import { readCache, writeCache } from "@/lib/session-cache";

/**
 * Профиль → Аура. Свечение вокруг аватара, пока человек в сети, и его
 * значение — как статусы в ICQ. Сохранённые ауры («Мои ауры») выбираются в
 * одно касание; новая попадает в список при сохранении.
 */
type Preset = { color: string; text: string };
type Me = {
  id: string; username: string; avatar_url?: string | null; hide_online?: boolean;
  aura_color?: string | null; aura_text?: string | null; aura_presets?: Preset[];
};

const MAX_TEXT = 60;
const MAX_PRESETS = 12;
const norm = (c: string) => c.trim().toLowerCase();

export default function ProfileAura() {
  const navigate = useNavigate();
  const [me, setMe] = useState<Me | null>(() => readCache<Me>("user"));
  const [color, setColor] = useState(() => me?.aura_color || "");
  const [text, setText] = useState(() => me?.aura_text || "");
  const [presets, setPresets] = useState<Preset[]>(() => me?.aura_presets || []);
  const [busy, setBusy] = useState(false);

  // Свежий профиль: в кеше могло не быть сохранённых аур.
  useEffect(() => {
    api.getProfile().then((p) => {
      const m = p as unknown as Me;
      setMe(m);
      setColor((c) => c || m.aura_color || "");
      setText((t) => t || m.aura_text || "");
      setPresets(m.aura_presets || []);
    }).catch(() => { /* остаёмся на кеше */ });
  }, []);

  const shown = color || DEFAULT_AURA;
  const custom = color && !AURA_SWATCHES.includes(norm(color));

  const save = async (next?: { color: string; text: string }) => {
    if (!me || busy) return;
    const c = norm(next ? next.color : color);
    const t = (next ? next.text : text).trim();
    // Своя аура (цвет или текст) попадает в «Мои ауры» первой, без повторов.
    let list = presets;
    if (c || t) {
      const item = { color: c || DEFAULT_AURA, text: t };
      list = [item, ...presets.filter((p) => !(norm(p.color) === item.color && p.text === item.text))].slice(0, MAX_PRESETS);
    }
    setBusy(true);
    try {
      const upd = await api.updateProfile(me.id, { aura_color: c, aura_text: t, aura_presets: list });
      writeCache("user", { ...(readCache<object>("user") || {}), ...upd });
      setPresets(list);
      toast.success(c || t ? "Аура сохранена" : "Аура по умолчанию");
      navigate(-1);
    } catch (e) {
      toast.error((e as Error).message || "Не удалось сохранить");
    } finally {
      setBusy(false);
    }
  };

  const removePreset = async (i: number) => {
    if (!me) return;
    const list = presets.filter((_, k) => k !== i);
    setPresets(list);
    try { await api.updateProfile(me.id, { aura_presets: list }); } catch { /* вернётся при следующем сохранении */ }
  };

  return (
    <div className="h-screen flex flex-col bg-background">
      <ScreenHeader
        title="Аура"
        right={
          <button type="button" onClick={() => save()} disabled={busy || !me}
            className="px-2 h-10 text-body font-medium text-primary active:opacity-60 disabled:opacity-40">
            {busy ? "Сохраняю…" : "Готово"}
          </button>
        }
      />

      <div className="flex-1 overflow-y-auto">
        <div className="max-w-xl mx-auto px-4 py-4 space-y-3">
          {/* Предпросмотр: так аватар выглядит у собеседников, пока вы в сети. */}
          <section className="ui-card rounded-lg bg-surface-2 border border-border p-6 flex flex-col items-center gap-4">
            <div className="py-3">
              <Aura active owner={{ aura_color: shown, aura_text: text }} size={104}>
                <Identicon id={me?.id || "?"} avatarUrl={me?.avatar_url} className="w-[104px] h-[104px] rounded-lg" />
              </Aura>
            </div>
            <div className="text-center min-w-0 max-w-full">
              <p className="text-h2 text-foreground truncate">{me?.username || "…"}</p>
              <p className="mt-1 text-small text-subtle truncate">{text.trim() || "без подписи"}</p>
            </div>
            {me?.hide_online && (
              <p className="text-caption text-subtle text-center">
                Включён статус «Скрыт» — собеседники не видят, что вы в сети, и ауру тоже.
              </p>
            )}
          </section>

          <section className="ui-card rounded-lg bg-surface-2 border border-border p-4">
            <h2 className="text-small text-subtle mb-3">Цвет</h2>
            <div className="grid grid-cols-7 gap-2.5">
              {AURA_SWATCHES.map((c) => {
                const on = norm(shown) === c;
                return (
                  <button key={c} type="button" onClick={() => setColor(c)} aria-label={`Цвет ${c}`} aria-pressed={on}
                    className="aspect-square rounded-full border border-border flex items-center justify-center active:scale-95 transition-transform"
                    style={{ background: c, boxShadow: on ? `0 0 0 2px hsl(var(--surface-2)), 0 0 0 4px ${c}` : undefined }}>
                    {on && <Check className="w-4 h-4" style={{ color: c === "#ffffff" ? "#000" : "#fff" }} />}
                  </button>
                );
              })}
              {/* Свой цвет — системная палитра. */}
              <label className="aspect-square rounded-full border border-dashed border-border flex items-center justify-center cursor-pointer relative overflow-hidden active:scale-95 transition-transform"
                style={custom ? { background: color, boxShadow: `0 0 0 2px hsl(var(--surface-2)), 0 0 0 4px ${color}` } : undefined}
                aria-label="Свой цвет">
                {custom ? <Check className="w-4 h-4 text-white" /> : <Plus className="w-4 h-4 text-subtle" />}
                <input type="color" value={custom ? color : "#ff6a00"} onChange={(e) => setColor(e.target.value)}
                  className="absolute inset-0 opacity-0 cursor-pointer" />
              </label>
            </div>
          </section>

          <section className="ui-card rounded-lg bg-surface-2 border border-border p-4">
            <label htmlFor="aura-text" className="text-small text-subtle">Значение</label>
            <input id="aura-text" value={text} maxLength={MAX_TEXT} onChange={(e) => setText(e.target.value)}
              placeholder="Например: работаю, не беспокоить"
              className="mt-2 w-full h-11 px-3 rounded-md bg-background border border-border text-body text-foreground placeholder:text-subtle outline-none focus:border-primary" />
            <div className="mt-1.5 flex justify-between text-caption text-subtle">
              <span>Видно при наведении на аватар и в карточке профиля</span>
              <span className="tabular-nums">{text.length}/{MAX_TEXT}</span>
            </div>
          </section>

          {presets.length > 0 && (
            <section className="ui-card rounded-lg bg-surface-2 border border-border p-4">
              <h2 className="text-small text-subtle mb-2">Мои ауры</h2>
              <ul className="space-y-1">
                {presets.map((p, i) => (
                  <li key={`${p.color}-${p.text}-${i}`} className="flex items-center gap-2">
                    <button type="button" onClick={() => { setColor(p.color); setText(p.text); }}
                      className="flex-1 min-w-0 flex items-center gap-3 py-2 px-2 -mx-2 rounded-md text-left active:bg-surface-3 hover:bg-surface-3/60">
                      <span className="w-3.5 h-3.5 rounded-full shrink-0" style={{ background: p.color, boxShadow: `0 0 8px ${p.color}` }} />
                      <span className="flex-1 min-w-0 truncate text-body text-foreground">{p.text || "без подписи"}</span>
                    </button>
                    <button type="button" onClick={() => removePreset(i)} aria-label="Удалить ауру"
                      className="p-2 -mr-2 text-subtle active:text-foreground">
                      <X className="w-4 h-4" />
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          )}

          <button type="button" onClick={() => { setColor(""); setText(""); void save({ color: "", text: "" }); }}
            disabled={busy || (!me?.aura_color && !me?.aura_text)}
            className="w-full h-11 rounded-md border border-border text-body text-foreground active:bg-surface-3 disabled:opacity-40">
            Без своей ауры — свечение по умолчанию
          </button>
          <p className="text-caption text-subtle pb-4">
            Аура светится вокруг аватара, только пока вы в сети. Не в сети — свечения нет.
          </p>
        </div>
      </div>
    </div>
  );
}
