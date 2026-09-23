/**
 * Набор реакций — по тайллисту (design/image copy 2.png).
 *
 * Значки берём системными эмодзи, а не картинками из макета: на iPhone это
 * те же самые рисунки Apple, только чёткие в любом размере и без чужих прав
 * на изображения. Тот же список проверяется на сервере (backend/chat/reactions.py)
 * — менять в двух местах вместе.
 */
export type ReactionDef = { emoji: string; label: string };

/** Основной набор: он показывается в ряду при долгом нажатии. */
export const MAIN_REACTIONS: ReactionDef[] = [
  { emoji: "❤️", label: "Лайк" },
  { emoji: "👍", label: "Класс" },
  { emoji: "👎", label: "Дизлайк" },
  { emoji: "🔥", label: "Огонь" },
  { emoji: "😂", label: "Смех" },
  { emoji: "😮", label: "Удивление" },
  { emoji: "😢", label: "Грусть" },
  { emoji: "🎉", label: "Праздник" },
  { emoji: "🤔", label: "Задумался" },
  { emoji: "👏", label: "Аплодисменты" },
  { emoji: "✅", label: "Согласен" },
  { emoji: "❌", label: "Не согласен" },
];

/** Дополнительные: открываются кнопкой «ещё». */
export const EXTRA_REACTIONS: ReactionDef[] = [
  { emoji: "⭐", label: "Интересно" },
  { emoji: "💡", label: "Идея" },
  { emoji: "👀", label: "Вау" },
  { emoji: "🤢", label: "Фу" },
  { emoji: "💯", label: "Супер" },
  { emoji: "🤝", label: "Поддержка" },
  { emoji: "🙏", label: "Спасибо" },
  { emoji: "💖", label: "Забота" },
];

export const ALL_REACTIONS = [...MAIN_REACTIONS, ...EXTRA_REACTIONS];

/** Двойной тап по сообщению ставит именно её. */
export const DEFAULT_REACTION = MAIN_REACTIONS[0].emoji;

/** Сводка под сообщением: сколько у какой реакции и моя ли она. */
export type ReactionSummary = { emoji: string; count: number; mine?: boolean; users?: string[] };
