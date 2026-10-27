import { t } from "@/lib/i18n";
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { toast } from "sonner";
import { Check, ListMusic, Music2, Plus } from "lucide-react";
import { api, type Playlist } from "@/api/client";
import { cn } from "@/lib/utils";

/**
 * Куда добавить музыку: шторка со списком плейлистов и полем «новый».
 * «Моя музыка» заводится сама, поэтому список пустым не бывает.
 *
 * Треков может быть несколько (в сообщении или посте их до десяти) — тогда
 * сверху список с галочками: сразу отмечены все, лишние можно снять.
 */
/** «Моя музыка» заводит сервер — её имя переводим; свои названия — как есть. */
const plName = (pl: Playlist) => (pl.is_default ? t(pl.name) : pl.name);

/** Что добавить: файл из сообщения или поста (message) либо трек плейлиста
 *  (track: свой, открытый чужой, из эфира, по ссылке — с token). */
export type PickTrack = { key: string; title: string; message?: string; track?: string; token?: string };

/** Название трека из имени файла — без расширения. */
export const fileTitle = (name?: string | null) => (name || "").replace(/\.[^.]+$/, "") || t("Аудиофайл");

const PlaylistPicker = ({ tracks, onClose }: {
  tracks: PickTrack[] | null;
  onClose: () => void;
}) => {
  const [lists, setLists] = useState<Playlist[] | null>(null);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const key = tracks?.map((x) => x.key).join() ?? "";

  useEffect(() => {
    if (!tracks) return;
    setLists(null);
    setPicked(new Set(tracks.map((x) => x.key)));
    api.listPlaylists().then(setLists).catch(() => setLists([]));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  if (!tracks?.length) return null;
  const many = tracks.length > 1;
  const chosen = tracks.filter((x) => picked.has(x.key));
  const all = chosen.length === tracks.length;

  const addOne = (x: PickTrack, playlistId?: string) =>
    x.track ? api.addTrackFromPublic(x.track, x.token, playlistId) : api.addTrackFromMessage(x.message!, playlistId);

  const add = async (playlistId?: string, playlistName?: string) => {
    if (busy || !chosen.length) return;
    setBusy(true);
    let added = 0, already = 0, failed = 0, err = "";
    let target = playlistName || "";
    // По одному: их немного, а у каждого своё «уже есть» и своя ошибка.
    for (const x of chosen) {
      try {
        const r = await addOne(x, playlistId);
        if (r.already) already++; else added++;
        if (!target && "playlist" in r && r.playlist) target = plName(r.playlist as Playlist);
      } catch (e) {
        failed++;
        err ||= (e as Error)?.message || "";
      }
    }
    setBusy(false);
    if (failed && !added && !already) { toast.error(err || t("Не удалось добавить")); return; }
    if (!added) toast.success(chosen.length > 1 ? t("Все уже в плейлисте") : t("Уже в плейлисте"));
    else if (chosen.length === 1) toast.success(t("Добавлено в «{name}»", { name: target }));
    else toast.success(already
      ? t("В «{name}» добавлено: {n}, уже были: {k}", { name: target, n: added, k: already })
      : t("В «{name}» добавлено: {n}", { name: target, n: added }));
    if (failed) toast.error(t("Не добавилось: {n}", { n: failed }));
    onClose();
  };

  const createAndAdd = async () => {
    const value = name.trim();
    if (!value || busy || !chosen.length) return;
    setBusy(true);
    try {
      const pl = await api.createPlaylist(value);
      setName("");
      setBusy(false);
      await add(pl.id, pl.name);
    } catch (e: any) {
      setBusy(false);
      toast.error(e?.message || t("Не получилось"));
    }
  };

  const toggle = (k: string) => setPicked((prev) => {
    const next = new Set(prev);
    if (next.has(k)) next.delete(k); else next.add(k);
    return next;
  });

  // В body: шторку открывают и из карточек со стеклом (backdrop-filter) —
  // внутри них fixed отсчитывается от карточки, а не от экрана.
  return createPortal(
    <div className="fixed inset-0 z-[75] flex items-end" onClick={onClose}>
      <div className="absolute inset-0 bg-black/40" />
      <div
        className="ui-card relative w-full rounded-t-[16px] bg-surface-2 p-4 pb-[calc(var(--sab)+20px)] space-y-3 max-h-[80vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mx-auto h-1 w-9 rounded-full bg-foreground/20" aria-hidden />
        <div className="flex items-baseline gap-2">
          <p className="text-h2 flex-1">{t("В плейлист")}</p>
          {many && (
            <button type="button" onClick={() => setPicked(all ? new Set() : new Set(tracks.map((x) => x.key)))}
              className="text-small text-primary font-medium">
              {all ? t("Снять все") : t("Выбрать все")}
            </button>
          )}
        </div>

        {many ? (
          <div className="space-y-1" role="group" aria-label={t("Треки")}>
            {tracks.map((x) => {
              const on = picked.has(x.key);
              return (
                <button key={x.key} type="button" role="checkbox" aria-checked={on} onClick={() => toggle(x.key)}
                  className="w-full min-h-10 px-2 rounded-md flex items-center gap-3 text-left active:bg-surface-4">
                  <span className={cn("w-5 h-5 shrink-0 rounded border-2 flex items-center justify-center",
                    on ? "bg-primary border-primary text-primary-foreground" : "border-subtle")}>
                    {on && <Check className="w-3.5 h-3.5" strokeWidth={3} />}
                  </span>
                  <span className={cn("flex-1 text-small truncate", !on && "text-subtle")}>{x.title}</span>
                </button>
              );
            })}
            <p className="text-caption text-subtle px-2 pt-1">
              {chosen.length ? t("Выбрано: {n} из {m} — выберите плейлист", { n: chosen.length, m: tracks.length }) : t("Отметьте треки")}
            </p>
          </div>
        ) : (
          <p className="text-caption text-subtle truncate">{tracks[0].title}</p>
        )}

        {lists === null ? (
          <p className="text-small text-subtle">{t("Загрузка…")}</p>
        ) : (
          <div className="space-y-1">
            {lists.map((pl) => (
              <button
                key={pl.id}
                type="button"
                disabled={busy || !chosen.length}
                onClick={() => void add(pl.id, plName(pl))}
                className="w-full min-h-12 px-3 rounded-md flex items-center gap-3 text-left bg-surface-4 active:opacity-70 disabled:opacity-50"
              >
                {pl.is_default ? <Music2 className="w-5 h-5 text-primary shrink-0" /> : <ListMusic className="w-5 h-5 text-primary shrink-0" />}
                <span className="flex-1 text-body truncate">{plName(pl)}</span>
                <span className="text-small text-subtle">{pl.tracks_count ?? 0}</span>
              </button>
            ))}
          </div>
        )}

        <div className="flex gap-2 pt-1">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") void createAndAdd(); }}
            placeholder={t("Новый плейлист")}
            className="flex-1 h-10 px-3 rounded-md bg-surface-4 outline-none text-body min-w-0"
          />
          <button
            type="button"
            onClick={() => void createAndAdd()}
            disabled={!name.trim() || busy || !chosen.length}
            className="h-10 px-3 rounded-md bg-primary text-primary-foreground flex items-center gap-1 text-small font-medium disabled:opacity-50"
          >
            <Plus className="w-4 h-4" /> {t("Создать")}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
};

export default PlaylistPicker;
