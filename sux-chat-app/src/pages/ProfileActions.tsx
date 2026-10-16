import { useEffect, useState } from "react";
import { Plus, Search, X } from "lucide-react";
import { toast } from "sonner";
import ScreenHeader from "@/components/ScreenHeader";
import { api, type ChatActionInfo, type ChatActionDraft } from "@/api/client";
import { loadActions } from "@/components/chat/ActionSheet";
import { cn } from "@/lib/utils";
import { ruSelf, ruYou, trailingPrep } from "@/lib/actionText";
import { t } from "@/lib/i18n";
import { useKeyboardHeight } from "@/lib/useKeyboardHeight";

/**
 * Профиль → Действия (только админ): каталог «подмигнуть», «обнять»… —
 * добавить, поправить, скрыть. Переводы необязательны: пустые поля сервер
 * заполнит переводчиком при сохранении (chat/views.py, _fill_action_translations).
 * 18+ — действие видят только те, кто включил «Показывать 18+».
 */
const EMPTY: ChatActionDraft = {
  emoji: "✨", name: "", verb: "", is_active: true, premium: false, adult: false,
  name_en: "", name_ko: "", phrase_en: "", phrase_ko: "",
  phrase_ru_self: "", phrase_ru_you: "", phrase_en_self: "", phrase_en_you: "", phrase_ko_self: "", phrase_ko_you: "",
};

/** Подставить «вы»-формы по глаголу, пока админ их не правил руками. */
const autoForms = (d: ChatActionDraft, acc: boolean, prev?: ChatActionDraft): ChatActionDraft => {
  const verb = (d.verb || "").trim();
  const was = prev?.verb ? { self: ruSelf(prev.verb), you: [ruYou(prev.verb, false), ruYou(prev.verb, true)] } : null;
  const out = { ...d };
  if (!out.phrase_ru_self || (was && out.phrase_ru_self === was.self)) out.phrase_ru_self = verb ? ruSelf(verb) : "";
  if (!out.phrase_ru_you || (was && was.you.includes(out.phrase_ru_you))) out.phrase_ru_you = verb ? ruYou(verb, acc) : "";
  return out;
};

const field = "w-full h-10 px-3 rounded-md bg-background border border-border text-body";

