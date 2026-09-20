import { COLOR_KEYS, SHAPE_LIMITS, type ColorKey, type ThemeColors, type ThemeDef, type ThemeShape } from "./types";
import { DEFAULT_THEME } from "./builtin";

/** #RRGGBB → «H S% L%» — в таком виде цвета ждёт Tailwind: hsl(var(--x)). */
export function hexToTriplet(hex: string): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return "0 0% 50%";
  const n = parseInt(m[1], 16);
  const r = ((n >> 16) & 255) / 255, g = ((n >> 8) & 255) / 255, b = (n & 255) / 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b), l = (max + min) / 2;
  let h = 0, s = 0;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
    h /= 6;
  }
  const r1 = (x: number) => Math.round(x * 10) / 10;
  return `${r1(h * 360)} ${r1(s * 100)}% ${r1(l * 100)}%`;
}

/** Контраст по WCAG между двумя hex-цветами (1…21). */
export function contrast(a: string, b: string): number {
  const lum = (hex: string) => {
    const n = parseInt(hex.replace("#", ""), 16);
    const ch = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => {
      const x = v / 255;
      return x <= 0.03928 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4);
    });
    return 0.2126 * ch[0] + 0.7152 * ch[1] + 0.0722 * ch[2];
  };
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

/** Имена CSS-переменных для цветов темы. */
const VAR: Record<ColorKey, string[]> = {
  background: ["--background"],
  foreground: ["--foreground", "--card-foreground", "--popover-foreground", "--secondary-foreground"],
  surface1: ["--surface-1"], surface2: ["--surface-2"], surface3: ["--surface-3"], surface4: ["--surface-4"],
  mutedForeground: ["--muted-foreground"], subtleForeground: ["--subtle-foreground"],
  primary: ["--primary"], primaryForeground: ["--primary-foreground"], primaryDeep: ["--primary-deep"],
  accent: ["--accent"], accentForeground: ["--accent-foreground"],
  destructive: ["--destructive"], destructiveForeground: ["--destructive-foreground"],
  success: ["--success"], successForeground: ["--success-foreground"],
  online: ["--online"], amber: ["--amber"],
  border: ["--border", "--input"], divider: ["--ui-divider"], ring: ["--ring"], ink: ["--ink"], accentSoft: ["--accent-soft"],
  bubbleOwn: ["--bubble-own"], bubbleOwnFg: ["--bubble-own-fg"], bubbleIn: ["--bubble-in"], bubbleInFg: ["--bubble-in-fg"],
  chatCanvas: ["--chat-canvas"],
};

const clamp = (v: unknown, [lo, hi]: readonly [number, number], fallback: number) => {
  const n = typeof v === "number" && isFinite(v) ? v : fallback;
  return Math.min(hi, Math.max(lo, n));
};

/** Привести произвольный объект к корректной теме: лишнее отбросить,
 *  недостающее взять из темы-основы, числа зажать в пределы. Тема из кеша или
 *  с сервера проходит через это перед применением — на экран не попадёт ни
 *  строка мимо hex, ни радиус в тысячу пикселей. */
export function normalizeTheme(raw: any, fallback: ThemeDef = DEFAULT_THEME): ThemeDef {
  const colors = {} as ThemeColors;
  for (const k of COLOR_KEYS) {
    const v = raw?.colors?.[k];
    colors[k] = typeof v === "string" && /^#[0-9a-f]{6}$/i.test(v) ? v.toUpperCase() : fallback.colors[k];
  }
  const s = raw?.shape ?? {}, f = fallback.shape;
  const shape: ThemeShape = {
    style: s.style === "outlined" || s.style === "flat" ? s.style : f.style,
    radius: clamp(s.radius, SHAPE_LIMITS.radius, f.radius),
    radiusField: clamp(s.radiusField, SHAPE_LIMITS.radiusField, f.radiusField),
    borderWidth: clamp(s.borderWidth, SHAPE_LIMITS.borderWidth, f.borderWidth),
    shadowOffset: clamp(s.shadowOffset, SHAPE_LIMITS.shadowOffset, f.shadowOffset),
    iconStroke: clamp(s.iconStroke, SHAPE_LIMITS.iconStroke, f.iconStroke),
    rowCards: typeof s.rowCards === "boolean" ? s.rowCards : f.rowCards,
    floatingNav: typeof s.floatingNav === "boolean" ? s.floatingNav : f.floatingNav,
  };
  return {
    id: typeof raw?.id === "string" && raw.id ? raw.id : fallback.id,
    name: typeof raw?.name === "string" && raw.name.trim() ? raw.name.trim().slice(0, 40) : fallback.name,
    base: raw?.base === "light" || raw?.base === "dark" ? raw.base : fallback.base,
    colors, shape,
    author: typeof raw?.author === "string" ? raw.author : null,
    mine: !!raw?.mine, installed: !!raw?.installed, builtin: !!raw?.builtin,
    installs: typeof raw?.installs === "number" ? raw.installs : undefined,
  };
}

