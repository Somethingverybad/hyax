import { EMOJI_SEQ } from "@/lib/notoEmoji";

/**
 * Эффекты получения сообщения (Message.effect, сервер — MESSAGE_EFFECTS):
 * выбираются в меню по удержанию стикера или кнопки «Отправить» и
 * разыгрываются у получателя один раз (и у отправителя сразу).
 *   • burst — «Глюк»: копии высыпаются по экрану всё быстрее, потом тают;
 *   • rain  — «Ливень»: копии разного размера падают сверху и собираются в
 *             кучу внизу, потом тают.
 * У стикера сыплется сам стикер, у текста — эмодзи из него, а без эмодзи —
 * сам текст пузырьками.
 */
export type MessageEffect = "burst" | "rain";

export const MESSAGE_EFFECTS: { key: MessageEffect; label: string; hint: string; icon: string }[] = [
  { key: "burst", label: "Глюк", hint: "Высыплется по всему экрану", icon: "💥" },
  { key: "rain", label: "Ливень", hint: "Упадёт сверху и соберётся в кучу", icon: "🌧️" },
];

export const isMessageEffect = (v: unknown): v is MessageEffect => v === "burst" || v === "rain";

/** Что разыграть: стикер, эмодзи или текст. */
export type EffectPlay = { kind: MessageEffect; sticker?: string; emoji?: string[]; text?: string };

/** У текстового сообщения сыплются эмодзи из него (до 6 разных), без них — сам текст. */
export function textEffect(kind: MessageEffect, text: string): EffectPlay | null {
  const t = (text || "").trim();
  if (!t) return null;
  const emoji = [...new Set(t.match(EMOJI_SEQ) || [])].slice(0, 6);
  if (emoji.length) return { kind, emoji };
  return { kind, text: t.length > 24 ? `${t.slice(0, 23)}…` : t };
}

/** Эффект пришедшего сообщения (null — разыгрывать нечего). */
export function effectOf(m: { effect?: string | null; content?: string | null; sticker?: { file_url?: string } | null }): EffectPlay | null {
  if (!isMessageEffect(m.effect)) return null;
  if (m.sticker?.file_url) return { kind: m.effect, sticker: m.sticker.file_url };
  return textEffect(m.effect, m.content || "");
}