export default function ProfileActions() {
  const [list, setList] = useState<ChatActionInfo[] | null>(null);
  const [edit, setEdit] = useState<{ id: number | null; data: ChatActionDraft } | null>(null);
  const [busy, setBusy] = useState(false);
  const [q, setQ] = useState("");
  // Высота клавиатуры — из общего события (и iOS, и Android): на iPhone
  // переменные --kb-* на корне не ставятся (подъём там — стилем на самих
  // панелях), и ограничение по ним было нулевым — верх окна уезжал за экран.
  const kb = useKeyboardHeight();
  // «Вам» или «Вас» адресату: «подмигивает кому» — Вам, «обнимает кого» — Вас.
  const [acc, setAcc] = useState(false);

  useEffect(() => {
    api.getAllActions().then(setList).catch(() => toast.error(t("Не удалось загрузить действия")));
  }, []);

  const set = (p: ChatActionDraft) => setEdit((e) => {
    if (!e) return e;
    const next = { ...e.data, ...p };
    return { ...e, data: "verb" in p ? autoForms(next, acc, e.data) : next };
  });
  const setAccForm = (v: boolean) => {
    setAcc(v);
    setEdit((e) => (e && e.data.verb && !trailingPrep(e.data.verb) ? { ...e, data: { ...e.data, phrase_ru_you: ruYou(e.data.verb, v) } } : e));
  };
  const open = (id: number | null, data: ChatActionDraft) => {
    setAcc(/^Вас /.test(data.phrase_ru_you || ""));
    setEdit({ id, data });
  };
  const shown = (list || []).filter((a) => {
    const s = q.trim().toLowerCase();
    return !s || [a.name, a.verb, a.name_en, a.name_ko].some((x) => (x || "").toLowerCase().includes(s));
  });

  const save = async () => {
    if (!edit || busy) return;
    const d = edit.data;
    if (!d.name?.trim() || !d.verb?.trim()) { toast.error(t("Нужны кнопка и глагол")); return; }
    setBusy(true);
    try {
      const { order: _o, ...rest } = d;
      const saved = await api.saveAction(edit.id, { ...rest, name: d.name.trim(), verb: d.verb.trim() });
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
          <label className="flex items-center gap-2 h-10 px-3 rounded-md bg-surface-2 border border-border">
            <Search className="w-4 h-4 text-subtle shrink-0" />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t("Поиск действия")} className="flex-1 min-w-0 bg-transparent outline-none text-body" />
          </label>
          <button type="button" onClick={() => open(null, { ...EMPTY })}
            className="w-full h-11 rounded-md border border-dashed border-border text-small font-medium flex items-center justify-center gap-2 active:bg-surface-3">
            <Plus className="w-4 h-4" />{t("Добавить действие")}
          </button>
          {list === null ? (
            <p className="py-8 text-center text-small text-subtle">{t("Загружаю…")}</p>
          ) : shown.map((a) => (
            <button key={a.id} type="button" onClick={() => open(a.id, { ...a })}
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
          {/* Высота — только видимая часть над клавиатурой: окно поднимается на её
              высоту (pad-safe-bottom), и с max-h 90% экрана верх уезжал за край.
              Подъём на iPhone — высота клавиатуры минус отступ под индикатор;
              вычитаем её целиком: окно на эти пункты ниже, зато верх на экране. */}
          <div className="bg-card border-t-2 md:border-2 border-border md:rounded-lg w-full md:w-[480px] flex flex-col pad-safe-bottom"
            style={{ maxHeight: `calc(100% - ${kb}px - var(--sat, 0px) - 12px)` }}
            onClick={(e) => e.stopPropagation()}>
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
              </label>
              {d.verb ? (
                <div className="space-y-2 rounded-md bg-surface-2 p-2.5">
                  <p className="text-caption text-subtle">{t("Как увидят: можно поправить. {who} — кто, {whom} — кому")}</p>
                  <label className="block">
                    <span className="block text-caption text-subtle mb-0.5">{t("Отправителю")}</span>
                    <input value={d.phrase_ru_self || ""} maxLength={120} onChange={(e) => set({ phrase_ru_self: e.target.value })} className={field} />
                  </label>
                  <div>
                    <div className="flex items-center gap-2 mb-0.5">
                      <span className="flex-1 text-caption text-subtle">{t("Адресату")}</span>
                      {!trailingPrep(d.verb) && (
                        <span className="flex rounded-full bg-background p-0.5 text-caption" role="group" aria-label={t("Вам или Вас")}>
                          {([false, true] as const).map((v) => (
                            <button key={String(v)} type="button" onClick={() => setAccForm(v)} aria-pressed={acc === v}
                              className={cn("px-2.5 h-6 rounded-full", acc === v ? "bg-primary text-primary-foreground" : "text-subtle")}>
                              {v ? t("Вас (кого?)") : t("Вам (кому?)")}
                            </button>
                          ))}
                        </span>
                      )}
                    </div>
                    <input value={d.phrase_ru_you || ""} maxLength={120} onChange={(e) => set({ phrase_ru_you: e.target.value })} className={field} />
                  </div>
                  <p className="text-caption text-subtle">{t("Остальным")}: «{"{who}"} {d.verb} {"{whom}"}»</p>
                </div>
              ) : null}
              <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
                <label className="flex items-center gap-2"><input type="checkbox" className="w-4 h-4 accent-primary" checked={d.is_active !== false} onChange={(e) => set({ is_active: e.target.checked })} />{t("Показывать")}</label>
                <label className="flex items-center gap-2"><input type="checkbox" className="w-4 h-4 accent-primary" checked={!!d.adult} onChange={(e) => set({ adult: e.target.checked })} />{t("18+")}</label>
                <label className="flex items-center gap-2"><input type="checkbox" className="w-4 h-4 accent-primary" checked={!!d.premium} onChange={(e) => set({ premium: e.target.checked })} />{t("Премиум")}</label>
              </div>
              {d.adult && <p className="text-caption text-subtle">{t("Действие 18+ видят только те, кто включил «Показывать 18+»")}</p>}

              <div className="border-t border-border pt-3 space-y-2">
                <p className="font-semibold">{t("Переводы")}</p>
                <p className="text-caption text-subtle">{t("Необязательно: пустые поля заполнит переводчик при сохранении. В каждом языке — кнопка и фразы для остальных, отправителя и адресата.")}</p>
                {(["en", "ko"] as const).map((lang) => (
                  <div key={lang} className="space-y-1.5">
                    <span className="block text-caption text-subtle uppercase">{lang}</span>
                    <input value={(d[`name_${lang}`] as string) || ""} maxLength={40} onChange={(e) => set({ [`name_${lang}`]: e.target.value })}
                      placeholder={lang === "en" ? "Wink" : "윙크하기"} className={field} />
                    <input value={(d[`phrase_${lang}`] as string) || ""} maxLength={120} onChange={(e) => set({ [`phrase_${lang}`]: e.target.value })}
                      placeholder={lang === "en" ? "{who} winks at {whom}" : "{who}님이 {whom}님에게 윙크해요"} className={field} aria-label={t("Остальным")} />
                    <input value={(d[`phrase_${lang}_self`] as string) || ""} maxLength={120} onChange={(e) => set({ [`phrase_${lang}_self`]: e.target.value })}
                      placeholder={lang === "en" ? "You wink at {whom}" : "{whom}님에게 윙크했어요"} className={field} aria-label={t("Отправителю")} />
                    <input value={(d[`phrase_${lang}_you`] as string) || ""} maxLength={120} onChange={(e) => set({ [`phrase_${lang}_you`]: e.target.value })}
                      placeholder={lang === "en" ? "{who} winks at you" : "{who}님이 당신에게 윙크해요"} className={field} aria-label={t("Адресату")} />
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
