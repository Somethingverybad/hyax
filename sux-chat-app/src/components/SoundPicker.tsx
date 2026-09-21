import { useEffect, useMemo, useRef, useState } from "react";
import { Check, ChevronDown, Play, Search, Share2, Square, X } from "lucide-react";
import { api, mediaUrl, type NotificationSoundInfo } from "@/api/client";
import { playSfx } from "@/lib/sfx";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { shareSoundPack } from "@/lib/share";

/**
 * Выбор звука уведомлений из общего каталога — один компонент на все места:
 * «мой звук» в профиле и звук канала в его настройках.
 *
 * Каталог уже под сотню звуков, поэтому не вываливаем его одним списком:
 * сверху поиск, ниже — паки сворачивающимися секциями. Раскрыт тот, где лежит
 * выбранный сейчас звук (и все подходящие — когда идёт поиск). Звук можно
 * послушать, не выбирая; «Без звука» возвращает обычный.
 */
const NO_PACK = "Отдельные звуки";

const SoundRow = ({ sound, selected, onPick }: {
  sound: NotificationSoundInfo | null; selected: boolean; onPick: () => void;
}) => {
  const stopRef = useRef<(() => void) | null>(null);
  const [playing, setPlaying] = useState(false);
  const toggle = () => {
    stopRef.current?.();
    if (playing || !sound) { setPlaying(false); return; }
    setPlaying(true);
    playSfx(mediaUrl(sound.url), { volume: 0.7, tap: true, onEnded: () => setPlaying(false) })
      .then((stop) => { stopRef.current = stop; })
      .catch(() => setPlaying(false));
  };
  useEffect(() => () => stopRef.current?.(), []);
  return (
    <div className={cn("flex items-center gap-2 px-3 h-12 border-b border-border/60", selected && "bg-primary/10")}>
      <button type="button" onClick={toggle} disabled={!sound} className="w-8 h-8 shrink-0 flex items-center justify-center rounded-md bg-surface-4 disabled:opacity-30">
        {playing ? <Square className="w-4 h-4" /> : <Play className="w-4 h-4" />}
      </button>
      <button type="button" onClick={onPick} className="flex-1 min-w-0 text-left">
        <span className="block text-body truncate">{sound ? sound.name : "Без звука"}</span>
      </button>
      {selected && <Check className="w-4 h-4 text-primary shrink-0" />}
    </div>
  );
};

