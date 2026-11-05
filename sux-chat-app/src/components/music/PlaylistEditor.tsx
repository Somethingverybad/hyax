import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { toast } from "sonner";
import { Check, GripVertical, ImagePlus, Loader2, Pencil, Trash2, X } from "lucide-react";
import { api, type Playlist, type PlaylistTrack } from "@/api/client";
import ImageCropper from "@/components/ImageCropper";
import PlaylistCover from "@/components/music/PlaylistCover";
import { t as tr } from "@/lib/i18n";
import { cn } from "@/lib/utils";

/**
 * Редактирование своего плейлиста: обложка, название, порядок треков
 * (перетаскивание за ручку слева), подписи треков, удаление.
 *
 * Обложка меняется сразу (это загрузка картинки), остальное копится и уходит
 * на сервер по «Готово»; «Отмена» всё это отбрасывает.
 *
 * Перетаскивание — свои pointer-события: ручка с touch-action: none, строка
 * едет за пальцем и меняется местами с соседом, когда заходит за его
 * середину; у края списка он сам прокручивается.
 */
type Edit = { title: string; artist: string };

const EDGE = 56;

const PlaylistEditor = ({ playlist, tracks, title, onCover, onDone, onCancel }: {
  playlist: Playlist;
  tracks: PlaylistTrack[];
  /** Название, как его показывает список («Моя музыка» — переведённым). */
  title: string;
  /** Обложку сменили (сразу, без «Готово»). */
  onCover: (pl: Playlist) => void;
  /** Сохранено: плейлист и треки как на сервере. */
  onDone: (pl: Playlist, tracks: PlaylistTrack[]) => void;
  onCancel: () => void;
}) => {
  const [name, setName] = useState(title);
  const [rows, setRows] = useState(tracks);
  const rowsRef = useRef(rows);
  rowsRef.current = rows;
  const [removed, setRemoved] = useState<Set<string>>(new Set());
  const [edits, setEdits] = useState<Record<string, Edit>>({});
  const [editFor, setEditFor] = useState<PlaylistTrack | null>(null);
  const [saving, setSaving] = useState(false);
  const [cover, setCover] = useState(playlist.cover_url || null);
  const [coverBusy, setCoverBusy] = useState(false);
  const [cropFile, setCropFile] = useState<File | null>(null);
  const coverInput = useRef<HTMLInputElement>(null);

  // ---- Перетаскивание ----
  const scrollRef = useRef<HTMLDivElement>(null);
  const rowEls = useRef(new Map<string, HTMLDivElement>());
  const drag = useRef<{ id: string; pointer: number; startY: number; y: number; raf: number } | null>(null);
  const [dragId, setDragId] = useState<string | null>(null);
  const [offset, setOffset] = useState(0);

  /** Сдвиг строки за пальцем; зашла за середину соседа — поменять местами. */
  const step = () => {
    const d = drag.current;
    if (!d) return;
    let off = d.y - d.startY;
    const list = [...rowsRef.current];
    let i = list.findIndex((t) => t.id === d.id);
    let moved = false;
    while (off > 0 && i < list.length - 1) {
      const h = rowEls.current.get(list[i + 1].id)?.offsetHeight || 0;
      if (!h || off < h / 2) break;
      [list[i], list[i + 1]] = [list[i + 1], list[i]];
      d.startY += h; off -= h; i++; moved = true;
    }
    while (off < 0 && i > 0) {
      const h = rowEls.current.get(list[i - 1].id)?.offsetHeight || 0;
      if (!h || -off < h / 2) break;
      [list[i], list[i - 1]] = [list[i - 1], list[i]];
      d.startY -= h; off += h; i--; moved = true;
    }
    if (moved) { rowsRef.current = list; setRows(list); }
    setOffset(off);
  };

  /** У края списка — прокрутка; место строки на экране сдвигается вместе с ней. */
  const autoScroll = () => {
    const d = drag.current;
    const box = scrollRef.current;
    if (!d || !box) return;
    const r = box.getBoundingClientRect();
    const v = d.y < r.top + EDGE ? -Math.ceil((r.top + EDGE - d.y) / 6) : d.y > r.bottom - EDGE ? Math.ceil((d.y - (r.bottom - EDGE)) / 6) : 0;
    if (v) {
      const before = box.scrollTop;
      box.scrollTop += v;
      const delta = box.scrollTop - before;
      if (delta) { d.startY -= delta; step(); }
    }
    d.raf = requestAnimationFrame(autoScroll);
  };

  const onGripDown = (e: React.PointerEvent, id: string) => {
    if (saving) return;
    e.preventDefault();
    try { (e.currentTarget as Element).setPointerCapture(e.pointerId); } catch { /* старый WebView */ }
    drag.current = { id, pointer: e.pointerId, startY: e.clientY, y: e.clientY, raf: requestAnimationFrame(autoScroll) };
    setDragId(id);
    setOffset(0);
  };
  const onGripMove = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d || d.pointer !== e.pointerId) return;
    d.y = e.clientY;
    step();
  };
  const endDrag = () => {
    const d = drag.current;
    if (d) cancelAnimationFrame(d.raf);
    drag.current = null;
    setDragId(null);
    setOffset(0);
  };
  useEffect(() => () => { if (drag.current) cancelAnimationFrame(drag.current.raf); }, []);

  // ---- Обложка ----
  const pickCover = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    e.target.value = "";
    if (f) setCropFile(f);
  };
  const uploadCover = async (file: File | null) => {
    setCropFile(null);
    setCoverBusy(true);
    try {
      const pl = await api.setPlaylistCover(playlist.id, file);
      setCover(pl.cover_url || null);
      onCover(pl);
    } catch (err: any) {
      toast.error(err?.message || tr("Не удалось сменить обложку"));
    } finally {
      setCoverBusy(false);
    }
  };

  // ---- Сохранение ----
  const shown = rows.filter((t) => !removed.has(t.id));
  const view = (t: PlaylistTrack): Edit => edits[t.id] || { title: t.title, artist: t.artist || "" };

  const save = async () => {
    if (saving) return;
    const newName = name.trim();
    if (!newName) { toast.error(tr("Название пустое")); return; }
    setSaving(true);
    try {
      let pl = playlist;
      if (newName !== title) pl = await api.renamePlaylist(playlist.id, newName);
      for (const id of removed) await api.removeTrack(playlist.id, id);
      for (const t of shown) {
        const e = edits[t.id];
        if (e && (e.title.trim() !== t.title || e.artist.trim() !== (t.artist || ""))) {
          await api.editTrack(playlist.id, t.id, { title: e.title.trim(), artist: e.artist.trim() });
        }
      }
      const was = tracks.filter((t) => !removed.has(t.id)).map((t) => t.id);
      const now = shown.map((t) => t.id);
      const r = was.join() !== now.join()
        ? await api.reorderPlaylist(playlist.id, now)
        : await api.getPlaylist(playlist.id);
      onDone({ ...pl, ...r.playlist }, r.tracks);
      toast.success(tr("Плейлист сохранён"));
    } catch (err: any) {
      toast.error(err?.message || tr("Не получилось"));
      setSaving(false);
    }
  };

  return createPortal(
    <div className="fixed inset-0 z-[70] bg-background flex flex-col">
      <div className="shrink-0 px-2 py-3 pad-safe-top border-b border-border min-h-14 flex items-center gap-2">
        <button type="button" onClick={onCancel} disabled={saving} className="ui-icon-btn p-2" aria-label={tr("Отмена")}>
          <X className="w-5 h-5" />
        </button>
        <span className="text-h2 flex-1 truncate">{tr("Редактирование")}</span>
        <button type="button" onClick={() => void save()} disabled={saving}
          className="h-9 px-3 rounded-md bg-primary text-primary-foreground text-small font-semibold flex items-center gap-1.5 disabled:opacity-60">
          {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}{tr("Готово")}
        </button>
      </div>

      <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-4 space-y-4 pad-safe-bottom">
        <div className="flex items-center gap-4">
          <button type="button" onClick={() => coverInput.current?.click()} disabled={coverBusy}
            className="relative shrink-0 rounded-xl overflow-hidden" aria-label={tr("Сменить обложку")}>
            <PlaylistCover url={cover} isDefault={playlist.is_default} className="w-28 h-28 rounded-xl" iconClass="w-10 h-10" />
            <span className="absolute inset-0 bg-black/35 flex items-center justify-center text-white">
              {coverBusy ? <Loader2 className="w-6 h-6 animate-spin" /> : <ImagePlus className="w-6 h-6" />}
            </span>
          </button>
          <div className="min-w-0 flex-1 space-y-2">
            <button type="button" onClick={() => coverInput.current?.click()} disabled={coverBusy}
              className="w-full h-10 rounded-md bg-surface-4 text-small font-medium disabled:opacity-60">
              {cover ? tr("Сменить обложку") : tr("Выбрать обложку")}
            </button>
            {cover && (
              <button type="button" onClick={() => void uploadCover(null)} disabled={coverBusy}
                className="w-full h-10 rounded-md text-small font-medium text-destructive disabled:opacity-60">
                {tr("Убрать обложку")}
              </button>
            )}
          </div>
          <input ref={coverInput} type="file" accept="image/*" hidden onChange={pickCover} />
        </div>

        <label className="block">
          <span className="block px-1 pb-1 text-caption text-subtle">{tr("Название плейлиста")}</span>
          <input value={name} onChange={(e) => setName(e.target.value)} maxLength={60}
            className="w-full h-11 px-3 rounded-md bg-surface-4 outline-none text-body" />
        </label>

        <div>
          <p className="px-1 pb-1 text-caption text-subtle">
            {shown.length ? tr("Перетащите за ручку слева, чтобы поменять порядок. Тап по треку — изменить подпись.") : tr("В плейлисте нет треков.")}
          </p>
          {/* Без overflow-hidden: иначе тень и подсветка поднятой строки обрезаются. */}
          <div className="rounded-lg border border-border bg-surface-2 divide-y divide-border">
            {shown.map((t) => {
              const v = view(t);
              const dragging = dragId === t.id;
              return (
                <div key={t.id}
                  ref={(el) => { if (el) rowEls.current.set(t.id, el); else rowEls.current.delete(t.id); }}
                  data-track={t.id}
                  className={cn("relative flex items-center gap-1 pr-1 bg-surface-2 first:rounded-t-lg last:rounded-b-lg",
                    dragging && "z-10 rounded-lg bg-surface-3 shadow-xl ring-2 ring-primary/50")}
                  style={dragging ? { transform: `translateY(${offset}px) scale(1.02)` } : undefined}>
                  <span
                    role="button" tabIndex={-1} aria-label={tr("Перетащить")}
                    onPointerDown={(e) => onGripDown(e, t.id)} onPointerMove={onGripMove}
                    onPointerUp={endDrag} onPointerCancel={endDrag}
                    className="self-stretch px-3 flex items-center text-subtle cursor-grab active:cursor-grabbing select-none"
                    style={{ touchAction: "none" }}>
                    <GripVertical className="w-5 h-5" />
                  </span>
                  <button type="button" onClick={() => setEditFor(t)} className="min-w-0 flex-1 py-2.5 text-left">
                    <span className="block text-body truncate">{v.title}</span>
                    {v.artist && <span className="block text-caption text-subtle truncate">{v.artist}</span>}
                  </button>
                  <button type="button" onClick={() => setEditFor(t)} className="p-2 text-subtle" aria-label={tr("Изменить подпись")}>
                    <Pencil className="w-4 h-4" />
                  </button>
                  <button type="button" onClick={() => setRemoved((s) => new Set(s).add(t.id))}
                    className="p-2 text-subtle active:text-destructive" aria-label={tr("Убрать из плейлиста")}>
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              );
            })}
          </div>
          {removed.size > 0 && (
            <button type="button" onClick={() => setRemoved(new Set())} className="mt-2 px-1 text-caption text-primary underline">
              {tr("Вернуть убранные ({n})", { n: removed.size })}
            </button>
          )}
        </div>
      </div>

      {editFor && (
        <TrackEditSheet value={view(editFor)} onClose={() => setEditFor(null)}
          onSave={(v) => { setEdits((m) => ({ ...m, [editFor.id]: v })); setEditFor(null); }} />
      )}
      {cropFile && (
        <ImageCropper file={cropFile} aspect={1} outWidth={600} onCancel={() => setCropFile(null)} onDone={(f) => void uploadCover(f)} />
      )}
    </div>,
    document.body,
  );
};

