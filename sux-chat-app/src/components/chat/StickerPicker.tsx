import { t } from "@/lib/i18n";
import { confirmDialog } from "@/lib/confirm";
import StickerView from "@/components/chat/StickerView";
import { useMint, MintIcon } from "@/themes/mint";
import { useEffect, useRef, useState } from "react";
import { Capacitor } from "@capacitor/core";
import { createPortal } from "react-dom";
import { api, mediaUrl } from "@/api/client";
import { playSfx } from "@/lib/sfx";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { Plus, Music2, Play, Square, Check, ChevronLeft, ChevronRight, Pencil, Trash2, MoreHorizontal, Share2, Sparkles, Users, Smile, Brush, Clock } from "lucide-react";
import EmojiPanel from "@/components/chat/EmojiPanel";
import { shareStickerPack } from "@/lib/share";
import ImageCropper from "@/components/ImageCropper";
import { readCache } from "@/lib/session-cache";
import { invalidateStickerIndex } from "@/lib/stickerIndex";
import type { NotificationSoundInfo, ChatActionInfo } from "@/api/client";
import { ActionGrid } from "@/components/chat/ActionSheet";
import { isAnimatedFile } from "@/lib/animMedia";
import { useScrollMemory } from "@/lib/scrollMemory";

interface Sticker {
  id: string;
  pack: string;
  pack_name: string;
  file_url: string;
  file_name: string;
  emoji?: string;
  /** Макрос: слово, эмодзи или символ — по нему стикер подсказывается при наборе. */
  keyword?: string;
}

interface UserStickerPack {
  id: string;
  pack: {
    id: string;
    name: string;
    stickers_count: number;
    /** Совместный набор: добавлять могут все, кто его сохранил. */
    open_add?: boolean;
    author?: { id: string } | string | null;
  };
}

interface StickerPickerProps {
  /** burst — стикер выбрали долгим удержанием: у получателя он «высыплется» по экрану. */
  onSelect: (sticker: Sticker, burst?: boolean) => void;
  /** Аудио-стикеры живут в этой же панели: отдельная кнопка рядом со
   *  стикерами дробила один и тот же сценарий «отправить что-то забавное». */
  sounds?: NotificationSoundInfo[];
  selectedSoundId?: string | null;
  onSelectSound?: (sound: NotificationSoundInfo | null) => void;
  /** Действия («подмигнуть», «обнять»): третья вкладка; нет — вкладка скрыта. */
  onSelectAction?: (action: ChatActionInfo) => void;
  /** Вкладка «Эмодзи»: вставка в поле ввода — свои наборы (картинки) и, если
   *  standardEmoji, эмодзи Noto; нет — вкладки нет. */
  onInsertEmoji?: (emoji: string, custom?: { id: string; url?: string }) => void;
  /** Эмодзи Noto во вкладке — на десктопе: на телефоне они есть в клавиатуре. */
  standardEmoji?: boolean;
  /** Кисть в полосе наборов — нарисовать граффити (components/chat/Graffiti). */
  onDraw?: () => void;
}

type PickerTab = "emoji" | "stickers" | "sounds" | "actions";
const TAB_KEY = "hyax:picker-tab";

/**
 * Панель стикеров в стиле мессенджеров: наборы полосой сверху, сетка снизу.
 *
 * Портирована из веб-версии, но упрощена под телефон: управление наборами
 * (создание, импорт, удаление) осталось в вебе — на маленьком экране это
 * отдельный сценарий, который мешал бы основному.
 */
/** Кэш между открытиями окна стикеров (живёт, пока открыто приложение). */
const PACK_KEY = "hyax:picker-pack";
const pickerCache: { packs: UserStickerPack[] | null; lastPackId: string | null; stickers: Map<string, Sticker[]> } = {
  // Последний открытый набор — и между запусками приложения.
  packs: null, lastPackId: (() => { try { return localStorage.getItem(PACK_KEY); } catch { return null; } })(), stickers: new Map(),
};
/** «Недавние» — первая вкладка полосы наборов: что человек отправляет чаще
 *  всего (сервер считает по его сообщениям, /stickers/recent/). Отправил
 *  стикер — он сразу встаёт первым, не дожидаясь сервера. */
const RECENT = "__recent__";
const RECENT_MAX = 30;
function bumpRecent(s: Sticker) {
  const cur = pickerCache.stickers.get(RECENT) || [];
  pickerCache.stickers.set(RECENT, [s, ...cur.filter((x) => x.id !== s.id)].slice(0, RECENT_MAX));
}
/** Наборы поменялись не из панели (например, первое граффити завело «Мои
 *  граффити») — при следующем открытии перечитать. */
export function forgetStickerPacks(packId?: string) {
  pickerCache.packs = null;
  if (packId) { pickerCache.stickers.delete(packId); pickerCache.lastPackId = packId; }
}
const activePackIdInit = (): string | null => {
  // Наборы ещё не загружены (первое открытие после запуска) — запомненный;
  // когда список придёт, его сверят с ним (load).
  if (!pickerCache.packs || pickerCache.lastPackId === RECENT) return pickerCache.lastPackId;
  const list = pickerCache.packs;
  return list.some((p) => p.pack.id === pickerCache.lastPackId) ? pickerCache.lastPackId : list[0]?.pack?.id ?? null;
};

