import { useEffect, useState } from "react";
import { Monitor, AppWindow, Volume2, X } from "lucide-react";
import { t } from "@/lib/i18n";
import { cn } from "@/lib/utils";

/**
 * Выбор экрана или окна для демонстрации в программе WYX (Electron).
 *
 * Браузер показывает своё окно выбора, а Electron — нет: getDisplayMedia на
 * странице уходит в main-процесс (setDisplayMediaRequestHandler), тот шлёт
 * сюда экраны и окна с миниатюрами, выбранный возвращается обратно
 * (electronAPI.pickScreen). Закрыли — отмена, getDisplayMedia отклоняется.
 *
 * Звук компьютера (программа с 1.1.41: Windows, macOS 13+, Linux) — переключатель
 * внизу; выбор запоминаем. Старая программа о звуке не спрашивает — переключателя нет.
 */
const AUDIO_KEY = "hyax:screen-audio";
const readAudio = () => { try { return localStorage.getItem(AUDIO_KEY) !== "0"; } catch { return true; } };

const ScreenPicker = () => {
  const api = typeof window !== "undefined" ? window.electronAPI : undefined;
  const [list, setList] = useState<ScreenSource[] | null>(null);
  const [chosen, setChosen] = useState<string | null>(null);
  const [denied, setDenied] = useState(false);
  const [canAudio, setCanAudio] = useState(false);
  const [audio, setAudioState] = useState(readAudio);
  const setAudio = (on: boolean) => {
    setAudioState(on);
    try { localStorage.setItem(AUDIO_KEY, on ? "1" : "0"); } catch { /* без памяти — не страшно */ }
  };

  useEffect(() => {
    if (!api?.onScreenPick) return;
    return api.onScreenPick((sources, opts) => {
      setList(sources);
      setCanAudio(!!opts?.audio);
      setChosen(sources.find((s) => s.screen)?.id ?? sources[0]?.id ?? null);
      setDenied(false);
      // macOS без разрешения «Запись экрана» отдаёт миниатюры с одними обоями.
      void api.screenAccess?.().then((st) => setDenied(st === "denied" || st === "restricted")).catch(() => {});
    });
  }, [api]);

  useEffect(() => {
    if (!list) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close(null);
      if (e.key === "Enter" && chosen) close(chosen);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [list, chosen]);

  if (!list || !api) return null;

  function close(id: string | null) {
    api?.pickScreen?.(id, canAudio && audio);
    setList(null);
    setChosen(null);
  }

  const screens = list.filter((s) => s.screen);
  const windows = list.filter((s) => !s.screen);
  const card = (s: ScreenSource) => (
    <button
      key={s.id}
      type="button"
      onClick={() => setChosen(s.id)}
      onDoubleClick={() => close(s.id)}
      className={cn("flex flex-col gap-1.5 rounded-lg p-1.5 text-left border-2 transition-colors",
        chosen === s.id ? "border-primary bg-primary/10" : "border-transparent hover:bg-surface-2")}
      aria-pressed={chosen === s.id}
    >
      <div className="aspect-video w-full rounded-md overflow-hidden bg-black/40 flex items-center justify-center">
        {s.thumb
          ? <img src={s.thumb} alt="" className="w-full h-full object-contain" draggable={false} />
          : s.screen ? <Monitor className="w-8 h-8 text-subtle" /> : <AppWindow className="w-8 h-8 text-subtle" />}
      </div>
      <div className="flex items-center gap-1.5 min-w-0 px-0.5">
        {s.icon && <img src={s.icon} alt="" className="w-4 h-4 shrink-0" draggable={false} />}
        <span className="truncate text-small">{s.screen && screens.length === 1 ? t("Весь экран") : s.name}</span>
      </div>
    </button>
  );

  return (
    <div className="fixed inset-0 z-[90] bg-black/60 flex items-center justify-center p-4" onClick={() => close(null)}>
      <div className="w-full max-w-3xl max-h-[85vh] flex flex-col rounded-2xl bg-card border border-border shadow-2xl" onClick={(e) => e.stopPropagation()}
        role="dialog" aria-modal="true" aria-label={t("Что показать")}>
        <div className="flex items-center gap-2 px-5 pt-4 pb-3">
          <span className="flex-1 text-h2 font-semibold">{t("Что показать")}</span>
          <button type="button" onClick={() => close(null)} className="p-1 text-muted-foreground hover:text-foreground" aria-label={t("Закрыть")}>
            <X className="w-5 h-5" />
          </button>
        </div>
        {denied && (
          <div className="mx-5 mb-3 rounded-lg bg-surface-2 border border-border px-4 py-3 text-small">
            <p>{t("macOS не даёт WYX записывать экран — собеседник увидит только обои. Разрешите в Системных настройках → Конфиденциальность и безопасность → Запись экрана и перезапустите WYX.")}</p>
            <button type="button" onClick={() => api.openScreenSettings?.()} className="mt-2 font-semibold text-primary">{t("Открыть настройки")}</button>
          </div>
        )}
        <div className="flex-1 min-h-0 overflow-y-auto px-5 pb-2 space-y-4">
          {screens.length > 0 && (
            <section>
              <h4 className="text-caption text-subtle mb-2">{t("Экраны")}</h4>
              <div className="grid grid-cols-2 md:grid-cols-3 gap-2">{screens.map(card)}</div>
            </section>
          )}
          {windows.length > 0 && (
            <section>
              <h4 className="text-caption text-subtle mb-2">{t("Окна")}</h4>
              <div className="grid grid-cols-2 md:grid-cols-3 gap-2">{windows.map(card)}</div>
            </section>
          )}
          {!list.length && <p className="text-small text-subtle py-6 text-center">{t("Нечего показать: система не отдала ни экранов, ни окон")}</p>}
        </div>
        <div className="flex items-center justify-end gap-2 px-5 py-4 border-t border-border">
          {canAudio && (
            <label className="mr-auto flex items-center gap-2 cursor-pointer select-none text-small" title={t("Собеседники услышат звук компьютера — видео, музыку, игру")}>
              <input type="checkbox" className="w-4 h-4 accent-primary" checked={audio} onChange={(e) => setAudio(e.target.checked)} />
              <Volume2 className="w-4 h-4 text-subtle" />
              {t("Звук компьютера")}
            </label>
          )}
          <button type="button" onClick={() => close(null)} className="h-10 px-4 rounded-md hover:bg-surface-2">{t("Отмена")}</button>
          <button type="button" onClick={() => chosen && close(chosen)} disabled={!chosen}
            className="h-10 px-5 rounded-md bg-primary text-primary-foreground font-semibold disabled:opacity-40">
            {t("Показать")}
          </button>
        </div>
      </div>
    </div>
  );
};

export default ScreenPicker;
