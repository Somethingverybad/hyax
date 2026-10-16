import { useEffect, useMemo, useRef, useState } from "react";
import { Clock, Plus, Search, Share2, Smile, X } from "lucide-react";
import { toast } from "sonner";
import { api, mediaUrl } from "@/api/client";
import { confirmDialog } from "@/lib/confirm";
import { notoSvgUrl } from "@/lib/notoEmoji";
import { readCache } from "@/lib/session-cache";
import { shareEmojiPack } from "@/lib/share";
import { getLang, t } from "@/lib/i18n";
import { cn } from "@/lib/utils";

type Group = { group: string; items: [string, string, string, string][] };
type CustomEmoji = { id: string; file_url: string; emoji?: string | null };
type CustomPack = { id: string; name: string; mine: boolean; items: CustomEmoji[] };

/** Код Noto («1f469_200d_1f4bb») → символы. Одиночному значку из BMP (❤, ☀)
 *  добавляем вариант эмодзи (FE0F) — иначе поле ввода покажет его текстом. */
export const emojiFromCode = (code: string) => {
  const cps = code.split("_").map((h) => parseInt(h, 16));
  const s = String.fromCodePoint(...cps);
  return cps.length === 1 && cps[0] < 0x2fff ? s + "️" : s;
};

// Варианты оттенка кожи в сетку не кладём: раздел «Люди» вырос бы втрое.
const SKIN = /_1f3f[b-f]/;
/** Обычный эмодзи за своим, если автор не выбрал: его видят старые клиенты и пуши. */
const DEFAULT_FALLBACK = "🙂";

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
let packsCache: CustomPack[] | null = null;

/** Мои наборы своих эмодзи (свои и сохранённые) со всеми эмодзи. */
async function loadCustomPacks(): Promise<CustomPack[]> {
  const me = readCache<{ id: string }>("user")?.id;
  const rows = ((await api.getMyStickerPacks()) || []).map((r: any) => r.pack || r).filter((p: any) => p?.kind === "emoji");
  const lists = await Promise.all(rows.map((p: any) => api.getStickers(p.id).catch(() => [])));
  return rows.map((p: any, i: number) => {
    const author = p.author && typeof p.author === "object" ? p.author.id : p.author;
    return { id: p.id, name: p.name, mine: !!me && author === me, items: (lists[i] || []).map((s: any) => ({ id: s.id, file_url: s.file_url, emoji: s.emoji })) };
  });
}

/**
 * Выбор эмодзи. Сверху — свои наборы (картинки, их вставляют в текст:
 * entities custom_emoji), ниже — анимированные эмодзи Noto, которыми WYX рисует
 * эмодзи в сообщениях (только на десктопе: на телефоне они есть в клавиатуре).
 * Тап вставляет эмодзи в поле, панель остаётся открытой.
 */
