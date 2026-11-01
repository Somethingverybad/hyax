import { useEffect, useMemo, useState } from "react";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import { toast } from "sonner";
import { AlertTriangle, Check, Eye, EyeOff, Shirt, Undo2 } from "lucide-react";
import ScreenHeader from "@/components/ScreenHeader";
import ThemeShowcase from "@/components/ThemeShowcase";
import { SettingsCard, SettingsTitle } from "@/components/settings";
import { api } from "@/api/client";
import { getTrial, setInstalledThemes, setTheme, tryTheme, useInstalledThemes, useTheme, useTrial } from "@/lib/theme";
import { SHAPE_PRESETS, THEME_BASES } from "@/themes/builtin";
import { contrastIssues, normalizeTheme, paletteFrom } from "@/themes/engine";
import { COLOR_KEYS, SHAPE_LIMITS, type ColorKey, type ThemeDef, type ThemeShape } from "@/themes/types";
import { t as tr } from "@/lib/i18n";
import { cn } from "@/lib/utils";

/** Подписи всех 29 цветов (режим «Все цвета»), по группам. */
const ALL_GROUPS: { title: string; items: [ColorKey, string][] }[] = [
  { title: "Фон и поверхности", items: [
    ["background", "Фон экрана"], ["surface1", "Карточки"], ["surface2", "Карточки, второй слой"],
    ["surface3", "Нажатая строка"], ["surface4", "Вторичные кнопки"], ["chatCanvas", "Фон переписки"],
  ] },
  { title: "Текст и линии", items: [
    ["foreground", "Текст"], ["mutedForeground", "Второстепенный текст"], ["subtleForeground", "Подписи и подсказки"],
    ["border", "Линии и обводка"], ["divider", "Разделители"], ["ink", "Тушь (обводка, тени)"],
  ] },
  { title: "Акценты", items: [
    ["primary", "Основной цвет"], ["primaryForeground", "Текст на основном"], ["primaryDeep", "Основной, глубже"],
    ["accent", "Акцент (таблетки, фильтры)"], ["accentForeground", "Текст на акценте"], ["accentSoft", "Мягкий акцент"], ["ring", "Рамка фокуса"],
  ] },
  { title: "Состояния", items: [
    ["destructive", "Опасное действие"], ["destructiveForeground", "Текст на опасном"], ["success", "Успех"],
    ["successForeground", "Текст на успехе"], ["online", "«В сети»"], ["amber", "Отметки и фокус (звезда, закреп, поле ввода)"],
  ] },
  { title: "Сообщения", items: [
    ["bubbleOwn", "Свои"], ["bubbleOwnFg", "Текст своих"], ["bubbleIn", "Входящие"], ["bubbleInFg", "Текст входящих"],
  ] },
];
// Ни один цвет не забыт: если схема пополнится, а подписи нет — увидим в разработке.
if (import.meta.env.DEV) {
  const listed = new Set(ALL_GROUPS.flatMap((g) => g.items.map(([k]) => k)));
  const missing = COLOR_KEYS.filter((k) => !listed.has(k));
  if (missing.length) console.warn("ThemeEditor: нет подписи для", missing);
}

const STYLES: [ThemeShape["style"], string, string][] = [
  ["soft", "Мягкий", "Как «Мята»: таблетки, карточки, остров навигации"],
  ["flat", "Плоский", "Ровные поверхности и тонкие линии"],
  ["outlined", "Обводка", "Жирный контур и жёсткая тень"],
  ["glass", "Стекло", "Полупрозрачные поверхности"],
];

const Slider = ({ label, value, min, max, step = 1, onChange, unit = "px" }: {
  label: string; value: number; min: number; max: number; step?: number; unit?: string; onChange: (v: number) => void;
}) => (
  <label className="px-4 py-2.5 flex items-center gap-3">
    <span className="min-w-0 flex-1 text-body">{label}</span>
    <input type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} className="w-32 accent-primary" />
    <span className="w-12 text-right text-small text-subtle tabular-nums">{value}{unit}</span>
  </label>
);

const Toggle = ({ label, hint, checked, onChange }: { label: string; hint?: string; checked: boolean; onChange: (v: boolean) => void }) => (
  <label className="px-4 py-2.5 flex items-center gap-3">
    <span className="min-w-0 flex-1">
      <span className="block text-body">{label}</span>
      {hint && <span className="block text-caption text-subtle">{hint}</span>}
    </span>
    <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} className="w-5 h-5 accent-primary shrink-0" />
  </label>
);

