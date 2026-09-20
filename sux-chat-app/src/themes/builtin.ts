import type { ThemeDef } from "./types";

/**
 * Встроенные темы — такие же данные, как темы пользователей. Новая встроенная
 * тема — это ещё один объект в этом файле; CSS и остальной код не меняются.
 *
 * Тёмная продублирована токенами по умолчанию в index.css (:root): они работают
 * до запуска JS и как запасной вариант, если тема не применилась.
 */
const FLAT = { style: "flat", radius: 12, radiusField: 10, borderWidth: 1, shadowOffset: 0, iconStroke: 1.5, rowCards: false, floatingNav: false } as const;

export const DARK: ThemeDef = {
  id: "dark", name: "Тёмная", base: "dark", builtin: true,
  colors: {
    background: "#0F0F10",
    foreground: "#FFFFFF",
    surface1: "#161617",
    surface2: "#1A1A1B",
    surface3: "#1D1D1E",
    surface4: "#292929",
    mutedForeground: "#BEC0C1",
    subtleForeground: "#8A8A8A",
    primary: "#D12B1F",
    primaryForeground: "#FFFFFF",
    primaryDeep: "#9E1E1A",
    accent: "#D12B1F",
    accentForeground: "#FFFFFF",
    destructive: "#D12B1F",
    destructiveForeground: "#FFFFFF",
    success: "#287742",
    successForeground: "#FFFFFF",
    online: "#3EB14A",
    amber: "#FFB10A",
    border: "#252527",
    ring: "#FFB10A",
    bubbleOwn: "#9E1E1A",
    bubbleOwnFg: "#FFFFFF",
    bubbleIn: "#287742",
    bubbleInFg: "#FFFFFF",
    chatCanvas: "#0C0C0C",
    ink: "#FFFFFF",
    accentSoft: "#1D1D1E",
    divider: "#252527",
  },
  shape: { ...FLAT },
};

export const LIGHT: ThemeDef = {
  id: "light", name: "Светлая", base: "light", builtin: true,
  colors: {
    background: "#F8FAFC",
    foreground: "#111827",
    surface1: "#FFFFFF",
    surface2: "#FFFFFF",
    surface3: "#F3F4F6",
    surface4: "#E5E7EB",
    mutedForeground: "#6B7280",
    subtleForeground: "#828997",
    primary: "#EF4343",
    primaryForeground: "#FFFFFF",
    primaryDeep: "#DC2828",
    accent: "#EF4343",
    accentForeground: "#FFFFFF",
    destructive: "#EF4343",
    destructiveForeground: "#FFFFFF",
    success: "#189044",
    successForeground: "#FFFFFF",
    online: "#21C45D",
    amber: "#F59F0A",
    border: "#E5E7EB",
    ring: "#F59F0A",
    bubbleOwn: "#DC2828",
    bubbleOwnFg: "#FFFFFF",
    bubbleIn: "#189044",
    bubbleInFg: "#FFFFFF",
    chatCanvas: "#F3F4F6",
    ink: "#111827",
    accentSoft: "#F3F4F6",
    divider: "#E5E7EB",
  },
  shape: { ...FLAT },
};

/** «Необрутализм» — по стайлгайду ChatApp: кремовый фон, обводки тушью,
 *  жёсткие тени, зелёный акцент, пастельные заливки. */
export const NEO: ThemeDef = {
  id: "neo", name: "Необрутализм", base: "light", builtin: true,
  colors: {
    background: "#F5F5EB",
    foreground: "#121212",
    surface1: "#FFFFFF",
    surface2: "#FFFFFF",
    surface3: "#FFF0C2",
    surface4: "#E3D6FF",
    mutedForeground: "#4C4C4C",
    subtleForeground: "#6B6B6B",
    primary: "#21C45D",
    primaryForeground: "#121212",
    primaryDeep: "#21C45D",
    accent: "#D9C7FF",
    accentForeground: "#121212",
    destructive: "#EF4343",
    destructiveForeground: "#121212",
    success: "#137638",
    successForeground: "#FFFFFF",
    online: "#21C45D",
    amber: "#FFAE00",
    border: "#121212",
    ring: "#21C45D",
    bubbleOwn: "#21C45D",
    bubbleOwnFg: "#121212",
    bubbleIn: "#FFFFFF",
    bubbleInFg: "#121212",
    chatCanvas: "#EDEDDE",
    ink: "#121212",
    accentSoft: "#86EAAA",
    divider: "#DBDBD1",
  },
  shape: { style: "outlined", radius: 10, radiusField: 8, borderWidth: 2, shadowOffset: 3, iconStroke: 2, rowCards: true, floatingNav: true },
};

export const BUILTIN_THEMES: ThemeDef[] = [LIGHT, DARK, NEO];
export const DEFAULT_THEME = DARK;

export function builtinById(id: string): ThemeDef | undefined {
  return BUILTIN_THEMES.find((t) => t.id === id);
}
