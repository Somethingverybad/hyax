/**
 * Фраза действия зависит от того, кто читает: отправителю — «Вы подмигиваете
 * {whom}», адресату — «Вам подмигивает {who}», остальным — «{who} подмигивает
 * {whom}». Русские формы сервер хранит (phrase_ru_self/_you), а если их нет —
 * собирает тем же алгоритмом, что здесь (backend/chat/action_text.py): глагол
 * — по первому слову, предлог в конце фразы ставит «вас»/«вам»/«вами» после себя.
 */
import type { ChatActionInfo } from "@/api/client";

export type ActionView = "self" | "you" | "third";

const ENDINGS: [string, string][] = [
  ["ется", "етесь"], ["ётся", "ётесь"], ["ится", "итесь"], ["ался", "ались"], ["ялся", "ялись"], ["ился", "ились"],
  ["ёт", "ёте"], ["ет", "ете"], ["ит", "ите"], ["ут", "ете"], ["ют", "ете"], ["ат", "ите"], ["ят", "ите"],
  ["ла", "ли"], ["ло", "ли"], ["л", "ли"],
];

const PREP: Record<string, string> = {
  в: "вас", во: "вас", на: "вас", за: "вас", про: "вас", через: "вас", сквозь: "вас",
  "из-за": "вас", у: "вас", для: "вас", от: "вас", без: "вас", около: "вас", возле: "вас", из: "вас", до: "вас",
  к: "вам", ко: "вам", по: "вам",
  с: "вами", со: "вами", над: "вами", под: "вами", перед: "вами", между: "вами",
  о: "вас", об: "вас", обо: "вас", при: "вас",
};

export function verbYou(verb: string): string {
  const v = verb.trim();
  const i = v.indexOf(" ");
  let head = i < 0 ? v : v.slice(0, i);
  const rest = i < 0 ? "" : v.slice(i);
  const low = head.toLowerCase();
  for (const [end, rep] of ENDINGS) {
    if (low.endsWith(end)) { head = head.slice(0, head.length - end.length) + rep; break; }
  }
  return head + rest;
}

export const trailingPrep = (verb: string) => {
  const last = verb.trim().split(" ").pop()?.toLowerCase().replace(/,$/, "") || "";
  return PREP[last] ? last : "";
};

export const ruSelf = (verb: string) => `Вы ${verbYou(verb)} {whom}`;

export function ruYou(verb: string, acc = false): string {
  const v = verb.trim();
  const p = trailingPrep(v);
  return p ? `{who} ${v} ${PREP[p]}` : `${acc ? "Вас" : "Вам"} ${v} {who}`;
}

/** Шаблон с {who}/{whom} для языка и того, кто читает. */
export function actionTemplate(a: ChatActionInfo, lang: string, view: ActionView): string {
  const l = lang === "en" || lang === "ko" ? lang : "ru";
  const suffix = view === "self" ? "_self" : view === "you" ? "_you" : "";
  const get = (k: string) => ((a as unknown as Record<string, string | undefined>)[k] || "").trim();
  let tpl = l === "ru" && !suffix ? "" : get(`phrase_${l}${suffix}`);
  if (!tpl && l === "ru") tpl = view === "self" ? ruSelf(a.verb) : view === "you" ? ruYou(a.verb) : "";
  if (!tpl && l !== "ru") tpl = get(`phrase_${l}`);
  return tpl || `{who} ${a.verb} {whom}`;
}
