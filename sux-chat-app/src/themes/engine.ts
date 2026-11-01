import { COLOR_KEYS, EXTRA_KEYS, SHAPE_LIMITS, type ColorKey, type ThemeColors, type ThemeDef, type ThemeShape } from "./types";
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
  triRim: ["--tri-rim"], pet: ["--pet"],
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
  const extra = new Set<ColorKey>(EXTRA_KEYS);
  for (const k of COLOR_KEYS) {
    const v = raw?.colors?.[k];
    if (typeof v === "string" && /^#[0-9a-f]{6}$/i.test(v)) colors[k] = v.toUpperCase();
    else if (!extra.has(k)) colors[k] = fallback.colors[k];
  }
  // Новых цветов в старой теме нет — от её же цветов, а не от темы-основы:
  // иначе у любой своей темы рамка и питомец остались бы мятными.
  const derived = extrasFrom(colors);
  for (const k of EXTRA_KEYS) colors[k] ??= derived[k];
  const s = raw?.shape ?? {}, f = fallback.shape;
  const shape: ThemeShape = {
    // Раскладка у всех тем одна — «мягкие карточки» «Мяты»; своя тема меняет цвета.
    style: "soft",
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
  // Рамка треугольников — градиент от цвета рамки к его тёмному тону.
  v["--tri-rim-mid"] = hexToTriplet(mixHex(t.colors.triRim, "#000000", 0.22));
  v["--tri-rim-deep"] = hexToTriplet(mixHex(t.colors.triRim, "#000000", 0.62));
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

// ---------- быстрая палитра (редактор, режим «Быстро») ----------
const rgbOf = (hex: string): [number, number, number] => {
  const n = parseInt(hex.replace("#", ""), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};
const hexOf = ([r, g, b]: number[]) => "#" + [r, g, b].map((v) => Math.round(Math.min(255, Math.max(0, v))).toString(16).padStart(2, "0")).join("").toUpperCase();
/** Смесь двух цветов: t = 0 — первый, 1 — второй. */
export function mixHex(a: string, b: string, t: number): string {
  const x = rgbOf(a), y = rgbOf(b);
  return hexOf(x.map((v, i) => v + (y[i] - v) * t));
}
/** Текст на подложке: светлый или тёмный. На насыщенных цветах привычнее
 *  белый — он, если его контраст не ниже prefer (3,5 для кнопок, 4,5 для
 *  текста сообщений), иначе что контрастнее. */
export function readableOn(bg: string, light = "#FFFFFF", dark = "#1C1C1C", prefer = 3.5): string {
  const l = contrast(light, bg);
  return l >= prefer || l >= contrast(dark, bg) ? light : dark;
}
/** Сдвигать цвет к цели, пока контраст с фоном не дорастёт до min. */
function untilContrast(c: string, bg: string, toward: string, min: number): string {
  let out = c;
  for (let i = 1; i <= 10 && contrast(out, bg) < min; i++) out = mixHex(c, toward, i / 10);
  return out;
}

/** Рамка треугольников — акцент; питомец (шкала и «Счастлив») — основной цвет,
 *  дотянутый до читаемости на карточке. */
export function extrasFrom(c: Omit<ThemeColors, (typeof EXTRA_KEYS)[number]>): Pick<ThemeColors, (typeof EXTRA_KEYS)[number]> {
  return { triRim: c.accent, pet: untilContrast(c.primary, c.surface1, c.foreground, 3) };
}

/**
 * Все 31 цвет из трёх: фон, акцент и свои сообщения. Остальное — смеси с
 * понятными ролями (карточки чуть светлее фона, линии — фон с каплей текста,
 * мягкий акцент — фон с акцентом), а текст на подложках — по контрасту.
 */
export function paletteFrom(o: { base: "light" | "dark"; background: string; accent: string; bubbleOwn: string }): ThemeColors {
  const c = paletteBase(o);
  return { ...c, ...extrasFrom(c) };
}
function paletteBase(o: { base: "light" | "dark"; background: string; accent: string; bubbleOwn: string }): Omit<ThemeColors, (typeof EXTRA_KEYS)[number]> {
  const light = o.base === "light";
  const bg = o.background, a = o.accent;
  const fg = light ? untilContrast(mixHex(a, "#000000", 0.8), bg, "#000000", 7) : untilContrast(mixHex(bg, "#FFFFFF", 0.94), bg, "#FFFFFF", 7);
  const surface1 = light ? mixHex(bg, "#FFFFFF", 0.7) : mixHex(bg, "#FFFFFF", 0.06);
  // Основной цвет — сам акцент, если он читается на фоне, иначе — темнее (светлая) или светлее (тёмная).
  const primary = untilContrast(a, bg, light ? fg : "#FFFFFF", 3);
  // Входящие — между своими и фоном; попали в тон, где ни белый, ни тёмный
  // текст не читается, — ближе к фону, пока не станет читаемо.
  let bubbleIn = mixHex(o.bubbleOwn, bg, light ? 0.5 : 0.45);
  for (let t = 0.55; t <= 1 && contrast(readableOn(bubbleIn, "#FFFFFF", "#1C1C1C", 4.5), bubbleIn) < 4.5; t += 0.05) bubbleIn = mixHex(o.bubbleOwn, bg, t);
  return {
    background: bg,
    foreground: fg,
    surface1,
    surface2: light ? surface1 : mixHex(bg, "#FFFFFF", 0.09),
    surface3: mixHex(bg, a, light ? 0.08 : 0.12),
    surface4: mixHex(bg, a, light ? 0.16 : 0.2),
    mutedForeground: mixHex(fg, bg, 0.42),
    subtleForeground: mixHex(fg, bg, 0.52),
    primary,
    primaryForeground: readableOn(primary),
    primaryDeep: mixHex(primary, "#000000", 0.2),
    accent: a,
    accentForeground: readableOn(a, "#FFFFFF", light ? fg : mixHex(a, "#000000", 0.75)),
    destructive: light ? "#D64545" : "#FF6B5E",
    destructiveForeground: readableOn(light ? "#D64545" : "#FF6B5E"),
    success: light ? "#3E8E41" : "#6FCF7B",
    successForeground: readableOn(light ? "#3E8E41" : "#6FCF7B"),
    online: light ? "#4FAE2A" : "#7BD35A",
    amber: light ? "#E9A100" : "#FFB10A",
    border: mixHex(bg, fg, light ? 0.1 : 0.16),
    divider: mixHex(bg, fg, light ? 0.07 : 0.11),
    ring: primary,
    ink: fg,
    accentSoft: mixHex(bg, a, light ? 0.22 : 0.18),
    bubbleOwn: o.bubbleOwn,
    bubbleOwnFg: readableOn(o.bubbleOwn, "#FFFFFF", "#1C1C1C", 4.5),
    bubbleIn,
    bubbleInFg: readableOn(bubbleIn, "#FFFFFF", "#1C1C1C", 4.5),
    chatCanvas: light ? mixHex(mixHex(bg, "#000000", 0.04), a, 0.06) : mixHex(bg, "#000000", 0.18),
  };
}

/** Проблемы читаемости: пары «текст на фоне» с контрастом ниже порога.
 *  Только предупреждение в редакторе — сохранить можно любую тему. */
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
