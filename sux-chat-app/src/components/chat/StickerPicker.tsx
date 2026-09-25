import StickerView from "@/components/chat/StickerView";
import { useEffect, useRef, useState } from "react";
import { api, mediaUrl } from "@/api/client";
import { playSfx } from "@/lib/sfx";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { Plus, Music2, Play, Square, Check, ChevronLeft, ChevronRight, Pencil, Trash2 } from "lucide-react";
import ImageCropper from "@/components/ImageCropper";
import { readCache } from "@/lib/session-cache";
import { invalidateStickerIndex } from "@/lib/stickerIndex";
import type { NotificationSoundInfo } from "@/api/client";

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
    author?: { id: string } | string | null;
  };
}

interface StickerPickerProps {
  onSelect: (sticker: Sticker) => void;
  /** Аудио-стикеры живут в этой же панели: отдельная кнопка рядом со
   *  стикерами дробила один и тот же сценарий «отправить что-то забавное». */
  sounds?: NotificationSoundInfo[];
  selectedSoundId?: string | null;
  onSelectSound?: (sound: NotificationSoundInfo | null) => void;
}

/**
 * Панель стикеров в стиле мессенджеров: наборы полосой сверху, сетка снизу.
 *
 * Портирована из веб-версии, но упрощена под телефон: управление наборами
 * (создание, импорт, удаление) осталось в вебе — на маленьком экране это
 * отдельный сценарий, который мешал бы основному.
 */