const EmojiPanel = ({ onPick, standard = true, className }: {
  onPick: (emoji: string, custom?: { id: string; url?: string }) => void;
  /** Показывать эмодзи Noto (десктоп); без них — только свои наборы. */
  standard?: boolean;
  className?: string;
}) => {
  const [groups, setGroups] = useState<Group[] | null>(standard ? cache : []);
  const [packs, setPacks] = useState<CustomPack[] | null>(packsCache);
  const [q, setQ] = useState("");
  const [recent, setRecent] = useState<string[]>(readRecent);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");
  const [uploading, setUploading] = useState<{ pack: string; done: number; total: number } | null>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const sections = useRef<Record<string, HTMLDivElement | null>>({});
  const fileRef = useRef<HTMLInputElement>(null);
  const addTo = useRef<string | null>(null);
  const hold = useRef<ReturnType<typeof setTimeout> | null>(null);
  const held = useRef(false);

  useEffect(() => {
    if (!standard || cache) return;
    import("@/lib/notoPickerData").then((m) => {
      cache = m.NOTO_PICKER.map((g) => ({ ...g, items: g.items.filter((it) => !SKIN.test(it[0])) }));
      setGroups(cache);
    }).catch(() => setGroups([]));
  }, [standard]);
  const reloadPacks = () => loadCustomPacks().then((p) => { packsCache = p; setPacks(p); }).catch(() => setPacks((x) => x ?? []));
  useEffect(() => { void reloadPacks(); }, []);

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
  const pickCustom = (e: CustomEmoji) => {
    if (held.current) { held.current = false; return; }
    onPick(e.emoji || DEFAULT_FALLBACK, { id: e.id, url: e.file_url });
  };

  const removeCustom = async (pack: CustomPack, e: CustomEmoji) => {
    if (!pack.mine) return;
    if (!(await confirmDialog(t("Удалить этот эмодзи из набора «{name}»? В отправленных сообщениях он останется.", { name: pack.name })))) return;
    try { await api.deleteSticker(e.id); void reloadPacks(); }
    catch (err: any) { toast.error(err?.message || t("Не получилось")); }
  };
  // Долгое нажатие (телефон) и правый клик — удалить свой эмодзи.
  const holdProps = (pack: CustomPack, e: CustomEmoji) => pack.mine ? {
    onContextMenu: (ev: React.MouseEvent) => { ev.preventDefault(); void removeCustom(pack, e); },
    onPointerDown: () => { held.current = false; hold.current = setTimeout(() => { held.current = true; void removeCustom(pack, e); }, 550); },
    onPointerUp: () => { if (hold.current) clearTimeout(hold.current); },
    onPointerLeave: () => { if (hold.current) clearTimeout(hold.current); },
    onPointerCancel: () => { if (hold.current) clearTimeout(hold.current); },
  } : {};

  const createPack = async () => {
    const name = newName.trim();
    if (!name) return;
    try {
      // Выбор файлов не открываем сами: после запроса к серверу iOS это
      // заблокирует — картинки добавляют кнопкой «+» в новом наборе.
      await api.createStickerPack(name, undefined, true, "emoji");
      setCreating(false); setNewName("");
      await reloadPacks();
    } catch (err: any) { toast.error(err?.message || t("Не получилось")); }
  };

  // Свои эмодзи — из обычных картинок, по одной или пачкой; сервер ужмёт до 100 px.
  const addFiles = async (files: FileList | null) => {
    const packId = addTo.current;
    if (!files?.length || !packId) return;
    const list = Array.from(files);
    const pack = (packs || []).find((p) => p.id === packId);
    let order = pack?.items.length || 0;
    setUploading({ pack: packId, done: 0, total: list.length });
    for (const [i, f] of list.entries()) {
      try {
        const up = await api.uploadSticker(f, "emoji");
        await api.createSticker(packId, up.file_url, up.file_name, order++, "", DEFAULT_FALLBACK);
      } catch (err: any) { toast.error(`${f.name}: ${err?.message || t("Не получилось")}`); }
      setUploading({ pack: packId, done: i + 1, total: list.length });
    }
    setUploading(null);
    if (fileRef.current) fileRef.current.value = "";
    void reloadPacks();
  };

  const sharePack = async (p: CustomPack) => {
    const r = await shareEmojiPack(p.name, p.id);
    if (r === "copied") toast.success(t("Ссылка скопирована"));
    else if (r === "error") toast.error(t("Не удалось поделиться"));
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

  const customPacks = packs || [];
  const filteredPacks = q.trim()
    ? [] // поиск — по обычным эмодзи; свои ищутся глазами в своих наборах
    : customPacks;

  return (
    <div className={cn("flex flex-col min-h-0", className)}>
      <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp" multiple className="hidden"
        onChange={(e) => void addFiles(e.target.files)} />
      {standard && (
        <div className="px-2 pt-2 shrink-0">
          <label className="flex items-center gap-2 h-9 px-3 rounded-md bg-surface-4">
            <Search className="w-4 h-4 text-subtle shrink-0" />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t("Найти эмодзи")}
              className="flex-1 min-w-0 bg-transparent outline-none text-small" />
            {q && <button type="button" onClick={() => setQ("")} aria-label={t("Очистить")} className="text-subtle"><X className="w-4 h-4" /></button>}
          </label>
        </div>
      )}
      {!found && (
        <div className="flex gap-0.5 px-2 pt-1.5 shrink-0 overflow-x-auto [scrollbar-width:none]">
          {customPacks.map((p) => (
            <button key={p.id} type="button" onClick={() => jump(`p${p.id}`)} title={p.name}
              className="w-8 h-8 shrink-0 rounded-md flex items-center justify-center hover:bg-surface-4">
              {p.items[0] ? <img src={mediaUrl(p.items[0].file_url)} alt="" className="w-5 h-5 object-contain" draggable={false} /> : <Smile className="w-4 h-4 text-subtle" />}
            </button>
          ))}
          {standard && !!recent.length && (
            <button type="button" onClick={() => jump("recent")} title={t("Недавние")} className="w-8 h-8 shrink-0 rounded-md flex items-center justify-center text-subtle hover:bg-surface-4">
              <Clock className="w-4 h-4" />
            </button>
          )}
          {(groups || []).map((g) => (
            <button key={g.group} type="button" onClick={() => jump(g.group)} title={t(GROUP_NAME[g.group] || g.group)}
              className="w-8 h-8 shrink-0 rounded-md flex items-center justify-center hover:bg-surface-4">
              <img src={notoSvgUrl(GROUP_ICON[g.group] || g.items[0]?.[0])} alt="" className="w-5 h-5 opacity-80" draggable={false} />
            </button>
          ))}
        </div>
      )}
      <div ref={scroller} className="relative flex-1 min-h-0 overflow-y-auto px-1.5 py-1.5">
        {found ? (
          found.length ? <div className="flex flex-wrap">{found.map(cell)}</div>
            : <p className="text-small text-subtle text-center py-6">{t("Ничего не найдено")}</p>
        ) : (
          <>
            {/* Свои наборы эмодзи */}
            {filteredPacks.map((p) => (
              <div key={p.id} ref={(el) => { sections.current[`p${p.id}`] = el; }}>
                <div className="flex items-center gap-1 px-1 pt-1 pb-0.5">
                  <p className="flex-1 min-w-0 truncate text-caption text-subtle">{p.name}</p>
                  <button type="button" onClick={() => void sharePack(p)} className="p-1 text-subtle hover:text-foreground" aria-label={t("Поделиться")}>
                    <Share2 className="w-3.5 h-3.5" />
                  </button>
                </div>
                <div className="flex flex-wrap">
                  {p.items.map((e) => (
                    <button key={e.id} type="button" onClick={() => pickCustom(e)} title={e.emoji || ""} {...holdProps(p, e)}
                      className="w-10 h-10 rounded-md flex items-center justify-center hover:bg-surface-4 active:scale-95 transition-transform select-none [-webkit-touch-callout:none]">
                      <img src={mediaUrl(e.file_url)} alt={e.emoji || ""} loading="lazy" draggable={false} className="w-7 h-7 object-contain pointer-events-none" />
                    </button>
                  ))}
                  {p.mine && (
                    <button type="button" disabled={!!uploading} onClick={() => { addTo.current = p.id; fileRef.current?.click(); }}
                      className="w-10 h-10 rounded-md flex items-center justify-center border border-dashed border-border text-subtle hover:text-foreground disabled:opacity-50"
                      aria-label={t("Добавить эмодзи")} title={t("Добавить эмодзи")}>
                      {uploading?.pack === p.id ? <span className="text-[10px] tabular-nums">{uploading.done}/{uploading.total}</span> : <Plus className="w-4 h-4" />}
                    </button>
                  )}
                </div>
                {p.mine && !p.items.length && (
                  <p className="px-1 pb-1 text-caption text-subtle">{t("Добавьте картинки — PNG, JPG или WebP. Удалить свой эмодзи — долгое нажатие или правый клик.")}</p>
                )}
              </div>
            ))}
            {/* Новый набор */}
            {creating ? (
              <div className="flex gap-1.5 px-1 py-1.5">
                <input autoFocus value={newName} onChange={(e) => setNewName(e.target.value)} maxLength={100}
                  onKeyDown={(e) => { if (e.key === "Enter") void createPack(); if (e.key === "Escape") setCreating(false); }}
                  placeholder={t("Название набора эмодзи")} className="flex-1 min-w-0 h-8 px-2 rounded-md bg-surface-4 outline-none text-small" />
                <button type="button" onClick={() => void createPack()} className="h-8 px-3 rounded-md bg-primary text-primary-foreground text-caption font-semibold">{t("Создать")}</button>
                <button type="button" onClick={() => setCreating(false)} className="h-8 w-8 rounded-md bg-surface-4 flex items-center justify-center" aria-label={t("Отмена")}><X className="w-4 h-4" /></button>
              </div>
            ) : (
              <button type="button" onClick={() => setCreating(true)}
                className="mx-1 my-1 h-8 px-3 rounded-md border border-dashed border-border text-caption text-subtle hover:text-foreground inline-flex items-center gap-1.5">
                <Plus className="w-3.5 h-3.5" /> {t("Набор своих эмодзи")}
              </button>
            )}
            {!standard && !customPacks.length && packs && (
              <p className="px-1 pb-2 text-caption text-subtle">{t("Свои эмодзи — из ваших картинок: создайте набор и добавьте их. Обычные эмодзи — на клавиатуре телефона.")}</p>
            )}

            {standard && !!recent.length && (
              <div ref={(el) => { sections.current.recent = el; }}>
                <p className="px-1 pt-2 pb-0.5 text-caption text-subtle">{t("Недавние")}</p>
                <div className="flex flex-wrap">{recent.map(cell)}</div>
              </div>
            )}
            {standard && !groups && <p className="text-small text-subtle text-center py-6">{t("Загрузка…")}</p>}
            {(groups || []).map((g) => (
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
