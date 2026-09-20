/**
 * Тема оформления как данные. Встроенные темы и темы пользователей — один и
 * тот же объект: набор цветов и параметры формы. Никакого CSS внутри темы нет
 * и быть не может — только значения из этой схемы, поэтому чужая тема не
 * сломает интерфейс и не спрячет, например, кнопку жалобы.
 *
 * Та же схема проверяется на сервере (backend/chat/themes.py) — менять вместе.
 */

/** Цвета темы, все — hex #RRGGBB. */
export const COLOR_KEYS = [
  "background", "foreground",
  "surface1", "surface2", "surface3", "surface4",
  "mutedForeground", "subtleForeground",
  "primary", "primaryForeground", "primaryDeep",
  "accent", "accentForeground",
  "destructive", "destructiveForeground",
  "success", "successForeground",
  "online", "amber",
  "border", "divider", "ring", "ink", "accentSoft",
  "bubbleOwn", "bubbleOwnFg", "bubbleIn", "bubbleInFg",
  "chatCanvas",
] as const;
export type ColorKey = (typeof COLOR_KEYS)[number];
export type ThemeColors = Record<ColorKey, string>;

/** Форма: то, чего цветами не выразить. */
export interface ThemeShape {
  /** flat — плоские поверхности с волосяными линиями; outlined — обводка
   *  «тушью» и жёсткая тень без размытия (необрутализм). */
  style: "flat" | "outlined";
  /** Радиус карточек и пузырей, px. */
  radius: number;
  /** Радиус полей и кнопок, px. */
  radiusField: number;
  /** Толщина обводки в стиле outlined, px. */
  borderWidth: number;
  /** Сдвиг жёсткой тени в стиле outlined, px. 0 — без тени. */
  shadowOffset: number;
  /** Толщина штриха иконок. */
  iconStroke: number;
  /** Строки списка чатов — отдельными карточками (телефон). */
  rowCards: boolean;
  /** Нижняя навигация — плавающей карточкой с подписями (телефон). */
  floatingNav: boolean;
}

export const SHAPE_LIMITS = {
  radius: [0, 24], radiusField: [0, 20], borderWidth: [1, 4], shadowOffset: [0, 8], iconStroke: [1, 2.5],
} as const;

export interface ThemeDef {
  /** Встроенные: dark | light | neo. Пользовательские — uuid с сервера. */
  id: string;
  name: string;
  /** Светлый или тёмный фон: значки статус-бара, системная подложка, клавиатура. */
  base: "light" | "dark";
  colors: ThemeColors;
  shape: ThemeShape;
  /** Только у тем с сервера. */
  author?: string | null;
  mine?: boolean;
  installed?: boolean;
  installs?: number;
  builtin?: boolean;
}

export const SCHEMA_VERSION = 1;