const StickerPicker = ({
  onSelect,
  sounds = [],
  selectedSoundId = null,
  onSelectSound,
}: StickerPickerProps) => {
  const [tab, setTab] = useState<"stickers" | "sounds">("stickers");
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

  const [packs, setPacks] = useState<UserStickerPack[]>([]);
  const [activePackId, setActivePackId] = useState<string | null>(null);
  const [stickers, setStickers] = useState<Sticker[]>([]);
  const [loading, setLoading] = useState(true);
  // Создание набора: имя вводится один раз, дальше выбираются файлы.
  const [creating, setCreating] = useState(false);
  const [newPackName, setNewPackName] = useState("");
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const loadPacks = async (selectId?: string) => {
    try {
      const list = await api.getMyStickerPacks();
      setPacks(list || []);
      setActivePackId(selectId ?? list?.[0]?.pack?.id ?? null);
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
    setCropping(list[0]);
  };
  const nextInQueue = async (rest: File[]) => {
    const [head, ...tail] = rest;
    setQueue(tail);
    if (head) { setCropping(head); return; }
    if (addedRef.current) {
      toast.success(`Добавлено: ${addedRef.current}`);
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
      toast.error(e?.message || "Стикер не загрузился");
    } finally {
      setBusy(false);
    }
    await nextInQueue(queue);
  };

  // Автор набора может править макрос и удалять стикеры: режим правки —
  // карандаш в шапке, тап по стикеру открывает форму вместо отправки.
  const meId = readCache<{ id: string }>("user")?.id;
  const activePack = packs.find((p) => p.pack.id === activePackId)?.pack;
  const authorId = activePack?.author && typeof activePack.author === "object" ? activePack.author.id : (activePack?.author as string | undefined);
  const isAuthor = !!meId && !!authorId && meId === authorId;
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
    } catch (e: any) { toast.error(e?.message || "Не удалось сохранить"); }
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
      toast.success("Стикер удалён");
    } catch (e: any) { toast.error(e?.message || "Не удалось удалить"); }
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
      toast.success("Набор создан — теперь добавьте стикеры");
    } catch (e: any) {
      toast.error(e?.message || "Не удалось создать набор");
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    if (!activePackId) {
      setStickers([]);
      return;
    }
    (async () => {
      try {
        setStickers((await api.getStickers(activePackId)) || []);
      } catch {
        setStickers([]);
      }
    })();
  }, [activePackId]);

  const tabs = (
    <div className="flex gap-2 px-3 pt-2 shrink-0">
      <button
        type="button"
        onClick={() => setTab("stickers")}
        className={cn(
          "flex-1 py-1.5 text-xs font-semibold",
          tab === "stickers" ? "bg-primary text-primary-foreground" : "bg-secondary text-muted-foreground",
        )}
      >
        Стикеры
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
        Звуки
      </button>
    </div>
  );


  // Паки аудио-стикеров и их содержимое.
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
          aria-label={playingId === sound.id ? "Остановить" : "Прослушать"}
        >
          {playingId === sound.id ? <Square className="w-4 h-4" /> : <Play className="w-4 h-4" />}
        </button>
        <button
          type="button"
          onClick={() => onSelectSound?.(chosen ? null : sound)}
          className="flex-1 min-w-0 text-left"
        >
          <span className="block text-sm truncate">{sound.name}</span>
          {opts?.showPack && (
            <span className="block text-[11px] text-muted-foreground truncate">
              {sound.pack_name || "Разное"}
            </span>
          )}
        </button>
        {chosen && <Check className="w-4 h-4 text-primary shrink-0" />}
      </div>
    );
  };

  const soundsTab = (
    <div className="h-64 flex flex-col">
      {tabs}
      {!inPack ? (
        // Меню выбора пака + глобальный поиск по звукам
        <>
          <div className="px-2 py-1.5 shrink-0">
            <input
              value={packMenuQuery}
              onChange={(e) => setPackMenuQuery(e.target.value)}
              placeholder="Поиск звука по всем пакам…"
              className="w-full bg-secondary px-3 py-2 text-sm outline-none focus:ring-1 focus:ring-primary"
            />
          </div>
          <div className="flex-1 overflow-y-auto p-2 space-y-1">
            {gq ? (
              // Результаты поиска по всем пакам
              globalMatches.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-8">Ничего не найдено</p>
              ) : (
                globalMatches.map((s) => soundRow(s, { showPack: true }))
              )
            ) : soundPackNames.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-8">Звуков пока нет</p>
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
                  <span className="flex-1 truncate text-sm font-medium">{name}</span>
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
            <button type="button" onClick={backToPacks} className="p-1.5" aria-label="К пакам">
              <ChevronLeft className="w-5 h-5" />
            </button>
            <span className="text-sm font-semibold truncate flex-1">{inPack}</span>
          </div>
          <div className="px-2 py-1.5 shrink-0">
            <input
              value={soundQuery}
              onChange={(e) => setSoundQuery(e.target.value)}
              placeholder="Поиск звука…"
              className="w-full bg-secondary px-3 py-2 text-sm outline-none focus:ring-1 focus:ring-primary"
            />
          </div>
          <div className="flex-1 overflow-y-auto p-2 space-y-1">
            {packSounds.length === 0 && (
              <p className="text-sm text-muted-foreground text-center py-8">Ничего не найдено</p>
            )}
            {packSounds.map(soundRow)}
          </div>
        </>
      )}
    </div>
  );

  if (tab === "sounds") return soundsTab;

  if (loading) {
    return (
      <div className="h-64 flex flex-col">
        {tabs}
        <div className="flex-1 flex items-center justify-center text-sm text-muted-foreground">
          Загрузка стикеров…
        </div>
      </div>
    );
  }

  const createForm = (
    <div className="flex gap-2 px-3 py-2 border-b border-border shrink-0">
      <input
        value={newPackName}
        onChange={(e) => setNewPackName(e.target.value)}
        placeholder="Название набора"
        className="flex-1 bg-secondary px-3 py-1.5 text-sm outline-none"
        autoFocus
      />
      <button
        type="button"
        onClick={createPack}
        disabled={busy || !newPackName.trim()}
        className="px-3 py-1.5 bg-primary text-primary-foreground text-xs font-semibold disabled:opacity-40"
      >
        Создать
      </button>
      <button
        type="button"
        onClick={() => { setCreating(false); setNewPackName(""); }}
        className="px-3 py-1.5 bg-secondary text-xs"
      >
        Отмена
      </button>
    </div>
  );

  if (packs.length === 0) {
    return (
      <div className="h-64 flex flex-col">
        {tabs}
        {creating ? createForm : null}
        <div className="flex-1 flex flex-col items-center justify-center gap-3 px-6 text-center">
          <p className="text-sm text-muted-foreground">Наборов пока нет</p>
          {!creating && (
            <button
              type="button"
              onClick={() => setCreating(true)}
              className="px-4 py-2 bg-primary text-primary-foreground text-sm font-semibold"
            >
              Создать набор
            </button>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="h-64 flex flex-col">
      {tabs}
      {creating && createForm}

      {/* Полоса наборов */}
      <div className="flex gap-2 px-3 py-2 overflow-x-auto border-b border-border shrink-0">
        <button
          type="button"
          onClick={() => setCreating(true)}
          className="px-2.5 py-1.5 bg-secondary text-muted-foreground shrink-0"
          aria-label="Новый набор"
        >
          <Plus className="w-4 h-4" />
        </button>
        {isAuthor && (
          <button
            type="button"
            onClick={() => setEditMode((v) => !v)}
            className={cn("shrink-0 w-8 h-8 rounded-full flex items-center justify-center", editMode ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground")}
            aria-label={editMode ? "Готово" : "Изменить стикеры"}
          >
            {editMode ? <Check className="w-4 h-4" /> : <Pencil className="w-4 h-4" />}
          </button>
        )}
        {packs.map((p) => (
          <button
            key={p.pack.id}
            type="button"
            onClick={() => setActivePackId(p.pack.id)}
            className={cn(
              "px-3 py-1.5 rounded-full text-xs whitespace-nowrap transition-colors",
              activePackId === p.pack.id
                ? "bg-primary text-primary-foreground"
                : "bg-muted text-muted-foreground",
            )}
          >
            {p.pack.name}
          </button>
        ))}
      </div>

      {/* Добавление стикеров в выбранный набор */}
      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        multiple
        className="hidden"
        onChange={(e) => addFiles(e.target.files)}
      />

      {/* Сетка стикеров */}
      <div className="flex-1 overflow-y-auto p-2">
        {stickers.length === 0 ? (
          <div className="h-full flex flex-col items-center justify-center gap-3">
            <p className="text-sm text-muted-foreground">В наборе пусто</p>
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              disabled={busy}
              className="px-4 py-2 bg-primary text-primary-foreground text-sm font-semibold disabled:opacity-40"
            >
              {busy ? "Загрузка…" : "Добавить стикеры"}
            </button>
          </div>
        ) : (
          <div className="grid grid-cols-4 gap-2">
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              disabled={busy}
              className="aspect-square flex items-center justify-center bg-secondary text-muted-foreground disabled:opacity-40"
              aria-label="Добавить стикеры"
            >
              <Plus className="w-6 h-6" />
            </button>
            {stickers.map((s) => (
              <button
                key={s.id}
                type="button"
                onClick={() => { if (editMode && isAuthor) { setEditing(s); setEditKeyword(s.keyword || ""); } else onSelect(s); }}
                className={cn("relative aspect-square rounded-lg p-1 active:scale-90 transition-transform", editMode && isAuthor && "ring-1 ring-primary/50")}
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

      {/* Макрос для нового стикера — можно пропустить, тогда он не подсказывается. */}
      {asking && (
        <div className="fixed inset-0 z-[90] bg-black/60 flex items-end md:items-center md:justify-center" onClick={() => { const f = asking; setAsking(null); void uploadOne(f, ""); }}>
          <div className="w-full md:w-[420px] bg-surface-2 rounded-t-[16px] md:rounded-lg p-5 pb-[calc(var(--sab)+20px)] space-y-3" onClick={(e) => e.stopPropagation()}>
            <p className="text-h2">Макрос стикера</p>
            <p className="text-small text-subtle">Слово, эмодзи или символ: наберёшь его в поле — стикер всплывёт подсказкой. Можно оставить пустым.</p>
            <div className="flex items-center gap-3">
              <img src={URL.createObjectURL(asking)} alt="" className="w-16 h-16 rounded-md object-contain bg-surface-4" />
              <input
                autoFocus
                value={keyword}
                onChange={(e) => setKeyword(e.target.value.replace(/\s+/g, "").slice(0, 40))}
                placeholder="привет"
                className="flex-1 h-11 px-3 rounded-md bg-surface-4 text-body outline-none"
              />
            </div>
            <div className="flex gap-2">
              <button type="button" onClick={() => { const f = asking; setAsking(null); void uploadOne(f, ""); }} className="flex-1 h-11 rounded-md bg-surface-4 text-body">Без макроса</button>
              <button type="button" onClick={() => { const f = asking; setAsking(null); void uploadOne(f, keyword); }} className="flex-1 h-11 rounded-md bg-primary text-primary-foreground text-body font-semibold">Добавить</button>
            </div>
            {queue.length > 0 && <p className="text-caption text-subtle text-center">Ещё в очереди: {queue.length}</p>}
          </div>
        </div>
      )}

      {/* Правка: макрос и удаление — только автору набора. */}
      {editing && (
        <div className="fixed inset-0 z-[90] bg-black/60 flex items-end md:items-center md:justify-center" onClick={() => setEditing(null)}>
          <div className="w-full md:w-[420px] bg-surface-2 rounded-t-[16px] md:rounded-lg p-5 pb-[calc(var(--sab)+20px)] space-y-3" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center gap-3">
              <StickerView url={editing.file_url} className="w-16 h-16 object-contain" />
              <input
                autoFocus
                value={editKeyword}
                onChange={(e) => setEditKeyword(e.target.value.replace(/\s+/g, "").slice(0, 40))}
                placeholder="Макрос (пусто — не подсказывать)"
                className="flex-1 h-11 px-3 rounded-md bg-surface-4 text-body outline-none"
              />
            </div>
            <div className="flex gap-2">
              <button type="button" disabled={busy} onClick={() => void deleteEditing()} className="h-11 px-4 rounded-md bg-surface-4 text-destructive text-body flex items-center gap-1.5 disabled:opacity-50"><Trash2 className="w-4 h-4" /> Удалить</button>
              <button type="button" disabled={busy} onClick={() => void saveEdit()} className="flex-1 h-11 rounded-md bg-primary text-primary-foreground text-body font-semibold disabled:opacity-50">Сохранить</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default StickerPicker;
