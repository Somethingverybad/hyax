import type { TextEntity } from "@/lib/format";
import { EMOJI_SEQ } from "@/lib/notoEmoji";

/**
 * Эффекты получения сообщения (Message.effect, сервер — MESSAGE_EFFECTS):
 * выбираются в меню по удержанию стикера или кнопки «Отправить» и
 * разыгрываются у получателя один раз (и у отправителя сразу).
 *   • burst — «Глюк»: копии высыпаются по экрану всё быстрее, потом тают;
 *   • rain  — «Ливень»: копии разного размера падают сверху и собираются в
 *             кучу внизу, потом тают;
 *   • scream — «Скример»: одна копия резко выскакивает во весь экран,
 *             трясётся с вибрацией и пропадает;
 *   • rage   — «Ярость»: сообщение в центре экрана трясётся всё сильнее, а
 *             пузырь заливается красным, с нарастающей вибрацией.
 * У стикера сыплется сам стикер, у текста — эмодзи из него, а без эмодзи —
 * само сообщение пузырьками: целиком и с разметкой, пузырь уменьшается, чтобы
 * влез. Поэтому длинным сообщениям (больше EFFECT_TEXT_MAX знаков) эффекты
 * недоступны — сервер у них эффект тоже не сохранит.
 */
export type MessageEffect = "burst" | "rain" | "scream" | "rage";

export const MESSAGE_EFFECTS: { key: MessageEffect; label: string; hint: string; icon: string }[] = [
  { key: "burst", label: "Глюк", hint: "Высыплется по всему экрану", icon: "💥" },
  { key: "rain", label: "Ливень", hint: "Упадёт сверху и соберётся в кучу", icon: "🌧️" },
  { key: "scream", label: "Скример", hint: "Выскочит во весь экран и затрясётся", icon: "😱" },
  { key: "rage", label: "Ярость", hint: "Затрясётся от злости и покраснеет", icon: "😡" },
];

export const isMessageEffect = (v: unknown): v is MessageEffect => v === "burst" || v === "rain" || v === "scream" || v === "rage";

/** Длиннее — эффекты недоступны: пузырь пришлось бы ужать до нечитаемого.
 *  То же число на сервере (chat/models.py EFFECT_TEXT_MAX). */
export const EFFECT_TEXT_MAX = 100;
/** Текст влезает в эффект (знаки считаем по символам, эмодзи — один). */
export const effectsFit = (text: string) => Array.from((text || "").trim()).length <= EFFECT_TEXT_MAX;

/** Что разыграть: стикер, эмодзи или сообщение пузырём (с разметкой). */
export type EffectPlay = { kind: MessageEffect; sticker?: string; emoji?: string[]; text?: string; entities?: TextEntity[] | null };

/** У текстового сообщения сыплются эмодзи из него (до 6 разных), без них —
 *  само сообщение. «Ярость» — всегда само сообщение: краснеет его пузырь. */
export function textEffect(kind: MessageEffect, text: string, entities?: TextEntity[] | null): EffectPlay | null {
  const t = (text || "").trim();
  if (!t || !effectsFit(t)) return null;
  const emoji = kind === "rage" ? [] : [...new Set(t.match(EMOJI_SEQ) || [])].slice(0, 6);
  if (emoji.length) return { kind, emoji };
  // Разметка считается от начала текста: обрезаем только хвостовые пробелы.
  return { kind, text: (text || "").trimEnd(), entities };
}

/** Эффект пришедшего сообщения (null — разыгрывать нечего). */
export function effectOf(m: { effect?: string | null; content?: string | null; entities?: TextEntity[] | null; sticker?: { file_url?: string } | null }): EffectPlay | null {
  if (!isMessageEffect(m.effect)) return null;
  if (m.sticker?.file_url) return { kind: m.effect, sticker: m.sticker.file_url };
  return textEffect(m.effect, m.content || "", m.entities);
}
