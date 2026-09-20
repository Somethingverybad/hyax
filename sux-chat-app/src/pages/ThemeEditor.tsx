import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { toast } from "sonner";
import { AlertTriangle, Eye, EyeOff, Shuffle } from "lucide-react";
import ScreenHeader from "@/components/ScreenHeader";
import { SettingsCard } from "@/components/settings";
import ThemePreview from "@/components/ThemePreview";
import { api } from "@/api/client";
import { setInstalledThemes, setTheme, useInstalledThemes, useTheme } from "@/lib/theme";
import { DARK, LIGHT, NEO } from "@/themes/builtin";
import { contrastIssues, normalizeTheme } from "@/themes/engine";
import { SHAPE_LIMITS, type ColorKey, type ThemeDef } from "@/themes/types";

/** Цвета, сгруппированные по смыслу: показываем не все 29 подряд. */
const GROUPS: { title: string; items: { key: ColorKey; label: string }[] }[] = [
  { title: "Основные", items: [
    { key: "background", label: "Фон экрана" },
    { key: "foreground", label: "Текст" },
    { key: "surface1", label: "Карточки" },
    { key: "surface3", label: "Нажатая строка" },
    { key: "surface4", label: "Вторичные кнопки" },
    { key: "mutedForeground", label: "Второстепенный текст" },
    { key: "border", label: "Линии и обводка" },
  ] },
  { title: "Акценты", items: [
    { key: "primary", label: "Акцент" },
    { key: "primaryForeground", label: "Текст на акценте" },
    { key: "accentSoft", label: "Мягкий акцент" },
    { key: "destructive", label: "Опасное действие" },
    { key: "destructiveForeground", label: "Текст на красном" },
    { key: "online", label: "«В сети»" },
    { key: "amber", label: "Янтарный" },
  ] },
  { title: "Сообщения", items: [
    { key: "bubbleOwn", label: "Свои" },
    { key: "bubbleOwnFg", label: "Текст своих" },
    { key: "bubbleIn", label: "Входящие" },
    { key: "bubbleInFg", label: "Текст входящих" },
    { key: "chatCanvas", label: "Фон переписки" },
  ] },
];

/** Ключи, которые в редакторе не показываем: их выводим из показанных, чтобы
 *  не заставлять человека настраивать 29 цветов ради одной темы. */
const derive = (c: Record<ColorKey, string>): Record<ColorKey, string> => ({
  ...c,
  surface2: c.surface1,
  subtleForeground: c.mutedForeground,
  primaryDeep: c.bubbleOwn,
  accent: c.accentSoft,
  accentForeground: c.foreground,
  success: c.bubbleIn,
  successForeground: c.bubbleInFg,
  divider: c.border,
  ring: c.primary,
  ink: c.border,
});

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

/**
 * Редактор темы. Сверху живой предпросмотр (те же классы, что на настоящих
 * экранах), ниже цвета и форма. Произвольный CSS ввести нельзя: только
 * значения из схемы, их же проверяет сервер.
 */
