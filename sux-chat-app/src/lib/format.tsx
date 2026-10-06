import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { toast } from "sonner";
import { Linkify } from "./linkify";

/**
 * Форматирование текста сообщений.
 *
 * На сервере текст хранится чистым, оформление — списком диапазонов
 * (entities: type/offset/length, offset в UTF-16 = индексы строк JS), см.
 * backend/chat/formatting.py. Старые версии приложения покажут обычный текст.
 *
 * В поле ввода оформление набирается разметкой (панель над полем вставляет её
 * сама): **жирный**, __курсив__, ++подчёркнутый++, ~~зачёркнутый~~, `код`,
 * ```блок кода```, ||спойлер||, %%зальго%%, ^^перемешанный^^. При отправке
 * разметка снимается и превращается в entities; при редактировании — обратно.
 */
export type EntityType =
  | "bold" | "italic" | "underline" | "strike" | "code" | "pre"
  | "spoiler" | "zalgo" | "scramble";

export interface TextEntity { type: EntityType; offset: number; length: number }

/** Маркеры разметки. Порядок важен: длинные раньше коротких (``` раньше `). */
export const MARKERS: { mark: string; type: EntityType }[] = [
  { mark: "```", type: "pre" },
  { mark: "**", type: "bold" },
  { mark: "__", type: "italic" },
  { mark: "++", type: "underline" },
  { mark: "~~", type: "strike" },
  { mark: "||", type: "spoiler" },
  { mark: "%%", type: "zalgo" },
  { mark: "^^", type: "scramble" },
  { mark: "`", type: "code" },
];
const MARK_OF: Record<EntityType, string> = Object.fromEntries(MARKERS.map((m) => [m.type, m.mark])) as Record<EntityType, string>;