/** CSS-переменные темы. Их читает весь интерфейс — и корень документа, и
 *  окно предпросмотра в редакторе (обёртка с теми же переменными). */
export function themeVars(t: ThemeDef): Record<string, string> {
  const v: Record<string, string> = {};
  for (const k of COLOR_KEYS) for (const name of VAR[k]) v[name] = hexToTriplet(t.colors[k]);
  const p = v["--primary"], s1 = v["--surface-1"], ink = v["--ink"];
  v["--gradient-primary"] = `linear-gradient(0deg, hsl(${p}), hsl(${p}))`;
  v["--gradient-card"] = `linear-gradient(0deg, hsl(${s1}), hsl(${s1}))`;
  v["--radius"] = `${t.shape.radius}px`;
  v["--radius-field"] = `${t.shape.radiusField}px`;
  v["--ui-icon-stroke"] = String(t.shape.iconStroke);
  const outlined = t.shape.style === "outlined";
  const off = outlined ? t.shape.shadowOffset : 0;
  v["--ui-bw"] = `${outlined ? t.shape.borderWidth : 1}px`;
  v["--ui-line"] = outlined ? ink : v["--border"];
  v["--ui-shadow"] = off ? `${off}px ${off}px 0 0 hsl(${ink})` : "none";
  v["--ui-shadow-sm"] = off ? `${Math.max(1, off - 1)}px ${Math.max(1, off - 1)}px 0 0 hsl(${ink})` : "none";
  v["--ui-shadow-focus"] = off ? `${off}px ${off}px 0 0 hsl(${p})` : "none";
  v["--ui-press"] = `${off ? Math.max(1, off - 1) : 0}px`;
  v["--shadow-card"] = off ? `${off + 1}px ${off + 1}px 0 0 hsl(${ink})` : "none";
  return v;
}

/** Атрибуты, по которым index.css включает блоки формы. */
export function themeAttrs(t: ThemeDef): Record<string, string> {
  return {
    "data-theme": t.builtin ? t.id : "custom",
    "data-base": t.base,
    "data-shape": t.shape.style,
    "data-rows": t.shape.rowCards ? "cards" : "list",
    "data-nav": t.shape.floatingNav ? "floating" : "bar",
  };
}

/** Применить тему к элементу (корню документа или обёртке предпросмотра). */
export function paintTheme(el: HTMLElement, t: ThemeDef) {
  for (const [k, val] of Object.entries(themeVars(t))) el.style.setProperty(k, val);
  for (const [k, val] of Object.entries(themeAttrs(t))) el.setAttribute(k, val);
}

/** Проблемы читаемости: пары «текст на фоне» с контрастом ниже порога.
 *  Сохранить тему с нечитаемым основным текстом нельзя (см. редактор). */
export function contrastIssues(c: ThemeColors): { pair: string; ratio: number; fatal: boolean }[] {
  const pairs: [string, string, string, number][] = [
    ["Текст на фоне", c.foreground, c.background, 4.5],
    ["Текст на карточке", c.foreground, c.surface1, 4.5],
    ["Вторичный текст на карточке", c.mutedForeground, c.surface1, 3],
    ["Текст на акцентной кнопке", c.primaryForeground, c.primary, 3],
    ["Текст на красной кнопке", c.destructiveForeground, c.destructive, 3],
    ["Свои сообщения", c.bubbleOwnFg, c.bubbleOwn, 4.5],
    ["Входящие сообщения", c.bubbleInFg, c.bubbleIn, 4.5],
  ];
  return pairs
    .map(([pair, fg, bg, min]) => ({ pair, ratio: contrast(fg, bg), min }))
    .filter((x) => x.ratio < x.min)
    .map((x) => ({ pair: x.pair, ratio: Math.round(x.ratio * 10) / 10, fatal: x.ratio < 2 }));
}