/** Подпись трека: название и исполнитель. */
const TrackEditSheet = ({ value, onSave, onClose }: { value: Edit; onSave: (v: Edit) => void; onClose: () => void }) => {
  const [title, setTitle] = useState(value.title);
  const [artist, setArtist] = useState(value.artist);
  const ok = !!title.trim();
  return (
    <div className="fixed inset-0 z-[80] bg-black/60 flex flex-col justify-end md:items-center md:justify-center" onClick={onClose}>
      <div className="bg-card border-t-2 md:border-2 border-border md:rounded-lg w-full md:w-[400px] p-4 pad-safe-bottom space-y-3"
        onClick={(e) => e.stopPropagation()}>
        <p className="text-body font-semibold">{tr("Подпись трека")}</p>
        <label className="block">
          <span className="block pb-1 text-caption text-subtle">{tr("Название")}</span>
          <input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={200} autoFocus
            className="w-full h-11 px-3 rounded-md bg-surface-4 outline-none text-body" />
        </label>
        <label className="block">
          <span className="block pb-1 text-caption text-subtle">{tr("Исполнитель")}</span>
          <input value={artist} onChange={(e) => setArtist(e.target.value)} maxLength={200}
            onKeyDown={(e) => { if (e.key === "Enter" && ok) onSave({ title: title.trim(), artist: artist.trim() }); }}
            className="w-full h-11 px-3 rounded-md bg-surface-4 outline-none text-body" />
        </label>
        <div className="flex gap-2 pt-1">
          <button type="button" onClick={onClose} className="flex-1 h-11 rounded-md bg-surface-4 text-small font-medium">{tr("Отмена")}</button>
          <button type="button" disabled={!ok} onClick={() => onSave({ title: title.trim(), artist: artist.trim() })}
            className="flex-1 h-11 rounded-md bg-primary text-primary-foreground text-small font-semibold disabled:opacity-50">{tr("Сохранить")}</button>
        </div>
      </div>
    </div>
  );
};

export default PlaylistEditor;
