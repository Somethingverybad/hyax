import { useSyncExternalStore } from "react";
import { onUserMessage, userSocket } from "@/lib/userSocket";
import { t as tr } from "@/lib/i18n";

/**
 * «Печатает…», «записывает голосовое…», «снимает треугольник…» — в шапке
 * чата и в списке чатов.
 *
 * Сигнал идёт через личный сокет (chat/consumers.py, activity): пока человек
 * печатает или пишет, клиент повторяет его раз в SEND_EVERY, перестал — «stop».
 * Приёмник гасит подпись сам, если повторов нет дольше EXPIRE (связь оборвалась).
 *
 * Подпись меняется каждые несколько секунд: то обычная, то шуточная
 * («промахивается по клавиатуре», «записывает подкаст»), без повторов подряд.
 */

export type ActivityKind = "typing" | "voice" | "video";

const SEND_EVERY = 3000;
const EXPIRE = 7000;
const SWAP_MIN = 3500;
const SWAP_MAX = 6500;

// Ключи — русские строки (переводятся словарём i18n). Первая — обычная.
const PHRASES: Record<ActivityKind, string[]> = {
  typing: [
    "печатает", "промахивается по клавиатуре", "подбирает слова", "стирает и пишет заново",
    "сочиняет поэму", "ищет нужную букву", "думает над ответом", "пишет что-то важное",
    "печатает со скоростью улитки", "строчит как из пулемёта",
  ],
  voice: [
    "записывает голосовое", "записывает подкаст", "разогревает голосовые связки",
    "надиктовывает мемуары", "репетирует речь", "записывает аудиокнигу", "поёт в микрофон",
  ],
  video: [
    "снимает треугольник", "снимает короткометражку", "ловит ракурс", "выставляет свет",
    "снимает кино", "репетирует перед камерой", "снимает влог",
  ],
};

/** Обычная подпись или шуточная — примерно поровну, но не та же, что сейчас. */
function pick(kind: ActivityKind, current?: string): string {
  const list = PHRASES[kind];
  for (let i = 0; i < 6; i++) {
    const p = Math.random() < 0.5 ? list[0] : list[1 + Math.floor(Math.random() * (list.length - 1))];
    if (p !== current) return p;
  }
  return list[0];
}

interface Entry { userId: string; username: string; kind: ActivityKind; phrase: string; until: number; swapAt: number }

const byChat = new Map<string, Map<string, Entry>>();
const subs = new Set<() => void>();
let version = 0;
const emit = () => { version++; subs.forEach((f) => f()); };
const nextSwap = () => Date.now() + SWAP_MIN + Math.random() * (SWAP_MAX - SWAP_MIN);

function receive(d: { chat_id?: string; user_id?: string; username?: string; kind?: string }) {
  if (!d.chat_id || !d.user_id) return;
  const chat = byChat.get(d.chat_id) || new Map<string, Entry>();
  if (d.kind === "stop" || !(d.kind && d.kind in PHRASES)) {
    if (chat.delete(d.user_id)) { if (!chat.size) byChat.delete(d.chat_id); emit(); }
    return;
  }
  const kind = d.kind as ActivityKind;
  const prev = chat.get(d.user_id);
  const fresh = !prev || prev.kind !== kind;
  chat.set(d.user_id, {
    userId: d.user_id, username: d.username || "", kind,
    phrase: fresh ? pick(kind) : prev!.phrase,
    until: Date.now() + EXPIRE,
    swapAt: fresh ? nextSwap() : prev!.swapAt,
  });
  byChat.set(d.chat_id, chat);
  if (fresh) emit();
}

// Раз в секунду: погасить устаревшее, сменить подписи, которым пора.
if (typeof window !== "undefined") {
  onUserMessage((msg: any) => { if (msg?.data?.type === "activity") receive(msg.data); });
  setInterval(() => {
    if (!byChat.size) return;
    const now = Date.now();
    let changed = false;
    for (const [chatId, chat] of byChat) {
      for (const [uid, e] of chat) {
        if (e.until < now) { chat.delete(uid); changed = true; continue; }
        if (e.swapAt < now) { e.phrase = pick(e.kind, e.phrase); e.swapAt = nextSwap(); changed = true; }
      }
      if (!chat.size) byChat.delete(chatId);
    }
    if (changed) emit();
  }, 1000);
}

const subscribe = (f: () => void) => { subs.add(f); return () => { subs.delete(f); }; };

/** Кто что делает в этом чате — для шапки. */
export function useChatActivity(chatId: string | null | undefined): Entry[] {
  useSyncExternalStore(subscribe, () => version, () => version);
  const chat = chatId ? byChat.get(chatId) : null;
  return chat ? [...chat.values()] : [];
}

/** Подпись для шапки или строки списка: «печатает…», в группе — «Вася печатает…»,
 *  несколько — «Вася печатает… и ещё 2». null — никто ничего не делает. */
export function activityLabel(entries: Entry[], withName: boolean): string | null {
  if (!entries.length) return null;
  const e = entries[0];
  const phrase = tr(e.phrase);
  // Без имени по-английски — «typing…», а не «is typing…».
  const text = `${withName ? phrase : phrase.replace(/^is /, "")}…`;
  const head = withName && e.username ? `${e.username} ${text}` : text;
  return entries.length > 1 ? `${head} ${tr("и ещё {n}", { n: entries.length - 1 })}` : head;
}

/** Для списка чатов: подписка на все чаты сразу. */
export function useAllActivity(): (chatId: string) => Entry[] {
  useSyncExternalStore(subscribe, () => version, () => version);
  return (chatId: string) => { const c = byChat.get(chatId); return c ? [...c.values()] : []; };
}

// ── Отправка ────────────────────────────────────────────────────────────────

const sent = new Map<string, { kind: ActivityKind | "stop"; at: number }>();

/** Сказать собеседникам, что я делаю в чате (повторы реже SEND_EVERY не уходят). */
export function reportActivity(chatId: string | null | undefined, kind: ActivityKind | "stop") {
  if (!chatId) return;
  const last = sent.get(chatId);
  const now = Date.now();
  if (kind === "stop") {
    if (!last || last.kind === "stop") return;
  } else if (last && last.kind === kind && now - last.at < SEND_EVERY) {
    return;
  }
  const ws = userSocket();
  if (!ws) return;
  try { ws.send({ type: "activity", chat: chatId, kind }); } catch { return; }
  sent.set(chatId, { kind, at: now });
}