const ThemeEditor = () => {
  const { id = "new" } = useParams();
  const navigate = useNavigate();
  const installed = useInstalledThemes();
  const active = useTheme();
  const isNew = id === "new";

  const [draft, setDraft] = useState<ThemeDef>(() => {
    const base = installed.find((t) => t.id === id);
    if (base) return base;
    // Новая тема начинается с текущей: так её правят, а не собирают с нуля.
    return normalizeTheme({ ...active, id: "new", name: "", builtin: false, mine: true });
  });
  const [busy, setBusy] = useState(false);
  const [isPublic, setIsPublic] = useState(true);
  const [preview, setPreview] = useState(true);

  useEffect(() => {
    if (isNew) return;
    const found = installed.find((t) => t.id === id);
    if (found) setDraft(found);
  }, [id, installed, isNew]);

  const theme = useMemo(() => ({ ...draft, colors: derive(draft.colors) }), [draft]);
  const issues = useMemo(() => contrastIssues(theme.colors), [theme]);
  const blocking = issues.some((i) => i.fatal);

  const setColor = (key: ColorKey, value: string) => setDraft((d) => ({ ...d, colors: { ...d.colors, [key]: value.toUpperCase() } }));
  const setShape = (patch: Partial<ThemeDef["shape"]>) => setDraft((d) => ({ ...d, shape: { ...d.shape, ...patch } }));

  const fromBuiltin = (src: ThemeDef) => setDraft((d) => ({ ...d, base: src.base, colors: { ...src.colors }, shape: { ...src.shape } }));

  const save = async () => {
    if (!draft.name.trim()) { toast.error("Придумайте название темы"); return; }
    if (blocking) { toast.error("Слишком низкий контраст — текст не читается"); return; }
    setBusy(true);
    try {
      const saved = normalizeTheme(await api.saveTheme({
        id: isNew ? undefined : id,
        name: draft.name.trim(), base: draft.base, colors: theme.colors, shape: draft.shape, is_public: isPublic,
      }));
      setInstalledThemes([saved, ...installed.filter((t) => t.id !== saved.id)]);
      setTheme(saved);
      toast.success(isNew ? "Тема создана и включена" : "Тема сохранена");
      navigate("/profile/appearance", { replace: true });
    } catch (e: any) {
      toast.error(e?.message || "Не удалось сохранить");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="h-screen flex flex-col bg-background">
      <ScreenHeader
        title={isNew ? "Новая тема" : "Тема"}
        right={
          <button type="button" onClick={save} disabled={busy} className="px-3 h-10 text-body font-semibold text-primary disabled:opacity-50" >
            {busy ? "…" : "Готово"}
          </button>
        }
      />

      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-3">
        {preview && <ThemePreview theme={theme} />}
        <button type="button" onClick={() => setPreview((v) => !v)} className="w-full h-9 rounded-md bg-surface-4 text-small font-medium inline-flex items-center justify-center gap-1.5">
          {preview ? <><EyeOff className="w-4 h-4" /> Скрыть предпросмотр</> : <><Eye className="w-4 h-4" /> Показать предпросмотр</>}
        </button>

        {issues.length > 0 && (
          <div className="rounded-lg bg-surface-2 border border-border p-3 space-y-1">
            <p className="text-small font-medium flex items-center gap-2"><AlertTriangle className="w-4 h-4 text-amber" /> Плохо читается</p>
            {issues.map((i) => (
              <p key={i.pair} className="text-caption text-subtle">{i.pair}: контраст {i.ratio}{i.fatal ? " — так сохранить нельзя" : ""}</p>
            ))}
          </div>
        )}

        <SettingsCard>
          <label className="px-4 py-2.5 flex items-center gap-3">
            <span className="text-body shrink-0">Название</span>
            <input
              value={draft.name}
              onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value.slice(0, 40) }))}
              placeholder="Моя тема"
              className="flex-1 min-w-0 h-9 px-2.5 rounded-md bg-surface-3 border border-border text-body outline-none focus:border-amber"
            />
          </label>
          <Toggle label="Тёмная основа" hint="Светлые значки статус-бара и системных панелей" checked={draft.base === "dark"} onChange={(v) => setDraft((d) => ({ ...d, base: v ? "dark" : "light" }))} />
          <Toggle label="Открыть по ссылке" hint="Выключено — тему видите только вы" checked={isPublic} onChange={setIsPublic} />
        </SettingsCard>

        <p className="px-1 pt-1 text-small text-subtle flex items-center gap-2"><Shuffle className="w-4 h-4" /> Взять за основу</p>
        <div className="flex gap-2">
          {[LIGHT, DARK, NEO].map((t) => (
            <button key={t.id} type="button" onClick={() => fromBuiltin(t)} className="flex-1 h-10 rounded-md bg-surface-4 text-small font-medium active:opacity-80">{t.name}</button>
          ))}
        </div>

        {GROUPS.map((g) => (
          <div key={g.title} className="space-y-2">
            <p className="px-1 pt-2 text-small text-subtle">{g.title}</p>
            <SettingsCard>
              {g.items.map(({ key, label }) => (
                <label key={key} className="px-4 py-2.5 flex items-center gap-3">
                  <span className="min-w-0 flex-1 text-body">{label}</span>
                  <span className="text-caption text-subtle tabular-nums">{draft.colors[key]}</span>
                  <input
                    type="color"
                    value={draft.colors[key]}
                    onChange={(e) => setColor(key, e.target.value)}
                    className="w-10 h-8 rounded-md bg-transparent border border-border shrink-0"
                    aria-label={label}
                  />
                </label>
              ))}
            </SettingsCard>
          </div>
        ))}

        <p className="px-1 pt-2 text-small text-subtle">Форма</p>
        <SettingsCard>
          <Toggle label="Обводки и жёсткие тени" hint="Необрутализм: линии тушью, тень без размытия" checked={draft.shape.style === "outlined"} onChange={(v) => setShape({ style: v ? "outlined" : "flat" })} />
          <Slider label="Скругление карточек" value={draft.shape.radius} min={SHAPE_LIMITS.radius[0]} max={SHAPE_LIMITS.radius[1]} onChange={(radius) => setShape({ radius })} />
          <Slider label="Скругление полей" value={draft.shape.radiusField} min={SHAPE_LIMITS.radiusField[0]} max={SHAPE_LIMITS.radiusField[1]} onChange={(radiusField) => setShape({ radiusField })} />
          {draft.shape.style === "outlined" && (
            <>
              <Slider label="Толщина обводки" value={draft.shape.borderWidth} min={SHAPE_LIMITS.borderWidth[0]} max={SHAPE_LIMITS.borderWidth[1]} onChange={(borderWidth) => setShape({ borderWidth })} />
              <Slider label="Сдвиг тени" value={draft.shape.shadowOffset} min={SHAPE_LIMITS.shadowOffset[0]} max={SHAPE_LIMITS.shadowOffset[1]} onChange={(shadowOffset) => setShape({ shadowOffset })} />
            </>
          )}
          <Slider label="Толщина иконок" value={draft.shape.iconStroke} min={SHAPE_LIMITS.iconStroke[0]} max={SHAPE_LIMITS.iconStroke[1]} step={0.5} unit="" onChange={(iconStroke) => setShape({ iconStroke })} />
          <Toggle label="Чаты карточками" hint="Каждая строка списка — отдельная карточка" checked={draft.shape.rowCards} onChange={(rowCards) => setShape({ rowCards })} />
          <Toggle label="Плавающая панель снизу" hint="С подписями под значками" checked={draft.shape.floatingNav} onChange={(floatingNav) => setShape({ floatingNav })} />
        </SettingsCard>

        <p className="px-1 pb-2 text-caption text-subtle">
          Тема — это только цвета и параметры формы. Сервер проверяет их перед сохранением, поэтому чужая тема не может сломать приложение.
        </p>
      </div>
    </div>
  );
};

export default ThemeEditor;