const StickerPicker = ({
  onSelect,
  sounds = [],
  selectedSoundId = null,
  onSelectSound,
  onSelectAction,
  onInsertEmoji,
  standardEmoji = true,
  onDraw,
}: StickerPickerProps) => {
  // Последняя открытая вкладка; есть эмодзи — по умолчанию они (как в мессенджерах).
  const [tab, setTabState] = useState<PickerTab>(() => {
    let saved: string | null = null;
    try { saved = localStorage.getItem(TAB_KEY); } catch { /* приватный режим */ }
    if (saved === "emoji" && !onInsertEmoji) saved = null;
    if (saved === "actions" && !onSelectAction) saved = null;
    // На телефоне во вкладке только свои эмодзи — первыми показываем стикеры.
    return (saved as PickerTab) || (onInsertEmoji && standardEmoji ? "emoji" : "stickers");
  });
  const setTab = (v: PickerTab) => { setTabState(v); try { localStorage.setItem(TAB_KEY, v); } catch { /* приватный режим */ } };
  // Долгое удержание стикера (burst): таймер и флаг, чтобы click после него не сработал.
  const holdRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const holdFiredRef = useRef(false);
  const [soundView, setSoundView] = useState<string | null>(() => {
    try { return localStorage.getItem("sound_pack") || null; } catch { return null; }
  });
  const [soundQuery, setSoundQuery] = useState("");
  // Поиск на экране выбора паков: ищет по всем звукам сразу, без захода внутрь.
  const [packMenuQuery, setPackMenuQuery] = useState("");
  const enterPack = (name: string) => {
    setSoundView(name); setSoundQuery("");
    try { localStorage.setItem("sound_pack", name); } catch { /* ignore */ }
  };
  const backToPacks = () => { setSoundView(null); setSoundQuery(""); };
  // Прослушивание — отдельной кнопкой: раньше звук играл на каждый тап,
  // включая снятие выбора, и панель превращалась в какофонию.
  const previewRef = useRef<(() => void) | null>(null);
  const [playingId, setPlayingId] = useState<string | null>(null);

  const preview = (sound: NotificationSoundInfo) => {
    previewRef.current?.();
    if (playingId === sound.id) {
      setPlayingId(null);
      return;
    }
    setPlayingId(sound.id);
    playSfx(mediaUrl(sound.url), { volume: 0.7, tap: true, onEnded: () => setPlayingId(null) })
      .then((stop) => { previewRef.current = stop; })
      .catch(() => setPlayingId(null));
  };

  useEffect(() => () => previewRef.current?.(), []);

  // Окно монтируется заново при каждом открытии — показываем запомненное
  // сразу (иначе стикеры на секунду пропадали), свежее подтягиваем фоном.
  const [packs, setPacks] = useState<UserStickerPack[]>(() => pickerCache.packs || []);
  const [activePackId, setActivePackId] = useState<string | null>(activePackIdInit);
  const [stickers, setStickers] = useState<Sticker[]>(() => (activePackIdInit() && pickerCache.stickers.get(activePackIdInit()!)) || []);
  const [loading, setLoading] = useState(() => !pickerCache.packs);
  // Открыли панель снова — каждый список на том же месте, что в прошлый раз
  // (lib/scrollMemory); в поиске — с начала.
  const stickerScroll = useScrollMemory(activePackId ? `stickers:${activePackId}` : null);
  const stripScroll = useScrollMemory("stickers:strip", "x");
  const soundPacksScroll = useScrollMemory(packMenuQuery.trim() ? null : "sounds");
  const soundListScroll = useScrollMemory(soundView && !soundQuery.trim() ? `sounds:${soundView}` : null);
  const actionsScroll = useScrollMemory("actions");
  // Создание набора: имя вводится один раз, дальше выбираются файлы.
  const [creating, setCreating] = useState(false);
  const [newPackName, setNewPackName] = useState("");
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const loadPacks = async (selectId?: string) => {
    try {
      // Наборы своих эмодзи живут во вкладке «Эмодзи», не среди стикеров.
      const list = ((await api.getMyStickerPacks()) || []).filter((p: UserStickerPack) => (p.pack as { kind?: string })?.kind !== "emoji");
      pickerCache.packs = list;
      setPacks(list);
      setActivePackId((prev) => selectId ?? (prev && (prev === RECENT || list.some((p: UserStickerPack) => p.pack.id === prev)) ? prev : list[0]?.pack?.id ?? null));
    } catch {
      setPacks([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadPacks();
  }, []);

  // Добавление — по одному файлу: кадрирование (квадрат 512), потом макрос,
  // потом загрузка. Очередь из выбранных файлов идёт по кругу, пока не кончится.
  const [queue, setQueue] = useState<File[]>([]);
  const [cropping, setCropping] = useState<File | null>(null);
  const [asking, setAsking] = useState<File | null>(null); // кадрированный, ждёт макрос
  const [keyword, setKeyword] = useState("");
  const addedRef = useRef(0);
  const addFiles = (files: FileList | null) => {
    if (!files?.length || !activePackId) return;
    const list = Array.from(files);
    if (fileRef.current) fileRef.current.value = "";
    addedRef.current = 0;
    setQueue(list.slice(1));
    take(list[0]);
  };
  // GIF и видео не кадрируем (обрезка картинкой убила бы анимацию) — сразу
  // к макросу; сервер сам впишет в 512 и переведёт в mp4 до 5 секунд.
  const take = (f: File) => {
    if (isAnimatedFile(f)) { setKeyword(""); setAsking(f); }
    else setCropping(f);
  };
  const nextInQueue = async (rest: File[]) => {
    const [head, ...tail] = rest;
    setQueue(tail);
    if (head) { take(head); return; }
    if (addedRef.current) {
      toast.success(t("Добавлено: {n}", { n: addedRef.current }));
      invalidateStickerIndex();
      if (activePackId) setStickers((await api.getStickers(activePackId)) || []);
    }
  };
  const uploadOne = async (file: File, kw: string) => {
    if (!activePackId) return;
    setBusy(true);
    try {
      const up = await api.uploadSticker(file);
      await api.createSticker(activePackId, up.file_url, up.file_name, stickers.length + addedRef.current, kw);
      addedRef.current += 1;
    } catch (e: any) {
      toast.error(e?.message || t("Стикер не загрузился"));
    } finally {
      setBusy(false);
    }
    await nextInQueue(queue);
  };

  // Автор набора может править макрос и удалять стикеры: режим правки —
  // карандаш в шапке, тап по стикеру открывает форму вместо отправки.
  const meId = readCache<{ id: string }>("user")?.id;
  const activePack = packs.find((p) => p.pack.id === activePackId)?.pack;
  // Меню набора: поделиться ссылкой, удалить свой или убрать чужой из моих.
  const [packMenu, setPackMenu] = useState(false);
  type PackLike = NonNullable<typeof activePack>;
  const authorOf = (pk?: PackLike | null) => (pk?.author && typeof pk.author === "object" ? pk.author.id : (pk?.author as string | undefined));
  const isAuthorOf = (pk?: PackLike | null) => { const a = authorOf(pk); return !!meId && !!a && meId === a; };
  const sharePack = async (pk: PackLike | undefined = activePack) => {
    setPackMenu(false); setCtxPack(null);
    if (!pk) return;
    const r = await shareStickerPack(pk.name, pk.id);
    if (r === "copied") toast.success(t("Ссылка скопирована"));
    else if (r === "error") toast.error(t("Не удалось поделиться"));
  };
  const removePack = async (mine: boolean, pk: PackLike | undefined = activePack) => {
    setPackMenu(false); setCtxPack(null);
    if (!pk) return;
    if (!(await confirmDialog(mine ? t("Удалить набор «{name}» у всех, кто его сохранил? Это необратимо.", { name: pk.name }) : t("Убрать «{name}» из моих наборов?", { name: pk.name })))) return;
    try {
      if (mine) await api.deleteStickerPack(pk.id); else await api.unsaveStickerPack(pk.id);
      pickerCache.stickers.delete(pk.id);
      invalidateStickerIndex();
      await loadPacks();
      toast.success(mine ? t("Набор удалён") : t("Убрано из моих"));
    } catch (e: any) { toast.error(e?.message || t("Не получилось")); }
  };
  const isAuthor = isAuthorOf(activePack);
  // Плитка «+»: автору всегда, остальным — если автор открыл набор для всех.
  const canAdd = isAuthor || !!activePack?.open_add;
  const toggleOpenAdd = async (pk: PackLike | undefined, open: boolean) => {
    if (!pk) return;
    // Сразу на экране, затем на сервер; ошибка — откат.
    const apply = (v: boolean) => setPacks((list) => list.map((x) => (x.pack.id === pk.id ? { ...x, pack: { ...x.pack, open_add: v } } : x)));
    apply(open);
    setCtxPack((c) => (c && c.pack.id === pk.id ? { ...c, pack: { ...c.pack, open_add: open } } : c));
    try {
      await api.setStickerPackOpenAdd(pk.id, open);
      toast.success(open ? t("Теперь добавлять стикеры могут все, у кого есть набор") : t("Добавлять стикеры можете только вы"));
    } catch (e: any) {
      apply(!open);
      toast.error(e?.message || t("Не удалось сохранить"));
    }
  };
  const openAddRow = (pk: PackLike) => (
    <label className="w-full px-4 py-3 text-left text-body flex items-center gap-3 active:bg-secondary cursor-pointer">
      <Users className="w-5 h-5 text-primary shrink-0" />
      <span className="flex-1 min-w-0">
        <span className="block">{t("Добавлять могут все, у кого есть набор")}</span>
        <span className="block text-caption text-subtle">{t("Менять и удалять стикеры можете только вы")}</span>
      </span>
      <input type="checkbox" className="w-5 h-5 accent-primary shrink-0" checked={!!pk.open_add}
        onChange={(e) => void toggleOpenAdd(pk, e.target.checked)} aria-label={t("Добавлять могут все, у кого есть набор")} />
    </label>
  );

  // Контекстное меню миниатюры набора: долгое нажатие (телефон) или правый
  // клик — «Поделиться стикерпаком» и убрать/удалить. Короткий тап, как и
  // раньше, переключает набор; сдвиг пальца (прокрутка ряда) меню не открывает.
  const [ctxPack, setCtxPack] = useState<{ pack: PackLike; x: number; y: number } | null>(null);
  const packHoldRef = useRef<{ timer: ReturnType<typeof setTimeout> | null; x: number; y: number; fired: boolean }>({ timer: null, x: 0, y: 0, fired: false });
  const openCtx = (pack: PackLike, x: number, y: number) => {
    setCtxPack({ pack, x, y });
    if (Capacitor.isNativePlatform()) import("@capacitor/haptics").then(({ Haptics, ImpactStyle }) => Haptics.impact({ style: ImpactStyle.Light })).catch(() => {});
  };
  const packHold = (pack: PackLike) => ({
    onPointerDown: (e: React.PointerEvent) => {
      if (e.pointerType === "mouse") return; // мышью — правый клик
      const h = packHoldRef.current;
      h.x = e.clientX; h.y = e.clientY; h.fired = false;
      if (h.timer) clearTimeout(h.timer);
      h.timer = setTimeout(() => { h.timer = null; h.fired = true; openCtx(pack, h.x, h.y); }, 500);
    },
    onPointerMove: (e: React.PointerEvent) => {
      const h = packHoldRef.current;
      if (h.timer && (Math.abs(e.clientX - h.x) > 8 || Math.abs(e.clientY - h.y) > 8)) { clearTimeout(h.timer); h.timer = null; }
    },
    onPointerUp: () => { const h = packHoldRef.current; if (h.timer) { clearTimeout(h.timer); h.timer = null; } },
    onPointerCancel: () => { const h = packHoldRef.current; if (h.timer) { clearTimeout(h.timer); h.timer = null; } },
    onContextMenu: (e: React.MouseEvent) => {
      e.preventDefault();
      // Android шлёт contextmenu и на долгом касании — меню уже открыто таймером.
      if (packHoldRef.current.fired) return;
      packHoldRef.current.fired = true;
      openCtx(pack, e.clientX, e.clientY);
    },
  });
  const [editMode, setEditMode] = useState(false);
  const [editing, setEditing] = useState<Sticker | null>(null);
  const [editKeyword, setEditKeyword] = useState("");
  const saveEdit = async () => {
    if (!editing) return;
    setBusy(true);
    try {
      await api.updateSticker(editing.id, { keyword: editKeyword.trim() });
      setStickers((prev) => prev.map((x) => (x.id === editing.id ? { ...x, keyword: editKeyword.trim() } : x)));
      invalidateStickerIndex();
      setEditing(null);
    } catch (e: any) { toast.error(e?.message || t("Не удалось сохранить")); }
    finally { setBusy(false); }
  };
  const deleteEditing = async () => {
    if (!editing) return;
    setBusy(true);
    try {
      await api.deleteSticker(editing.id);
      setStickers((prev) => prev.filter((x) => x.id !== editing.id));
      invalidateStickerIndex();
      setEditing(null);
      toast.success(t("Стикер удалён"));
    } catch (e: any) { toast.error(e?.message || t("Не удалось удалить")); }
    finally { setBusy(false); }
  };

  const createPack = async () => {
    const name = newPackName.trim();
    if (!name) return;
    setBusy(true);
    try {
      const pack = await api.createStickerPack(name);
      setNewPackName("");
      setCreating(false);
      await loadPacks(pack.id);
      toast.success(t("Набор создан — теперь добавьте стикеры"));
    } catch (e: any) {
      toast.error(e?.message || t("Не удалось создать набор"));
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    if (activePackId) {
      pickerCache.lastPackId = activePackId;
      try { localStorage.setItem(PACK_KEY, activePackId); } catch { /* приватный режим */ }
    }
    if (!activePackId) {
      setStickers([]);
      return;
    }
    let alive = true;
    setStickers(pickerCache.stickers.get(activePackId) || []);
    (async () => {
      try {
        const list = (activePackId === RECENT ? await api.getRecentStickers() : await api.getStickers(activePackId)) || [];
        pickerCache.stickers.set(activePackId, list);
        if (alive) setStickers(list);
      } catch {
        if (alive && !pickerCache.stickers.has(activePackId)) setStickers([]);
      }
    })();
    return () => { alive = false; };
  }, [activePackId]);
  // Правки в открытом паке (добавили, удалили, сменили макрос) — тоже в кэш.
  useEffect(() => { if (activePackId) pickerCache.stickers.set(activePackId, stickers); }, [stickers, activePackId]);

  const mint = useMint();
  // «Мята»: переключатель «Стикеры | Звуки» — белая таблетка внизу панели.
  const segs: { id: PickerTab; label: string; w: number }[] = [
    ...(onInsertEmoji ? [{ id: "emoji" as const, label: "Эмодзи", w: 0 }] : []),
    { id: "stickers" as const, label: "Стикеры", w: 0 },
    { id: "sounds" as const, label: "Звуки", w: 0 },
    ...(onSelectAction ? [{ id: "actions" as const, label: "Действия", w: 0 }] : []),
  ];
  // Ширины сегментов — по длине подписи, в сумме 100%.
  { const total = segs.reduce((a, x) => a + x.label.length + 2, 0); segs.forEach((x) => { x.w = ((x.label.length + 2) / total) * 100; }); }
  const segLeft = segs.slice(0, Math.max(0, segs.findIndex((x) => x.id === tab))).reduce((a, x) => a + x.w, 0);
  const segW = segs.find((x) => x.id === tab)?.w ?? segs[0].w;
  const mintTabs = (
    <div className="absolute left-0 right-0 bottom-[12px] flex justify-center z-10 pointer-events-none">
      <div className="mint-pill pointer-events-auto relative h-[28px] flex text-[12px] font-medium mint-ink overflow-hidden" style={{ width: `${segs.length * 74}px` }}>
        <span aria-hidden className="absolute top-0 bottom-0 rounded-full transition-all duration-300"
          style={{ background: "rgb(52 92 84 / 0.15)", left: `${segLeft}%`, width: `${segW}%` }} />
        {segs.map((x) => (
          <button key={x.id} type="button" onClick={() => setTab(x.id)} className="relative" style={{ width: `${x.w}%` }}>{t(x.label)}</button>
        ))}
      </div>
    </div>
  );
  const tabs = mint ? mintTabs : (
    <div className="flex gap-2 px-3 pt-2 shrink-0">
      {onInsertEmoji && (
        <button
          type="button"
          onClick={() => setTab("emoji")}
          className={cn(
            "flex-1 py-1.5 text-xs font-semibold flex items-center justify-center gap-1.5",
            tab === "emoji" ? "bg-primary text-primary-foreground" : "bg-secondary text-muted-foreground",
          )}
        >
          <Smile className="w-3.5 h-3.5" />
          {t("Эмодзи")}
        </button>
      )}
      <button
        type="button"
        onClick={() => setTab("stickers")}
        className={cn(
          "flex-1 py-1.5 text-xs font-semibold",
          tab === "stickers" ? "bg-primary text-primary-foreground" : "bg-secondary text-muted-foreground",
        )}
      >
        {t("Стикеры")}
      </button>
      <button
        type="button"
        onClick={() => setTab("sounds")}
        className={cn(
          "flex-1 py-1.5 text-xs font-semibold flex items-center justify-center gap-1.5",
          tab === "sounds" ? "bg-primary text-primary-foreground" : "bg-secondary text-muted-foreground",
        )}
      >
        <Music2 className="w-3.5 h-3.5" />
        {t("Звуки")}
      </button>
      {onSelectAction && (
        <button
          type="button"
          onClick={() => setTab("actions")}
          className={cn(
            "flex-1 py-1.5 text-xs font-semibold flex items-center justify-center gap-1.5",
            tab === "actions" ? "bg-primary text-primary-foreground" : "bg-secondary text-muted-foreground",
          )}
        >
          <Sparkles className="w-3.5 h-3.5" />
          {t("Действия")}
        </button>
      )}
    </div>
  );

  // Вкладка действий: сетка «эмодзи + название», тап — отправить.
  const actionsTab = (
    <div className={cn("flex flex-col relative", mint ? "h-[328px] pb-[52px] mint-sticker-panel" : "h-64")}>
      {tabs}
      <div ref={actionsScroll} className="flex-1 overflow-y-auto">
        <ActionGrid compact onPick={(a) => onSelectAction?.(a)} />
      </div>
    </div>
  );


  // Паки аудио-стикеров и их содержимое.
  // «Разное» — служебное имя для звуков без пака (его же отдаёт сервер): переводим только его.
  const packLabel = (n: string) => (n === "Разное" ? t("Разное") : n);
  const soundPackNames = Array.from(new Set(sounds.map((s) => s.pack_name || "Разное")));
  const packCount = (name: string) => sounds.filter((s) => (s.pack_name || "Разное") === name).length;
  const inPack = soundView && soundPackNames.includes(soundView) ? soundView : null;
  const q = soundQuery.trim().toLowerCase();
  const packSounds = inPack
    ? sounds.filter((s) => (s.pack_name || "Разное") === inPack && (!q || s.name.toLowerCase().includes(q)))
    : [];
  // Глобальный поиск на экране паков.
  const gq = packMenuQuery.trim().toLowerCase();
  const globalMatches = gq
    ? sounds.filter((s) => s.name.toLowerCase().includes(gq))
    : [];

  const soundRow = (sound: NotificationSoundInfo, opts?: { showPack?: boolean }) => {
    const chosen = selectedSoundId === sound.id;
    return (
      <div
        key={sound.id}
        className={cn(
          "flex items-center gap-2 px-2 py-2 border-2",
          chosen ? "border-primary bg-primary/10" : "border-transparent bg-secondary/40",
        )}
      >
        <button
          type="button"
          onClick={() => preview(sound)}
          className="w-9 h-9 shrink-0 flex items-center justify-center bg-secondary"
          aria-label={playingId === sound.id ? t("Остановить") : t("Прослушать")}
        >
          {playingId === sound.id ? <Square className="w-4 h-4" /> : mint ? <MintIcon name="soundPlay" size={[13, 15]} /> : <Play className="w-4 h-4" />}
        </button>
        <button
          type="button"
          onClick={() => onSelectSound?.(chosen ? null : sound)}
          className="flex-1 min-w-0 text-left"
        >
          <span className="block text-sm truncate">{sound.name}</span>
          {opts?.showPack && (
            <span className="block text-[11px] text-muted-foreground truncate">
              {packLabel(sound.pack_name || "Разное")}
            </span>
          )}
        </button>
        {chosen && <Check className="w-4 h-4 text-primary shrink-0" />}
      </div>
    );
  };

  const soundsTab = (
    <div className={cn("flex flex-col relative", mint ? "h-[328px] pb-[52px] mint-sticker-panel" : "h-64")}>
      {tabs}
      {!inPack ? (
        // Меню выбора пака + глобальный поиск по звукам
        <>
          <div className={cn("shrink-0", mint ? "relative px-[11px] pt-[9px] pb-[6px]" : "px-2 py-1.5")}>
            {/* «Мята»: белая таблетка 28 px с лупой, как поиск звука в макете. */}
            {mint && <MintIcon name="search" size={[11, 13]} className="absolute left-[22px] top-[17px] mint-muted pointer-events-none" />}
            <input
              value={packMenuQuery}
              onChange={(e) => setPackMenuQuery(e.target.value)}
              placeholder={t("Поиск звука по всем пакам…")}
              className={mint ? "mint-pill w-full h-[28px] pl-[30px] pr-3 text-[12px] outline-none placeholder:text-[var(--mint-muted)]" : "w-full bg-secondary px-3 py-2 text-sm outline-none focus:ring-1 focus:ring-primary"}
              // Отступ под лупу — инлайном: правило .mint-sticker-panel input задаёт padding 0 14px.
              style={mint ? { paddingLeft: 30 } : undefined}
            />
          </div>
          <div ref={soundPacksScroll} className="flex-1 overflow-y-auto p-2 space-y-1">
            {gq ? (
              // Результаты поиска по всем пакам
              globalMatches.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-8">{t("Ничего не найдено")}</p>
              ) : (
                globalMatches.map((s) => soundRow(s, { showPack: true }))
              )
            ) : soundPackNames.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-8">{t("Звуков пока нет")}</p>
            ) : (
              soundPackNames.map((name) => (
                <button
                  key={name}
                  type="button"
                  onClick={() => enterPack(name)}
                  className="w-full flex items-center gap-2 px-2 py-3 border-2 border-transparent bg-secondary/40 text-left"
                >
                  <span className="w-9 h-9 shrink-0 flex items-center justify-center bg-secondary">
                    <Music2 className="w-4 h-4" />
                  </span>
                  <span className="flex-1 truncate text-sm font-medium">{packLabel(name)}</span>
                  <span className="text-xs text-muted-foreground">{packCount(name)}</span>
                  <ChevronRight className="w-4 h-4 text-muted-foreground shrink-0" />
                </button>
              ))
            )}
          </div>
        </>
      ) : (
        // Внутри пака: назад + поиск + звуки
        <>
          <div className="flex items-center gap-1 px-1.5 py-1.5 border-b border-border shrink-0">
            <button type="button" onClick={backToPacks} className="p-1.5" aria-label={t("К пакам")}>
              <ChevronLeft className="w-5 h-5" />
            </button>
            <span className="text-sm font-semibold truncate flex-1">{packLabel(inPack)}</span>
          </div>
          <div className={cn("shrink-0", mint ? "relative px-[11px] pt-[9px] pb-[6px]" : "px-2 py-1.5")}>
            {/* «Мята»: белая таблетка 28 px с лупой, как поиск звука в макете. */}
            {mint && <MintIcon name="search" size={[11, 13]} className="absolute left-[22px] top-[17px] mint-muted pointer-events-none" />}
            <input
              value={soundQuery}
              onChange={(e) => setSoundQuery(e.target.value)}
              placeholder={t("Поиск звука…")}
              className={mint ? "mint-pill w-full h-[28px] pl-[30px] pr-3 text-[12px] outline-none placeholder:text-[var(--mint-muted)]" : "w-full bg-secondary px-3 py-2 text-sm outline-none focus:ring-1 focus:ring-primary"}
              // Отступ под лупу — инлайном: правило .mint-sticker-panel input задаёт padding 0 14px.
              style={mint ? { paddingLeft: 30 } : undefined}
            />
          </div>
          <div ref={soundListScroll} className="flex-1 overflow-y-auto p-2 space-y-1">
            {packSounds.length === 0 && (
              <p className="text-sm text-muted-foreground text-center py-8">{t("Ничего не найдено")}</p>
            )}
            {packSounds.map((s) => soundRow(s))}
          </div>
        </>
      )}
    </div>
  );

  if (tab === "emoji" && onInsertEmoji) {
    return (
      <div className={cn("flex flex-col relative", mint ? "h-[328px] pb-[52px] mint-sticker-panel" : "h-72")}>
        {tabs}
        <EmojiPanel onPick={onInsertEmoji} standard={standardEmoji} className="flex-1" />
      </div>
    );
  }
  if (tab === "sounds") return soundsTab;
  if (tab === "actions" && onSelectAction) return actionsTab;

  if (loading) {
    return (
      <div className={cn("flex flex-col relative", mint ? "h-[328px] pb-[52px] mint-sticker-panel" : "h-64")}>
        {tabs}
        <div className="flex-1 flex items-center justify-center text-sm text-muted-foreground">
          {t("Загрузка стикеров…")}
        </div>
      </div>
    );
  }

  const createForm = (
    <div className="flex gap-2 px-3 py-2 border-b border-border shrink-0">
      <input
        value={newPackName}
        onChange={(e) => setNewPackName(e.target.value)}
        placeholder={t("Название набора")}
        className="flex-1 bg-secondary px-3 py-1.5 text-sm outline-none"
        autoFocus
      />
      <button
        type="button"
        onClick={createPack}
        disabled={busy || !newPackName.trim()}
        className="px-3 py-1.5 bg-primary text-primary-foreground text-xs font-semibold disabled:opacity-40"
      >
        {t("Создать")}
      </button>
      <button
        type="button"
        onClick={() => { setCreating(false); setNewPackName(""); }}
        className="px-3 py-1.5 bg-secondary text-xs"
      >
        {t("Отмена")}
      </button>
    </div>
  );

  if (packs.length === 0) {
    return (
      <div className={cn("flex flex-col relative", mint ? "h-[328px] pb-[52px] mint-sticker-panel" : "h-64")}>
        {tabs}
        {creating ? createForm : null}
        <div className="flex-1 flex flex-col items-center justify-center gap-3 px-6 text-center">
          <p className="text-sm text-muted-foreground">{t("Наборов пока нет")}</p>
          {!creating && (
            <button
              type="button"
              onClick={() => setCreating(true)}
              className="px-4 py-2 bg-primary text-primary-foreground text-sm font-semibold"
            >
              {t("Создать набор")}
            </button>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className={cn("flex flex-col relative", mint ? "h-[328px] pb-[52px] mint-sticker-panel" : "h-64")}>
      {tabs}
      {creating && createForm}

      {/* Полоса наборов */}
      <div ref={stripScroll} className={mint ? "flex items-center gap-[16px] mx-[11px] px-[8px] h-[49px] overflow-x-auto shrink-0 border-b border-[var(--mint-divider)]" : "flex gap-2 px-3 py-2 overflow-x-auto border-b border-border shrink-0"}>
        <button
          type="button"
          onClick={() => setCreating(true)}
          className="px-2.5 py-1.5 bg-secondary text-muted-foreground shrink-0"
          aria-label={t("Новый набор")}
        >
          <Plus className="w-4 h-4" />
        </button>
        {onDraw && (
          <button type="button" onClick={onDraw} aria-label={t("Нарисовать граффити")} title={t("Нарисовать граффити")}
            className={cn("shrink-0 w-8 h-8 rounded-full flex items-center justify-center", mint ? "mint-ink" : "bg-muted text-primary")}>
            <Brush className="w-4 h-4" />
          </button>
        )}
        {isAuthor && (
          <button
            type="button"
            onClick={() => setEditMode((v) => !v)}
            className={cn("shrink-0 w-8 h-8 rounded-full flex items-center justify-center", editMode ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground")}
            aria-label={editMode ? t("Готово") : t("Изменить стикеры")}
          >
            {editMode ? <Check className="w-4 h-4" /> : <Pencil className="w-4 h-4" />}
          </button>
        )}
        {activePack && (
          <button
            type="button"
            onClick={() => setPackMenu(true)}
            className={cn("shrink-0 w-8 h-8 rounded-full flex items-center justify-center", mint ? "mint-ink" : "bg-muted text-muted-foreground")}
            aria-label={t("Действия с набором")}
          >
            <MoreHorizontal className="w-4 h-4" />
          </button>
        )}
        <button
          type="button"
          onClick={() => setActivePackId(RECENT)}
          title={t("Недавние")}
          aria-label={t("Недавние")}
          aria-pressed={activePackId === RECENT}
          className={mint
            ? cn("shrink-0 w-[25px] h-[25px] rounded-[6px] flex items-center justify-center mint-ink transition-transform", activePackId === RECENT ? "ring-2 ring-[var(--mint-ink)] ring-offset-1 scale-110" : "opacity-80")
            : cn("px-3 py-1.5 rounded-full text-xs whitespace-nowrap transition-colors flex items-center gap-1", activePackId === RECENT ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground")}
        >
          <Clock className="w-3.5 h-3.5" />{!mint && t("Недавние")}
        </button>
        {packs.map((p) => (
          <button
            key={p.pack.id}
            type="button"
            onClick={() => {
              // Клик после долгого нажатия — это открытие меню, а не выбор набора.
              if (packHoldRef.current.fired) { packHoldRef.current.fired = false; return; }
              setActivePackId(p.pack.id);
            }}
            {...packHold(p.pack)}
            style={{ WebkitTouchCallout: "none", touchAction: "pan-x" }}
            title={p.pack.name}
            className={mint
              ? cn("shrink-0 w-[25px] h-[25px] rounded-[6px] overflow-hidden flex items-center justify-center text-[11px] font-semibold mint-ink transition-transform", activePackId === p.pack.id ? "ring-2 ring-[var(--mint-ink)] ring-offset-1 scale-110" : "opacity-80")
              : cn(
              "px-3 py-1.5 rounded-full text-xs whitespace-nowrap transition-colors",
              activePackId === p.pack.id
                ? "bg-primary text-primary-foreground"
                : "bg-muted text-muted-foreground",
            )}
          >
            {mint
              ? ((p.pack as { preview?: string[] }).preview?.[0]
                  ? <StickerView url={(p.pack as { preview?: string[] }).preview![0]} alt="" className="w-full h-full object-contain" />
                  : (p.pack.name || "?")[0])
              : p.pack.name}
          </button>
        ))}
      </div>

      {packMenu && activePack && createPortal(
        <div data-sticker-portal className="fixed inset-0 z-[90] bg-black/60 flex flex-col justify-end" onClick={() => setPackMenu(false)}>
          <div className="bg-card border-t-2 border-border pad-safe-bottom py-1" onClick={(e) => e.stopPropagation()}>
            <p className="px-4 pt-3 pb-2 text-small text-subtle truncate">{activePack.name}</p>
            <button type="button" onClick={() => void sharePack(activePack)} className="w-full px-4 py-3 text-left text-body flex items-center gap-3 active:bg-secondary">
              <Share2 className="w-5 h-5 text-primary" /> {t("Поделиться набором")}
            </button>
            {isAuthor && openAddRow(activePack)}
            <button type="button" onClick={() => void removePack(isAuthor, activePack)} className="w-full px-4 py-3 text-left text-body flex items-center gap-3 active:bg-secondary text-destructive">
              <Trash2 className="w-5 h-5" /> {isAuthor ? t("Удалить набор у всех") : t("Убрать из моих")}
            </button>
            <button type="button" onClick={() => setPackMenu(false)} className="w-full px-4 py-3 text-left text-body text-muted-foreground">{t("Отмена")}</button>
          </div>
        </div>,
        document.body,
      )}

      {ctxPack && createPortal(
        <div data-sticker-portal className="fixed inset-0 z-[90]" onClick={() => setCtxPack(null)} onContextMenu={(e) => { e.preventDefault(); setCtxPack(null); }}>
          <div
            role="menu"
            className="fixed min-w-[220px] max-w-[280px] rounded-lg bg-card border border-border shadow-xl py-1"
            style={{
              left: Math.max(8, Math.min(ctxPack.x - 24, window.innerWidth - 288)),
              top: Math.max(8, ctxPack.y - 150),
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <p className="px-4 pt-2 pb-1 text-caption text-subtle truncate">{ctxPack.pack.name}</p>
            <button type="button" role="menuitem" onClick={() => void sharePack(ctxPack.pack)}
              className="w-full px-4 py-2.5 text-left text-body flex items-center gap-3 active:bg-secondary hover:bg-secondary">
              <Share2 className="w-5 h-5 text-primary" /> {t("Поделиться стикерпаком")}
            </button>
            {isAuthorOf(ctxPack.pack) && openAddRow(ctxPack.pack)}
            <button type="button" role="menuitem" onClick={() => void removePack(isAuthorOf(ctxPack.pack), ctxPack.pack)}
              className="w-full px-4 py-2.5 text-left text-body flex items-center gap-3 active:bg-secondary hover:bg-secondary text-destructive">
              <Trash2 className="w-5 h-5" /> {isAuthorOf(ctxPack.pack) ? t("Удалить набор у всех") : t("Убрать из моих")}
            </button>
          </div>
        </div>,
        document.body,
      )}

      {/* Добавление стикеров в выбранный набор */}
      <input
        ref={fileRef}
        type="file"
        accept="image/*,video/*"
        multiple
        className="hidden"
        onChange={(e) => addFiles(e.target.files)}
      />

      {/* Сетка стикеров */}
      <div ref={stickerScroll} className="flex-1 overflow-y-auto p-2">
        {stickers.length === 0 ? (
          <div className="h-full flex flex-col items-center justify-center gap-3">
            <p className="text-sm text-muted-foreground px-6 text-center">{activePackId === RECENT ? t("Здесь появятся стикеры, которые вы отправляете чаще всего") : t("В наборе пусто")}</p>
            {canAdd && (
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              disabled={busy}
              className="px-4 py-2 bg-primary text-primary-foreground text-sm font-semibold disabled:opacity-40"
            >
              {busy ? t("Загрузка…") : t("Добавить стикеры")}
            </button>
            )}
          </div>
        ) : (
          <div className={mint ? "grid grid-cols-5 gap-[10px] px-[9px] pt-[8px]" : "grid grid-cols-4 gap-2"}>
            {canAdd && (
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              disabled={busy}
              className={mint ? "aspect-square rounded-[20px] flex items-center justify-center mint-ink disabled:opacity-40" : "aspect-square flex items-center justify-center bg-secondary text-muted-foreground disabled:opacity-40"}
              style={mint ? { background: "rgb(52 92 84 / 0.1)" } : undefined}
              aria-label={t("Добавить стикеры")}
            >
              {mint ? <MintIcon name="stkAdd" size={[22, 24]} /> : <Plus className="w-6 h-6" />}
            </button>
            )}
            {stickers.map((s) => (
              <button
                key={s.id}
                type="button"
                // Долгое удержание (450 мс) — отправить «глюком»; обычный тап — как всегда.
                onPointerDown={() => {
                  if (editMode) return;
                  holdFiredRef.current = false;
                  if (holdRef.current) clearTimeout(holdRef.current);
                  holdRef.current = setTimeout(() => { holdFiredRef.current = true; bumpRecent(s); onSelect(s, true); }, 450);
                }}
                onPointerUp={() => { if (holdRef.current) { clearTimeout(holdRef.current); holdRef.current = null; } }}
                onPointerLeave={() => { if (holdRef.current) { clearTimeout(holdRef.current); holdRef.current = null; } }}
                onPointerCancel={() => { if (holdRef.current) { clearTimeout(holdRef.current); holdRef.current = null; } }}
                onContextMenu={(e) => e.preventDefault()}
                onClick={() => { if (holdFiredRef.current) { holdFiredRef.current = false; return; } if (editMode && isAuthor) { setEditing(s); setEditKeyword(s.keyword || ""); } else { bumpRecent(s); onSelect(s); } }}
                style={{ touchAction: "pan-y" }}
                className={cn("relative aspect-square rounded-lg p-1 active:scale-90 transition-transform select-none", editMode && isAuthor && "ring-1 ring-primary/50")}
              >
                <StickerView url={s.file_url} alt={s.emoji || ""} className="w-full h-full object-contain" />
                {s.keyword && (
                  <span className="absolute bottom-0 left-0 right-0 text-[10px] leading-tight truncate px-1 rounded-b-lg bg-black/45 text-white">{s.keyword}</span>
                )}
              </button>
            ))}
          </div>
        )}
      </div>

      {cropping && (
        <ImageCropper
          file={cropping}
          aspect={1}
          outWidth={512}
          onCancel={() => { setCropping(null); const rest = queue; setQueue([]); if (!rest.length) void nextInQueue([]); else void nextInQueue(rest); }}
          onDone={(cropped) => { setCropping(null); setKeyword(""); setAsking(cropped); }}
        />
      )}

      {/* Окна — порталом на body: пикер живёт в панели ввода с transform, и
          fixed внутри неё считался бы от панели, а не от экрана. */}
      {/* Макрос для нового стикера — можно пропустить, тогда он не подсказывается. */}
      {/* data-sticker-portal: окно вне строки ввода, и без пометки первый же
          тап по нему закрывал панель стикеров (ChatWindow) — вместе с окном и
          выбранным файлом. pad-safe-bottom — над клавиатурой: поле макроса
          само открывает её, и на iPhone окно оставалось под ней. */}
      {asking && createPortal(
        <div data-sticker-portal className="fixed inset-0 z-[90] bg-black/60 flex items-end md:items-center md:justify-center" onClick={() => { const f = asking; setAsking(null); void uploadOne(f, ""); }}>
          <div className="w-full md:w-[420px] bg-surface-2 rounded-t-[16px] md:rounded-lg p-5 pad-safe-bottom space-y-3" onClick={(e) => e.stopPropagation()}>
            <p className="text-h2">{t("Макрос стикера")}</p>
            <p className="text-small text-subtle">{t("Слово, эмодзи или символ: наберёшь его в поле — стикер всплывёт подсказкой. Можно оставить пустым.")}</p>
            {isAnimatedFile(asking) && <p className="text-caption text-subtle">{t("Анимированный стикер: длиннее 5 секунд — обрежется, звук уберётся.")}</p>}
            <div className="flex items-center gap-3">
              {asking.type.startsWith("video/")
                ? <video src={URL.createObjectURL(asking)} autoPlay loop muted playsInline className="w-16 h-16 rounded-md object-contain bg-surface-4" />
                : <img src={URL.createObjectURL(asking)} alt="" className="w-16 h-16 rounded-md object-contain bg-surface-4" />}
              <input
                autoFocus
                value={keyword}
                onChange={(e) => setKeyword(e.target.value.replace(/\s+/g, "").slice(0, 40))}
                placeholder={t("привет")}
                className="flex-1 h-11 px-3 rounded-md bg-surface-4 text-body outline-none"
              />
            </div>
            <div className="flex gap-2">
              <button type="button" onClick={() => { const f = asking; setAsking(null); void uploadOne(f, ""); }} className="flex-1 h-11 rounded-md bg-surface-4 text-body">{t("Без макроса")}</button>
              <button type="button" onClick={() => { const f = asking; setAsking(null); void uploadOne(f, keyword); }} className="flex-1 h-11 rounded-md bg-primary text-primary-foreground text-body font-semibold">{t("Добавить")}</button>
            </div>
            {queue.length > 0 && <p className="text-caption text-subtle text-center">{t("Ещё в очереди: {n}", { n: queue.length })}</p>}
          </div>
        </div>,
        document.body,
      )}

      {/* Правка: макрос и удаление — только автору набора. */}
      {editing && createPortal(
        <div data-sticker-portal className="fixed inset-0 z-[90] bg-black/60 flex items-end md:items-center md:justify-center" onClick={() => setEditing(null)}>
          <div className="w-full md:w-[420px] bg-surface-2 rounded-t-[16px] md:rounded-lg p-5 pad-safe-bottom space-y-3" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center gap-3">
              <StickerView url={editing.file_url} className="w-16 h-16 object-contain" />
              <input
                autoFocus
                value={editKeyword}
                onChange={(e) => setEditKeyword(e.target.value.replace(/\s+/g, "").slice(0, 40))}
                placeholder={t("Макрос (пусто — не подсказывать)")}
                className="flex-1 h-11 px-3 rounded-md bg-surface-4 text-body outline-none"
              />
            </div>
            <div className="flex gap-2">
              <button type="button" disabled={busy} onClick={() => void deleteEditing()} className="h-11 px-4 rounded-md bg-surface-4 text-destructive text-body flex items-center gap-1.5 disabled:opacity-50"><Trash2 className="w-4 h-4" /> {t("Удалить")}</button>
              <button type="button" disabled={busy} onClick={() => void saveEdit()} className="flex-1 h-11 rounded-md bg-primary text-primary-foreground text-body font-semibold disabled:opacity-50">{t("Сохранить")}</button>
            </div>
          </div>
        </div>,
        document.body,
      )}
    </div>
  );
};

export default StickerPicker;
