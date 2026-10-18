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

/** Свой эмодзи реакцией (набор эмодзи): картинка; repaint — одноцветный,
 *  рисуется цветом текста. */
export type ReactionPic = { url: string; repaint?: boolean };

/** Сводка под сообщением: сколько у какой реакции и моя ли она. У своего
 *  эмодзи emoji — обычный двойник (его видят старые клиенты и пуши), key —
 *  «ce:<id>», им реакция и переключается, custom — картинка. */
export type ReactionSummary = { emoji: string; key?: string; custom?: ReactionPic; count: number; mine?: boolean; users?: string[] };

/** Чем реакцию переключать: у обычной — сам эмодзи. */
export const reactionKey = (r: { emoji: string; key?: string }) => r.key || r.emoji;

/** Свой эмодзи → значение реакции для сервера (backend/chat/reactions.py). */
export const customReactionKey = (emojiId: string) => `ce:${emojiId}`;

/** Что выбрали в списке реакций: обычный эмодзи — только key; свой — ещё
 *  картинка и двойник, чтобы таблетка нарисовалась сразу, до ответа сервера. */
export type ReactionPick = { key: string; emoji?: string; custom?: ReactionPic };
