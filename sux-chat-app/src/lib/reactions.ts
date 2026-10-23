import { api } from "@/api/client";
import { readCache, writeCache } from "@/lib/session-cache";

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

/** Двойной тап по сообщению ставит именно её — пока человек не выбрал свою (quickReaction). */
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

/**
 * Быстрая реакция — та, что ставится двойным тапом по сообщению. Выбирается в
 * настройках (Профиль → Быстрая реакция) или из шторки реакций; по умолчанию
 * сердце. Настройка аккаунта: хранится в профиле (Profile.quick_reaction) и
 * подтягивается на все устройства; локальная копия в localStorage — чтобы
 * читать синхронно и работать без сети (applyServerQuickReaction при каждой
 * загрузке профиля сверяет её с сервером).
 */
const QUICK_KEY = "hyax:setting:quick_reaction";
let quickCache: ReactionPick | null | undefined;

const readQuick = (): ReactionPick | null => {
  try {
    const raw = localStorage.getItem(QUICK_KEY);
    const v = raw ? (JSON.parse(raw) as ReactionPick) : null;
    return v && typeof v.key === "string" && v.key ? v : null;
  } catch { return null; }
};

export function quickReaction(): ReactionPick {
  if (quickCache === undefined) quickCache = readQuick();
  return quickCache || { key: DEFAULT_REACTION, emoji: DEFAULT_REACTION };
}

const sameQuick = (a: ReactionPick | null, b: ReactionPick | null) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

/** Выбор человека: локально сразу, на сервер — в профиль (sync, по умолчанию). */
export function setQuickReaction(pick: ReactionPick | null, opts: { sync?: boolean } = {}) {
  const prev = quickCache === undefined ? readQuick() : quickCache;
  quickCache = pick;
  try {
    if (pick) localStorage.setItem(QUICK_KEY, JSON.stringify(pick)); else localStorage.removeItem(QUICK_KEY);
  } catch { /* приватный режим */ }
  if (!sameQuick(prev, pick)) window.dispatchEvent(new CustomEvent("hyax:quick-reaction"));
  if (opts.sync === false) return;
  const me = readCache<{ id?: string }>("user");
  if (me?.id) writeCache("user", { ...me, quick_reaction: pick });
  // Кэша профиля ещё нет (первый экран после входа) — узнаём id у сервера.
  const id = me?.id ? Promise.resolve(me.id) : api.getCurrentUser().then((p: { id: string }) => p.id);
  id.then((pid) => api.updateProfile(pid, { quick_reaction: pick }))
    .catch(() => { /* без сети — останется локально, подтянется позже */ });
}

/** Профиль пришёл с сервера — его выбор главнее локальной копии. */
export function applyServerQuickReaction(p: { quick_reaction?: ReactionPick | null } | null | undefined) {
  if (!p || !("quick_reaction" in p)) return;
  const server = p.quick_reaction && typeof p.quick_reaction.key === "string" ? p.quick_reaction : null;
  if (!sameQuick(server, quickCache === undefined ? readQuick() : quickCache)) setQuickReaction(server, { sync: false });
}

/** Подпись реакции для настроек: обычная — по словарю, своя — её двойник. */
export const reactionLabel = (pick: ReactionPick): string =>
  ALL_REACTIONS.find((r) => r.emoji === pick.key)?.label || pick.emoji || "";