const SoundPicker = ({ title, current, onPick, onClose }: {
  /** Заголовок шторки: у профиля и у канала он разный. */
  title: string;
  current: string | null;
  onPick: (s: NotificationSoundInfo | null) => void;
  onClose: () => void;
}) => {
  const [sounds, setSounds] = useState<NotificationSoundInfo[] | null>(null);
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState<Set<string>>(new Set());
  // Долгое нажатие по названию пака (правая кнопка на десктопе) — поделиться.
  // Меню показываем под самим заголовком пака, без отдельного экрана.
  const [menuFor, setMenuFor] = useState<string | null>(null);
  const holdRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const heldRef = useRef(false);

  const share = async (name: string, id: string | null | undefined) => {
    setMenuFor(null);
    if (!id) { toast.error("У этого пака нет ссылки"); return; }
    const r = await shareSoundPack(name, id);
    if (r === "copied") toast.success("Ссылка скопирована");
    else if (r === "error") toast.error("Не удалось поделиться");
  };

  useEffect(() => { api.getNotificationSounds().then(setSounds).catch(() => setSounds([])); }, []);

  // Раскрываем пак с выбранным звуком — чтобы было видно, что стоит сейчас.
  useEffect(() => {
    if (!sounds || !current) return;
    const mine = sounds.find((s) => s.id === current);
    if (mine) setOpen((prev) => new Set(prev).add(mine.pack_name || NO_PACK));
  }, [sounds, current]);

  const q = query.trim().toLowerCase();
  const groups = useMemo(() => {
    const list = (sounds || []).filter((s) =>
      !q || s.name.toLowerCase().includes(q) || (s.pack_name || "").toLowerCase().includes(q));
    const by = new Map<string, NotificationSoundInfo[]>();
    for (const s of list) {
      const key = s.pack_name || NO_PACK;
      by.set(key, [...(by.get(key) || []), s]);
    }
    // Паки по алфавиту, «отдельные» — в конец.
    return [...by.entries()].sort(([a], [b]) =>
      a === NO_PACK ? 1 : b === NO_PACK ? -1 : a.localeCompare(b, "ru"));
  }, [sounds, q]);

  const found = groups.reduce((n, [, list]) => n + list.length, 0);

  return (
    <div className="fixed inset-0 z-[90] bg-black/60 flex items-end md:items-center md:justify-center" onClick={onClose}>
      <div className="w-full md:w-[420px] max-h-[80vh] bg-surface-2 rounded-t-[16px] md:rounded-lg flex flex-col pb-[var(--sab)]" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-2 px-4 h-14 shrink-0">
          <span className="text-h2 flex-1 truncate">{title}</span>
          <button type="button" onClick={onClose} className="p-1.5 text-subtle" aria-label="Закрыть"><X className="w-4 h-4" /></button>
        </div>

        <div className="px-3 pb-2 shrink-0">
          <div className="flex items-center gap-2 h-10 px-3 rounded-lg bg-surface-4">
            <Search className="w-4 h-4 text-subtle shrink-0" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Поиск по звукам и пакам"
              className="flex-1 min-w-0 bg-transparent outline-none text-body"
              autoCapitalize="off"
              autoCorrect="off"
            />
            {query && (
              <button type="button" onClick={() => setQuery("")} className="p-1 text-subtle" aria-label="Очистить">
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
        </div>

        <div className="overflow-y-auto">
          {!q && <SoundRow sound={null} selected={!current} onPick={() => onPick(null)} />}
          {sounds === null && <p className="px-4 py-6 text-small text-subtle text-center">Загрузка…</p>}
          {sounds && !found && (
            <p className="px-4 py-6 text-small text-subtle text-center">
              {q ? "Ничего не нашлось" : "Каталог звуков пуст"}
            </p>
          )}

          {groups.map(([pack, list]) => {
            // При поиске секции раскрыты: иначе найденное пришлось бы ещё разворачивать.
            const expanded = !!q || open.has(pack);
            return (
              <div key={pack}>
                <button
                  type="button"
                  onClick={() => {
                    // После долгого нажатия тап не должен ещё и свернуть пак.
                    if (heldRef.current) { heldRef.current = false; return; }
                    setOpen((prev) => {
                      const next = new Set(prev);
                      next.has(pack) ? next.delete(pack) : next.add(pack);
                      return next;
                    });
                  }}
                  onContextMenu={(e) => { e.preventDefault(); setMenuFor(menuFor === pack ? null : pack); }}
                  onTouchStart={() => {
                    heldRef.current = false;
                    holdRef.current = setTimeout(() => { heldRef.current = true; setMenuFor(pack); }, 450);
                  }}
                  onTouchEnd={() => clearTimeout(holdRef.current)}
                  onTouchMove={() => clearTimeout(holdRef.current)}
                  className="w-full sticky top-0 z-10 flex items-center gap-2 px-3 h-10 bg-surface-3 border-b border-border/60 text-left"
                >
                  <ChevronDown className={cn("w-4 h-4 text-subtle transition-transform", !expanded && "-rotate-90")} />
                  <span className="flex-1 min-w-0 truncate text-small font-medium">{pack}</span>
                  <span className="text-caption text-subtle">{list.length}</span>
                </button>
                {menuFor === pack && (
                  <div className="px-3 py-2 flex gap-2 bg-surface-3/60 border-b border-border/60">
                    <button
                      type="button"
                      onClick={() => share(pack, list[0]?.pack)}
                      className="h-9 px-3 rounded-md bg-primary text-primary-foreground text-small font-medium inline-flex items-center gap-1.5"
                    >
                      <Share2 className="w-4 h-4" /> Поделиться паком
                    </button>
                    <button type="button" onClick={() => setMenuFor(null)} className="h-9 px-3 rounded-md bg-surface-4 text-small font-medium">Отмена</button>
                  </div>
                )}
                {expanded && list.map((s) => (
                  <SoundRow key={s.id} sound={s} selected={current === s.id} onPick={() => onPick(s)} />
                ))}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
};

export default SoundPicker;
