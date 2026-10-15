import { useEffect, useState } from "react";
import { Plus, X } from "lucide-react";
import { toast } from "sonner";
import ScreenHeader from "@/components/ScreenHeader";
import { api, type ChatActionInfo, type ChatActionDraft } from "@/api/client";
import { loadActions } from "@/components/chat/ActionSheet";
import { cn } from "@/lib/utils";
import { t } from "@/lib/i18n";

/**
 * Профиль → Действия (только админ): каталог «подмигнуть», «обнять»… —
 * добавить, поправить, скрыть. Переводы необязательны: пустые поля сервер
 * заполнит переводчиком при сохранении (chat/views.py, _fill_action_translations).
 * 18+ — действие видят только те, кто включил «Показывать 18+».
 */
const EMPTY: ChatActionDraft = {
  emoji: "✨", name: "", verb: "", order: 100, is_active: true, premium: false, adult: false,
  name_en: "", name_ko: "", phrase_en: "", phrase_ko: "",
};

const field = "w-full h-10 px-3 rounded-md bg-background border border-border text-body";

export default function ProfileActions() {
  const [list, setList] = useState<ChatActionInfo[] | null>(null);
  const [edit, setEdit] = useState<{ id: number | null; data: ChatActionDraft } | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api.getAllActions().then(setList).catch(() => toast.error(t("Не удалось загрузить действия")));
  }, []);

  const set = (p: ChatActionDraft) => setEdit((e) => (e ? { ...e, data: { ...e.data, ...p } } : e));

  const save = async () => {
    if (!edit || busy) return;
    const d = edit.data;
    if (!d.name?.trim() || !d.verb?.trim()) { toast.error(t("Нужны кнопка и глагол")); return; }
    setBusy(true);
    try {
      const saved = await api.saveAction(edit.id, { ...d, name: d.name.trim(), verb: d.verb.trim(), order: Number(d.order) || 100 });
      setList((l) => {
        const rest = (l || []).filter((x) => x.id !== saved.id);
        return [...rest, saved].sort((a, b) => (a.order ?? 100) - (b.order ?? 100) || a.name.localeCompare(b.name));
      });
      // Сервер дописал переводы — показываем их в форме.
      setEdit({ id: saved.id, data: saved });
      void loadActions(true);
      toast.success(t("Сохранено"));
    } catch (e: any) {
      toast.error(e?.message || t("Не удалось сохранить"));
    } finally { setBusy(false); }
  };

  const d = edit?.data;
  return (
    <div className="h-screen flex flex-col bg-background">
      <ScreenHeader title={t("Действия")} />
      <div className="flex-1 overflow-y-auto">
        <div className="max-w-xl mx-auto px-4 py-4 space-y-3">
          <button type="button" onClick={() => setEdit({ id: null, data: { ...EMPTY } })}
            className="w-full h-11 rounded-md border border-dashed border-border text-small font-medium flex items-center justify-center gap-2 active:bg-surface-3">
            <Plus className="w-4 h-4" />{t("Добавить действие")}
          </button>
          {list === null ? (
            <p className="py-8 text-center text-small text-subtle">{t("Загружаю…")}</p>
          ) : list.map((a) => (
            <button key={a.id} type="button" onClick={() => setEdit({ id: a.id, data: { ...a } })}
              className={cn("ui-card w-full rounded-lg bg-surface-2 border border-border p-3 flex items-center gap-3 text-left active:opacity-80", a.is_active === false && "opacity-50")}>
              <span className="text-2xl leading-none shrink-0">{a.emoji}</span>
              <span className="min-w-0 flex-1">
                <span className="block text-body truncate">{a.name}</span>
                <span className="block text-caption text-subtle truncate">vasya {a.verb} petya</span>
              </span>
              {a.adult && <span className="px-1.5 h-5 rounded-full bg-destructive/15 text-[11px] font-semibold text-destructive flex items-center shrink-0">18+</span>}
              {a.premium && <span className="px-1.5 h-5 rounded-full bg-primary/15 text-[11px] font-semibold text-primary flex items-center shrink-0">{t("премиум")}</span>}
              {a.is_active === false && <span className="text-caption text-subtle shrink-0">{t("скрыто")}</span>}
            </button>
          ))}
        </div>
      </div>

      {edit && d && (
        <div className="fixed inset-0 z-[80] bg-black/60 flex flex-col justify-end md:items-center md:justify-center" onClick={() => setEdit(null)}>
          <div className="bg-card border-t-2 md:border-2 border-border md:rounded-lg w-full md:w-[480px] max-h-[90%] flex flex-col pad-safe-bottom" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center gap-2 px-4 py-3 border-b border-border shrink-0">
              <span className="font-semibold flex-1">{edit.id ? t("Действие") : t("Новое действие")}</span>
              <button type="button" onClick={() => setEdit(null)} aria-label={t("Закрыть")}><X className="w-5 h-5" /></button>
            </div>
            <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3 text-small">
              <div className="flex gap-2">
                <input value={d.emoji || ""} maxLength={8} onChange={(e) => set({ emoji: e.target.value })} aria-label={t("Эмодзи")}
                  className="w-14 h-10 rounded-md bg-background border border-border text-center text-xl" />
                <input value={d.name || ""} maxLength={40} onChange={(e) => set({ name: e.target.value })} placeholder={t("Кнопка, например «Подмигнуть»")}
                  className={cn(field, "flex-1 min-w-0")} />
              </div>
              <label className="block">
                <span className="block text-subtle mb-1">{t("Глагол в сообщении")}</span>
                <input value={d.verb || ""} maxLength={60} onChange={(e) => set({ verb: e.target.value })} placeholder={t("подмигивает")} className={field} />
                {d.verb ? <span className="block mt-1 text-caption text-subtle">{t("В чате")}: «vasya {d.verb} petya»</span> : null}
              </label>
              <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
                <label className="flex items-center gap-2"><input type="checkbox" className="w-4 h-4 accent-primary" checked={d.is_active !== false} onChange={(e) => set({ is_active: e.target.checked })} />{t("Показывать")}</label>
                <label className="flex items-center gap-2"><input type="checkbox" className="w-4 h-4 accent-primary" checked={!!d.adult} onChange={(e) => set({ adult: e.target.checked })} />{t("18+")}</label>
                <label className="flex items-center gap-2"><input type="checkbox" className="w-4 h-4 accent-primary" checked={!!d.premium} onChange={(e) => set({ premium: e.target.checked })} />{t("Премиум")}</label>
                <label className="flex items-center gap-2">{t("Порядок")}
                  <input type="number" inputMode="numeric" value={d.order ?? 100} onChange={(e) => set({ order: parseInt(e.target.value, 10) || 0 })}
                    className="w-20 h-9 px-2 rounded-md bg-background border border-border text-right tabular-nums" />
                </label>
              </div>
              {d.adult && <p className="text-caption text-subtle">{t("Действие 18+ видят только те, кто включил «Показывать 18+»")}</p>}

              <div className="border-t border-border pt-3 space-y-2">
                <p className="font-semibold">{t("Переводы")}</p>
                <p className="text-caption text-subtle">{t("Необязательно: пустые поля заполнит переводчик при сохранении. В фразе {who} — кто, {whom} — кому.")}</p>
                {(["en", "ko"] as const).map((lang) => (
                  <div key={lang} className="space-y-1.5">
                    <span className="block text-caption text-subtle uppercase">{lang}</span>
                    <input value={(d[`name_${lang}`] as string) || ""} maxLength={40} onChange={(e) => set({ [`name_${lang}`]: e.target.value })}
                      placeholder={lang === "en" ? "Wink" : "윙크하기"} className={field} />
                    <input value={(d[`phrase_${lang}`] as string) || ""} maxLength={120} onChange={(e) => set({ [`phrase_${lang}`]: e.target.value })}
                      placeholder={lang === "en" ? "{who} winks at {whom}" : "{who}님이 {whom}님에게 윙크해요"} className={field} />
                  </div>
                ))}
              </div>
            </div>
            <div className="px-4 py-3 border-t border-border shrink-0">
              <button type="button" onClick={save} disabled={busy}
                className="w-full h-11 rounded-md bg-primary text-primary-foreground text-body font-semibold disabled:opacity-60">
                {busy ? t("Сохраняю и перевожу…") : t("Сохранить")}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