const ColorRow = ({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) => (
  <label className="px-4 py-2.5 flex items-center gap-3">
    <span className="min-w-0 flex-1 text-body">{label}</span>
    <span className="text-caption text-subtle tabular-nums">{value}</span>
    <input type="color" value={value} onChange={(e) => onChange(e.target.value.toUpperCase())} aria-label={label}
      className="w-10 h-8 rounded-md bg-transparent border border-border shrink-0" />
  </label>
);

/** Кружок основы: фон, карточка, акцент и свои сообщения этой темы. */
const BaseSwatch = ({ theme }: { theme: ThemeDef }) => (
  <span className="w-12 h-12 rounded-[14px] grid grid-cols-2 overflow-hidden border border-border shrink-0" aria-hidden>
    <span style={{ background: theme.colors.background }} />
    <span style={{ background: theme.colors.surface1 }} />
    <span style={{ background: theme.colors.accent }} />
    <span style={{ background: theme.colors.bubbleOwn }} />
  </span>
);

/**
 * Редактор темы. Сверху — предпросмотр трёх экранов (ThemeShowcase) и
 * «Примерить» на всё приложение; ниже основа (любая встроенная тема), стиль
 * (мягкий, плоский, обводка, стекло), цвета — «Быстро» из трёх или все 29 —
 * и форма. Произвольный CSS ввести нельзя: только значения схемы, их же
 * проверяет сервер.
 */
const ThemeEditor = () => {
  const { id = "new" } = useParams();
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const installed = useInstalledThemes();
  const active = useTheme();
  const trial = useTrial();
  const isNew = id === "new";

  const [draft, setDraft] = useState<ThemeDef>(() => {
    // Вернулись с примерки — продолжаем ровно с примеренного.
    const tr0 = getTrial();
    if (tr0 && tr0.from === pathname) return tr0.theme;
    const base = installed.find((t) => t.id === id);
    if (base) return base;
    // Новая тема начинается с текущей: так её правят, а не собирают с нуля.
    return normalizeTheme({ ...active, id: "new", name: "", builtin: false, mine: true });
  });
  const [busy, setBusy] = useState(false);
  const [isPublic, setIsPublic] = useState(true);
  const [preview, setPreview] = useState(true);
  const [mode, setMode] = useState<"quick" | "all">("quick");
  const [quick, setQuick] = useState(() => ({ background: draft.colors.background, accent: draft.colors.accent, bubbleOwn: draft.colors.bubbleOwn }));

  useEffect(() => {
    if (isNew || getTrial()?.from === pathname) return;
    const found = installed.find((t) => t.id === id);
    if (found) setDraft(found);
  }, [id, installed, isNew, pathname]);

  const issues = useMemo(() => contrastIssues(draft.colors), [draft]);
  const trying = !!trial && trial.from === pathname;
  // Примерка идёт — она повторяет черновик: меняете цвета — меняется всё приложение.
  useEffect(() => { if (trying) tryTheme(draft, pathname); }, [draft]); // eslint-disable-line react-hooks/exhaustive-deps

  const setColor = (key: ColorKey, value: string) => setDraft((d) => ({ ...d, colors: { ...d.colors, [key]: value } }));
  const setShape = (patch: Partial<ThemeShape>) => setDraft((d) => ({ ...d, shape: { ...d.shape, ...patch } }));
  const setQuickColor = (patch: Partial<typeof quick>, base = draft.base) => {
    const q = { ...quick, ...patch };
    setQuick(q);
    setDraft((d) => ({ ...d, base, colors: paletteFrom({ base, ...q }) }));
  };
  const fromBase = (src: ThemeDef) => {
    setDraft((d) => ({ ...d, base: src.base, colors: { ...src.colors }, shape: { ...src.shape } }));
    setQuick({ background: src.colors.background, accent: src.colors.accent, bubbleOwn: src.colors.bubbleOwn });
  };
  const setStyle = (style: ThemeShape["style"]) => setDraft((d) => ({ ...d, shape: { ...SHAPE_PRESETS[style] } }));

  const startTry = () => { tryTheme(draft, pathname); navigate("/chat"); };
  const stopTry = () => tryTheme(null);

  const save = async () => {
    if (!draft.name.trim()) { toast.error(tr("Придумайте название темы")); return; }
    setBusy(true);
    try {
      const saved = normalizeTheme(await api.saveTheme({
        id: isNew ? undefined : id,
        name: draft.name.trim(), base: draft.base, colors: draft.colors, shape: draft.shape, is_public: isPublic,
      }));
      setInstalledThemes([saved, ...installed.filter((t) => t.id !== saved.id)]);
      // Сначала сохранённая (под примеркой она не перерисовывает), затем снять
      // примерку — один переход вместо двух наложенных.
      setTheme(saved);
      tryTheme(null);
      toast.success(isNew ? tr("Тема создана и включена") : tr("Тема сохранена"));
      navigate("/profile/appearance", { replace: true });
    } catch (e: any) {
      toast.error(e?.message || tr("Не удалось сохранить"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="h-screen flex flex-col bg-background">
      <ScreenHeader
        title={isNew ? tr("Новая тема") : tr("Тема")}
        right={
          <button type="button" onClick={save} disabled={busy} className="px-3 h-10 text-body font-semibold text-primary disabled:opacity-50">
            {busy ? "…" : tr("Готово")}
          </button>
        }
      />

      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-3">
        {preview && <ThemeShowcase theme={draft} />}
        <div className="flex gap-2">
          <button type="button" onClick={() => setPreview((v) => !v)} className="flex-1 h-10 rounded-md bg-surface-4 text-small font-medium inline-flex items-center justify-center gap-1.5">
            {preview ? <><EyeOff className="w-4 h-4" /> {tr("Скрыть")}</> : <><Eye className="w-4 h-4" /> {tr("Предпросмотр")}</>}
          </button>
          {trying ? (
            <button type="button" onClick={stopTry} className="flex-[2] h-10 rounded-md bg-surface-4 text-small font-semibold inline-flex items-center justify-center gap-1.5">
              <Undo2 className="w-4 h-4" /> {tr("Снять примерку")}
            </button>
          ) : (
            <button type="button" onClick={startTry} className="flex-[2] h-10 rounded-md bg-primary text-primary-foreground text-small font-semibold inline-flex items-center justify-center gap-1.5">
              <Shirt className="w-4 h-4" /> {tr("Примерить на приложение")}
            </button>
          )}
        </div>
        {trying && <p className="px-1 text-caption text-subtle">{tr("Тема примерена на всё приложение — походите по экранам. Сохранится только по «Готово».")}</p>}

        {issues.length > 0 && (
          <div className="rounded-lg bg-surface-2 border border-border p-3 space-y-1">
            <p className="text-small font-medium flex items-center gap-2"><AlertTriangle className="w-4 h-4 text-amber" /> {tr("Плохо читается")}</p>
            {issues.map((i) => (
              <p key={i.pair} className="text-caption text-subtle">{tr(i.fatal ? "{pair}: контраст {ratio} — почти не видно" : "{pair}: контраст {ratio}", { pair: tr(i.pair), ratio: i.ratio })}</p>
            ))}
          </div>
        )}

        <SettingsCard>
          <label className="px-4 py-2.5 flex items-center gap-3">
            <span className="text-body shrink-0">{tr("Название")}</span>
            <input value={draft.name} onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value.slice(0, 40) }))} placeholder={tr("Моя тема")}
              className="flex-1 min-w-0 h-9 px-2.5 rounded-md bg-surface-3 border border-border text-body outline-none focus:border-amber" />
          </label>
          <Toggle label={tr("Открыть по ссылке")} hint={tr("Выключено — тему видите только вы")} checked={isPublic} onChange={setIsPublic} />
        </SettingsCard>

        <SettingsTitle>{tr("Основа")}</SettingsTitle>
        <div className="flex gap-2 overflow-x-auto pb-1 -mx-4 px-4">
          {THEME_BASES.map((b) => (
            <button key={b.id} type="button" onClick={() => fromBase(b)} className="w-[76px] shrink-0 flex flex-col items-center gap-1.5 active:opacity-80">
              <BaseSwatch theme={b} />
              <span className="text-caption text-center leading-tight">{tr(b.name)}</span>
            </button>
          ))}
        </div>

        <SettingsTitle>{tr("Стиль")}</SettingsTitle>
        <div className="grid grid-cols-2 gap-2">
          {STYLES.map(([s, label, hint]) => {
            const on = draft.shape.style === s;
            return (
              <button key={s} type="button" onClick={() => setStyle(s)} aria-pressed={on}
                className={cn("text-left rounded-lg p-3 bg-surface-1 border-2 active:opacity-80", on ? "border-primary" : "border-transparent")}>
                <span className="flex items-center gap-1.5 text-body font-semibold">{on && <Check className="w-4 h-4 text-primary" />}{tr(label)}</span>
                <span className="block text-caption text-subtle mt-0.5">{tr(hint)}</span>
              </button>
            );
          })}
        </div>

        <SettingsTitle>{tr("Цвета")}</SettingsTitle>
        <div className="flex rounded-md bg-surface-2 p-0.5">
          {([["quick", "Быстро"], ["all", "Все цвета"]] as const).map(([m, label]) => (
            <button key={m} type="button" onClick={() => setMode(m)} aria-pressed={mode === m}
              className={cn("flex-1 h-9 rounded text-small font-medium", mode === m ? "bg-primary text-primary-foreground" : "text-subtle")}>
              {tr(label)}
            </button>
          ))}
        </div>
        {mode === "quick" ? (
          <>
            <SettingsCard>
              <Toggle label={tr("Тёмная тема")} hint={tr("Светлый текст на тёмном фоне, светлые значки статус-бара")} checked={draft.base === "dark"}
                onChange={(v) => setQuickColor({}, v ? "dark" : "light")} />
              <ColorRow label={tr("Фон")} value={quick.background} onChange={(v) => setQuickColor({ background: v })} />
              <ColorRow label={tr("Акцент")} value={quick.accent} onChange={(v) => setQuickColor({ accent: v })} />
              <ColorRow label={tr("Свои сообщения")} value={quick.bubbleOwn} onChange={(v) => setQuickColor({ bubbleOwn: v })} />
            </SettingsCard>
            <p className="px-1 text-caption text-subtle">{tr("Остальные цвета подбираются сами — с читаемым текстом. Тонко поправить можно в «Все цвета».")}</p>
          </>
        ) : (
          <>
            <SettingsCard>
              <Toggle label={tr("Тёмная основа")} hint={tr("Светлые значки статус-бара и системных панелей")} checked={draft.base === "dark"}
                onChange={(v) => setDraft((d) => ({ ...d, base: v ? "dark" : "light" }))} />
            </SettingsCard>
            {ALL_GROUPS.map((g) => (
              <div key={g.title} className="space-y-2">
                <SettingsTitle>{tr(g.title)}</SettingsTitle>
                <SettingsCard>
                  {g.items.map(([key, label]) => <ColorRow key={key} label={tr(label)} value={draft.colors[key]} onChange={(v) => setColor(key, v)} />)}
                </SettingsCard>
              </div>
            ))}
          </>
        )}

        <SettingsTitle>{tr("Форма")}</SettingsTitle>
        <SettingsCard>
          <Slider label={tr("Скругление карточек")} value={draft.shape.radius} min={SHAPE_LIMITS.radius[0]} max={SHAPE_LIMITS.radius[1]} onChange={(radius) => setShape({ radius })} />
          <Slider label={tr("Скругление полей")} value={draft.shape.radiusField} min={SHAPE_LIMITS.radiusField[0]} max={SHAPE_LIMITS.radiusField[1]} onChange={(radiusField) => setShape({ radiusField })} />
          {draft.shape.style === "outlined" && (
            <>
              <Slider label={tr("Толщина обводки")} value={draft.shape.borderWidth} min={SHAPE_LIMITS.borderWidth[0]} max={SHAPE_LIMITS.borderWidth[1]} onChange={(borderWidth) => setShape({ borderWidth })} />
              <Slider label={tr("Сдвиг тени")} value={draft.shape.shadowOffset} min={SHAPE_LIMITS.shadowOffset[0]} max={SHAPE_LIMITS.shadowOffset[1]} onChange={(shadowOffset) => setShape({ shadowOffset })} />
            </>
          )}
          <Slider label={tr("Толщина иконок")} value={draft.shape.iconStroke} min={SHAPE_LIMITS.iconStroke[0]} max={SHAPE_LIMITS.iconStroke[1]} step={0.5} unit="" onChange={(iconStroke) => setShape({ iconStroke })} />
          {draft.shape.style !== "soft" && (
            <>
              <Toggle label={tr("Чаты карточками")} hint={tr("Каждая строка списка — отдельная карточка")} checked={draft.shape.rowCards} onChange={(rowCards) => setShape({ rowCards })} />
              <Toggle label={tr("Плавающая панель снизу")} hint={tr("С подписями под значками")} checked={draft.shape.floatingNav} onChange={(floatingNav) => setShape({ floatingNav })} />
            </>
          )}
        </SettingsCard>

        <p className="px-1 pb-2 text-caption text-subtle">
          {tr("Тема — это только цвета и параметры формы. Сервер проверяет их перед сохранением, поэтому чужая тема не может сломать приложение.")}
        </p>
      </div>
    </div>
  );
};

export default ThemeEditor;
