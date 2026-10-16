import { useEffect, useState } from "react";
import { t } from "./i18n";

/**
 * Подтверждение «точно удалить?» своим окном вместо window.confirm. Нативный
 * диалог в Electron ломает фокус: после него поля ввода не берут курсор, пока
 * окно не потеряет и не вернёт фокус (баг Chromium, Windows особенно). Плюс
 * своё окно выглядит как остальное приложение.
 *
 * confirmDialog(message) → Promise<boolean>; ConfirmHost монтируется один раз в App.
 */
type Req = { message: string; ok: string; danger: boolean; resolve: (v: boolean) => void };

let listener: ((r: Req) => void) | null = null;

export function confirmDialog(message: string, opts: { ok?: string; danger?: boolean } = {}): Promise<boolean> {
  return new Promise((resolve) => {
    if (!listener) { resolve(window.confirm(t(message))); return; }
    listener({ message, ok: opts.ok || t("Удалить"), danger: opts.danger ?? true, resolve });
  });
}

export const ConfirmHost = () => {
  const [req, setReq] = useState<Req | null>(null);
  useEffect(() => { listener = setReq; return () => { listener = null; }; }, []);
  useEffect(() => {
    if (!req) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") { e.preventDefault(); done(false); } };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [req]);
  if (!req) return null;
  const done = (v: boolean) => { req.resolve(v); setReq(null); };
  return (
    // data-keep-panel: подтверждение из панели стикеров не закрывает её (ChatWindow).
    <div data-keep-panel className="fixed inset-0 z-[95] bg-black/60 flex items-end md:items-center justify-center" onClick={() => done(false)}>
      <div
        role="alertdialog" aria-modal="true"
        className="w-full md:max-w-sm bg-card border-t-2 md:border-2 border-border md:rounded-lg p-5 pad-safe-bottom space-y-4"
        onClick={(e) => e.stopPropagation()}
      >
        <p className="text-body whitespace-pre-line">{t(req.message)}</p>
        <div className="flex gap-2">
          <button type="button" autoFocus onClick={() => done(false)}
            className="flex-1 h-11 rounded-md bg-surface-4 text-foreground text-small font-medium active:opacity-80">
            {t("Отмена")}
          </button>
          <button type="button" onClick={() => done(true)}
            className={`flex-1 h-11 rounded-md text-small font-medium active:opacity-80 ${req.danger ? "bg-destructive text-white" : "bg-primary text-primary-foreground"}`}>
            {t(req.ok)}
          </button>
        </div>
      </div>
    </div>
  );
};
