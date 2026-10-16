import { useEffect, useMemo, useRef, useState } from "react";
import { Clock, Search, X } from "lucide-react";
import { notoSvgUrl } from "@/lib/notoEmoji";
import { getLang, t } from "@/lib/i18n";
import { cn } from "@/lib/utils";

type Group = { group: string; items: [string, string, string, string][] };

/** Код Noto («1f469_200d_1f4bb») → символы. Одиночному значку из BMP (❤, ☀)
 *  добавляем вариант эмодзи (FE0F) — иначе поле ввода покажет его текстом. */
export const emojiFromCode = (code: string) => {
  const cps = code.split("_").map((h) => parseInt(h, 16));
  const s = String.fromCodePoint(...cps);
  return cps.length === 1 && cps[0] < 0x2fff ? s + "️" : s;
};

// Варианты оттенка кожи в сетку не кладём: раздел «Люди» вырос бы втрое.
const SKIN = /_1f3f[b-f]/;

const GROUP_ICON: Record<string, string> = {
  "smileys-emotion": "1f600", "people-body": "1f44b", "animals-nature": "1f43b", "food-drink": "1f354",
  "travel-places": "1f697", activities: "26bd", objects: "1f4a1", symbols: "2764_fe0f", flags: "1f3c1",
};
const GROUP_NAME: Record<string, string> = {
  "smileys-emotion": "Смайлики", "people-body": "Люди", "animals-nature": "Животные и природа", "food-drink": "Еда и напитки",
  "travel-places": "Путешествия", activities: "Занятия", objects: "Предметы", symbols: "Символы", flags: "Флаги",
};

const RECENT_KEY = "hyax:emoji-recent";
const readRecent = (): string[] => { try { return JSON.parse(localStorage.getItem(RECENT_KEY) || "[]").slice(0, 32); } catch { return []; } };
const pushRecent = (code: string) => {
  try { localStorage.setItem(RECENT_KEY, JSON.stringify([code, ...readRecent().filter((c) => c !== code)].slice(0, 32))); } catch { /* приватный режим */ }
};

let cache: Group[] | null = null;

/**
 * Выбор эмодзи — те самые анимированные эмодзи Noto, которыми WYX рисует
 * эмодзи в сообщениях (зеркало на нашем сервере). Нужен на десктопе: там нет
 * клавиатуры с эмодзи. Тап вставляет эмодзи в поле, панель остаётся открытой.
 * Разделы, поиск (ru/en/ko) и недавние; данные грузятся при первом открытии.
 */
const EmojiPanel = ({ onPick, className }: { onPick: (emoji: string) => void; className?: string }) => {
  const [groups, setGroups] = useState<Group[] | null>(cache);
  const [q, setQ] = useState("");
  const [recent, setRecent] = useState<string[]>(readRecent);
  const scroller = useRef<HTMLDivElement>(null);
  const sections = useRef<Record<string, HTMLDivElement | null>>({});

  useEffect(() => {
    if (cache) return;
    import("@/lib/notoPickerData").then((m) => {
      cache = m.NOTO_PICKER.map((g) => ({ ...g, items: g.items.filter((it) => !SKIN.test(it[0])) }));
      setGroups(cache);
    }).catch(() => setGroups([]));
  }, []);

  // Поиск — по словам на языке приложения и по-английски (их часто знают).
  const lang = getLang();
  const kwIx = lang === "en" ? 2 : lang === "ko" ? 3 : 1;
  const found = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!s || !groups) return null;
    const out: string[] = [];
    for (const g of groups) for (const it of g.items) {
      if (it[kwIx].includes(s) || it[2].includes(s)) out.push(it[0]);
      if (out.length >= 120) return out;
    }
    return out;
  }, [q, groups, kwIx]);

  const pick = (code: string) => {
    onPick(emojiFromCode(code));
    pushRecent(code);
    setRecent(readRecent());
  };

  const cell = (code: string) => (
    <button key={code} type="button" onClick={() => pick(code)} title={emojiFromCode(code)}
      className="w-10 h-10 rounded-md flex items-center justify-center hover:bg-surface-4 active:scale-95 transition-transform">
      <img src={notoSvgUrl(code)} alt={emojiFromCode(code)} loading="lazy" draggable={false} className="w-7 h-7" />
    </button>
  );

  const jump = (id: string) => {
    const el = sections.current[id];
    if (el && scroller.current) scroller.current.scrollTo({ top: el.offsetTop - 4, behavior: "smooth" });
  };

  return (
    <div className={cn("flex flex-col min-h-0", className)}>
      <div className="px-2 pt-2 shrink-0">
        <label className="flex items-center gap-2 h-9 px-3 rounded-md bg-surface-4">
          <Search className="w-4 h-4 text-subtle shrink-0" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t("Найти эмодзи")}
            className="flex-1 min-w-0 bg-transparent outline-none text-small" />
          {q && <button type="button" onClick={() => setQ("")} aria-label={t("Очистить")} className="text-subtle"><X className="w-4 h-4" /></button>}
        </label>
      </div>
      {!found && groups && (
        <div className="flex gap-0.5 px-2 pt-1.5 shrink-0 overflow-x-auto [scrollbar-width:none]">
          {!!recent.length && (
            <button type="button" onClick={() => jump("recent")} title={t("Недавние")} className="w-8 h-8 shrink-0 rounded-md flex items-center justify-center text-subtle hover:bg-surface-4">
              <Clock className="w-4 h-4" />
            </button>
          )}
          {groups.map((g) => (
            <button key={g.group} type="button" onClick={() => jump(g.group)} title={t(GROUP_NAME[g.group] || g.group)}
              className="w-8 h-8 shrink-0 rounded-md flex items-center justify-center hover:bg-surface-4">
              <img src={notoSvgUrl(GROUP_ICON[g.group] || g.items[0]?.[0])} alt="" className="w-5 h-5 opacity-80" draggable={false} />
            </button>
          ))}
        </div>
      )}
      <div ref={scroller} className="relative flex-1 min-h-0 overflow-y-auto px-1.5 py-1.5">
        {!groups ? (
          <p className="text-small text-subtle text-center py-6">{t("Загрузка…")}</p>
        ) : found ? (
          found.length ? <div className="flex flex-wrap">{found.map(cell)}</div>
            : <p className="text-small text-subtle text-center py-6">{t("Ничего не найдено")}</p>
        ) : (
          <>
            {!!recent.length && (
              <div ref={(el) => { sections.current.recent = el; }}>
                <p className="px-1 pt-1 pb-0.5 text-caption text-subtle">{t("Недавние")}</p>
                <div className="flex flex-wrap">{recent.map(cell)}</div>
              </div>
            )}
            {groups.map((g) => (
              <div key={g.group} ref={(el) => { sections.current[g.group] = el; }}>
                <p className="px-1 pt-2 pb-0.5 text-caption text-subtle">{t(GROUP_NAME[g.group] || g.group)}</p>
                <div className="flex flex-wrap">{g.items.map((it) => cell(it[0]))}</div>
              </div>
            ))}
          </>
        )}
      </div>
    </div>
  );
};

export default EmojiPanel;