// Ссылки разбираем как есть: «__» и «**» внутри адреса — часть ссылки.
const URL_AT = /^(?:https?:\/\/|www\.)[^\s<>"']+/i;

/** Разметка → чистый текст и диапазоны. Вложенность поддерживается
 *  (**__жирный курсив__**), внутри кода разметки нет. */
export function parseMarkup(src: string): { text: string; entities: TextEntity[] } {
  let out = "";
  const entities: TextEntity[] = [];
  let i = 0;
  while (i < src.length) {
    const url = URL_AT.exec(src.slice(i));
    if (url && (i === 0 || /\s/.test(src[i - 1]))) {
      out += url[0];
      i += url[0].length;
      continue;
    }
    const m = MARKERS.find((x) => src.startsWith(x.mark, i));
    if (m) {
      const start = i + m.mark.length;
      const end = src.indexOf(m.mark, start);
      // Пусто между маркерами или нет закрывающего — это просто символы.
      if (end > start && src.slice(start, end).trim()) {
        const inner = src.slice(start, end);
        const parsed = m.type === "code" || m.type === "pre"
          ? { text: inner.replace(/^\n/, "").replace(/\n$/, ""), entities: [] }
          : parseMarkup(inner);
        const offset = out.length;
        entities.push({ type: m.type, offset, length: parsed.text.length });
        for (const e of parsed.entities) entities.push({ ...e, offset: e.offset + offset });
        out += parsed.text;
        i = end + m.mark.length;
        continue;
      }
    }
    out += src[i];
    i += 1;
  }
  return { text: out, entities: entities.filter((e) => e.length > 0) };
}

/** Текст и диапазоны → разметка (для редактирования своего сообщения). */
export function toMarkup(text: string, entities?: TextEntity[] | null): string {
  const list = (entities || []).filter((e) => MARK_OF[e.type] && e.length > 0 && e.offset >= 0 && e.offset + e.length <= text.length);
  if (!list.length) return text;
  type Ix = TextEntity & { ix: number };
  const opens = new Map<number, Ix[]>();
  const closes = new Map<number, Ix[]>();
  list.forEach((e, ix) => {
    const x = { ...e, ix };
    (opens.get(e.offset) || opens.set(e.offset, []).get(e.offset)!).push(x);
    const end = e.offset + e.length;
    (closes.get(end) || closes.set(end, []).get(end)!).push(x);
  });
  let out = "";
  for (let p = 0; p <= text.length; p++) {
    // Сначала закрываем, потом открываем. Открываем длинные первыми, закрываем
    // короткие первыми; при равной длине закрываем в обратном порядке открытия.
    const c = (closes.get(p) || []).sort((a, b) => a.length - b.length || b.ix - a.ix);
    for (const e of c) out += MARK_OF[e.type];
    const o = (opens.get(p) || []).sort((a, b) => b.length - a.length || a.ix - b.ix);
    for (const e of o) out += MARK_OF[e.type];
    if (p < text.length) out += text[p];
  }
  return out;
}

/** Превью для своих же подписей (список чатов из открытой переписки, цитаты):
 *  спойлер прячем, перемешанное — перемешиваем. Тот же смысл, что на сервере. */
export function maskPreview(text: string, entities?: TextEntity[] | null): string {
  const hidden = (entities || []).filter((e) => e.type === "spoiler" || e.type === "scramble");
  if (!hidden.length) return text;
  const chars = text.split("");
  for (const e of hidden) {
    for (let k = e.offset; k < Math.min(text.length, e.offset + e.length); k++) {
      if (e.type === "spoiler" && !/\s/.test(chars[k])) chars[k] = "░";
    }
    if (e.type === "scramble") {
      const seg = scrambleText(text.slice(e.offset, e.offset + e.length), hashSeed(text));
      for (let k = 0; k < seg.length; k++) chars[e.offset + k] = seg[k];
    }
  }
  return chars.join("");
}

// ---------- случайность с семенем: у всех одинаковая картинка ----------

export function hashSeed(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}
function rng(seed: number) {
  let a = seed || 1;
  return () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

// ---------- зальго ----------

const Z_UP = "̍̎̄̅̿̑̆̐͒͗͑̇̈̊͂̓̈́͊͋͌̃̂̌͐̀́̋̏̒̓̔̽̉ͣͤͥͦͧͨͩͪͫͬͭͮͯ̾͛";
const Z_MID = "̴̵̶̡̢̧̨̛̀́̕͘͏̸̷͜͟͢͝͞͠͡";
const Z_DOWN = "̖̗̘̙̜̝̞̟̠̤̥̦̩̪̫̬̭̮̯̰̱̲̳̹̺̻̼͇͈͉͍͎͓͔͕͖͙͚̣ͅ";

/** Буквы обрастают диакритикой сверху, посередине и снизу. Умеренно: иначе
 *  «волосы» залезают на соседние сообщения. */
export function zalgoText(text: string, seed: number): string {
  const r = rng(seed);
  const pick = (set: string) => set[Math.floor(r() * set.length)];
  let out = "";
  for (const ch of text) {
    out += ch;
    if (/\s/.test(ch)) continue;
    const up = 1 + Math.floor(r() * 4), mid = Math.floor(r() * 2), down = 1 + Math.floor(r() * 3);
    for (let k = 0; k < up; k++) out += pick(Z_UP);
    for (let k = 0; k < mid; k++) out += pick(Z_MID);
    for (let k = 0; k < down; k++) out += pick(Z_DOWN);
  }
  return out;
}

// ---------- перемешивание ----------

/** Буквы внутри каждого слова перемешаны; пробелы и знаки на месте. */
export function scrambleText(text: string, seed: number): string {
  const r = rng(seed);
  return text.replace(/[\p{L}\p{N}]+/gu, (w) => {
    const a = [...w];
    if (a.length < 2) return w;
    for (let tries = 0; tries < 4; tries++) {
      for (let k = a.length - 1; k > 0; k--) { const j = Math.floor(r() * (k + 1)); [a[k], a[j]] = [a[j], a[k]]; }
      if (a.join("") !== w) break;
    }
    return a.join("");
  });
}

const NOISE = "абвгдеёжзийклмнопрстуфхцчшщъыьэюяabcdefghijklmnopqrstuvwxyz0123456789";

/** Перемешанный текст; по тапу буквы «перебираются» и встают на место слева
 *  направо. Собранный остаётся собранным. */
function Scramble({ text, seed, children }: { text: string; seed: number; children: (shown: string) => ReactNode }) {
  const scrambled = useMemo(() => scrambleText(text, seed), [text, seed]);
  const [shown, setShown] = useState(scrambled);
  const [state, setState] = useState<"mixed" | "running" | "done">("mixed");
  const raf = useRef(0);
  useEffect(() => () => cancelAnimationFrame(raf.current), []);
  useEffect(() => { setShown(scrambled); setState("mixed"); }, [scrambled]);

  const run = () => {
    if (state !== "mixed") return;
    setState("running");
    const chars = [...text];
    const r = rng(seed ^ 0x9e3779b9);
    // Каждой позиции — свой момент «встать на место»: слева направо с разбросом.
    const DURATION = Math.min(1600, 500 + chars.length * 35);
    const settleAt = chars.map((_, k) => (k / Math.max(1, chars.length - 1)) * DURATION * 0.75 + r() * DURATION * 0.25);
    const t0 = performance.now();
    let frame = 0;
    const tick = (now: number) => {
      const t = now - t0;
      frame++;
      const fr = rng(seed + frame * 7919);
      const next = chars.map((ch, k) =>
        t >= settleAt[k] || !/[\p{L}\p{N}]/u.test(ch) ? ch : NOISE[Math.floor(fr() * NOISE.length)]);
      setShown(next.join(""));
      if (t < DURATION) raf.current = requestAnimationFrame(tick);
      else { setShown(text); setState("done"); }
    };
    raf.current = requestAnimationFrame(tick);
  };

  return (
    <span
      className={state === "mixed" ? "fmt-scramble" : undefined}
      onClick={(e) => { if (state === "mixed") { e.stopPropagation(); run(); } }}
      role={state === "mixed" ? "button" : undefined}
      title={state === "mixed" ? "Нажмите, чтобы собрать" : undefined}
    >
      {children(shown)}
    </span>
  );
}

function Spoiler({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  if (open) return <span className="fmt-spoiler-open">{children}</span>;
  return (
    <span className="fmt-spoiler" role="button" aria-label="Спойлер" onClick={(e) => { e.stopPropagation(); setOpen(true); }}>
      <span className="fmt-spoiler-text">{children}</span>
    </span>
  );
}

const copyCode = (text: string) => {
  navigator.clipboard?.writeText(text).then(() => toast.success("Код скопирован")).catch(() => {});
};

/**
 * Текст сообщения с оформлением и кликабельными ссылками.
 * seed — id сообщения: зальго и перемешивание у всех выглядят одинаково.
 */
export function FormattedText({ text, entities, seed }: { text: string; entities?: TextEntity[] | null; seed: string }) {
  const list = useMemo(
    () => (entities || []).filter((e) => e && MARK_OF[e.type] && e.length > 0 && e.offset >= 0 && e.offset < text.length),
    [entities, text],
  );
  if (!list.length) return <Linkify text={text} />;
  const baseSeed = hashSeed(seed);
  return <>{renderRange(text, list, 0, text.length, baseSeed)}</>;
}

/** Рекурсивно: внешние диапазоны оборачивают внутренние. Пересекающиеся
 *  (так бывает только у ботов) режем по границе внешнего. */
function renderRange(text: string, entities: TextEntity[], from: number, to: number, seed: number): ReactNode[] {
  const nodes: ReactNode[] = [];
  const inside = entities
    .map((e) => ({ ...e, s: Math.max(from, e.offset), t: Math.min(to, e.offset + e.length) }))
    .filter((e) => e.t > e.s)
    .sort((a, b) => a.s - b.s || (b.t - b.s) - (a.t - a.s));
  let pos = from;
  let k = 0;
  while (k < inside.length) {
    const top = inside[k];
    if (top.s < pos) { k++; continue; }
    if (top.s > pos) nodes.push(<Linkify key={`t${pos}`} text={text.slice(pos, top.s)} />);
    const rest = inside.slice(k + 1).filter((e) => e.s >= top.s && e.s < top.t).map((e) => ({ type: e.type, offset: e.s, length: Math.min(e.t, top.t) - e.s }));
    nodes.push(wrap(top.type, text, rest, top.s, top.t, seed, `${top.type}${top.s}`));
    pos = top.t;
    k++;
    while (k < inside.length && inside[k].s < pos) k++;
  }
  if (pos < to) nodes.push(<Linkify key={`t${pos}`} text={text.slice(pos, to)} />);
  return nodes;
}

function wrap(type: EntityType, text: string, inner: TextEntity[], s: number, t: number, seed: number, key: string): ReactNode {
  const slice = text.slice(s, t);
  const kids = () => renderRange(text, inner, s, t, seed);
  switch (type) {
    case "bold": return <strong key={key} className="font-semibold">{kids()}</strong>;
    case "italic": return <em key={key}>{kids()}</em>;
    case "underline": return <u key={key} className="underline-offset-2">{kids()}</u>;
    case "strike": return <s key={key}>{kids()}</s>;
    case "code":
      return <code key={key} className="fmt-code" onClick={(e) => { e.stopPropagation(); copyCode(slice); }}>{slice}</code>;
    case "pre":
      return <code key={key} className="fmt-pre" onClick={(e) => { e.stopPropagation(); copyCode(slice); }}>{slice}</code>;
    case "spoiler": return <Spoiler key={key}>{kids()}</Spoiler>;
    case "zalgo": return <span key={key} className="fmt-zalgo">{zalgoText(slice, seed + s)}</span>;
    case "scramble":
      return <Scramble key={key} text={slice} seed={seed + s}>{(shown) => shown}</Scramble>;
    default: return <span key={key}>{kids()}</span>;
  }
}

/** Обернуть выделение в поле ввода маркером (или снять, если уже обёрнуто). */
export function toggleMarker(value: string, selStart: number, selEnd: number, type: EntityType): { value: string; start: number; end: number } {
  const mark = MARK_OF[type];
  let s = selStart, e = selEnd;
  // Пробелы по краям выделения не оборачиваем: «** слово **» не распознается.
  while (s < e && /\s/.test(value[s])) s++;
  while (e > s && /\s/.test(value[e - 1])) e--;
  if (s === e) return { value, start: selStart, end: selEnd };
  const L = mark.length;
  if (value.slice(s - L, s) === mark && value.slice(e, e + L) === mark) {
    return { value: value.slice(0, s - L) + value.slice(s, e) + value.slice(e + L), start: s - L, end: e - L };
  }
  if (value.slice(s, s + L) === mark && value.slice(e - L, e) === mark && e - s > 2 * L) {
    return { value: value.slice(0, s) + value.slice(s + L, e - L) + value.slice(e), start: s, end: e - 2 * L };
  }
  return { value: value.slice(0, s) + mark + value.slice(s, e) + mark + value.slice(e), start: s + L, end: e + L };
}
