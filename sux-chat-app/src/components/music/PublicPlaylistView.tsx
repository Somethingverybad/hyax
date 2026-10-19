import { t as tr, tn } from "@/lib/i18n";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Check, ChevronLeft, Download, Flag, Pause, Play, Plus } from "lucide-react";
import ReportSheet from "@/components/ReportSheet";
import { SettingsCard, SettingsRow } from "@/components/settings";
import Identicon from "@/components/Identicon";
import { api, type Playlist, type PlaylistTrack, type PublicPlaylist } from "@/api/client";
import { playQueue, usePlayer, currentTrack, fmtTime, type Track } from "@/lib/player";
import { cn } from "@/lib/utils";
import { PlaylistStatsBar, reportPlaylistPlay } from "@/components/music/PlaylistStats";
import ResumeButton from "@/components/music/ResumeButton";
import { playPlaylist, resumeTrack } from "@/lib/playlistResume";

const toQueue = (t: PlaylistTrack): Track => ({
  id: t.id, raw: t.file_url, title: t.title, artist: t.artist || undefined, source: "track",
});

/**
 * Открытый плейлист собеседника: послушать, сохранить себе целиком или
 * забрать отдельные треки в «Мою музыку». Чужой плейлист от этого не меняется.
 */
const PublicPlaylistView = ({ item, onBack, onSaved }: {
  item: PublicPlaylist;
  onBack: () => void;
  /** Плейлист скопирован — открыть его у себя. */
  onSaved: (pl: Playlist) => void;
}) => {
  const [tracks, setTracks] = useState<PlaylistTrack[] | null>(null);
  const [stats, setStats] = useState<Pick<Playlist, "plays" | "likes" | "liked" | "resume"> | null>(null);
  const [missing, setMissing] = useState(false);
  const [saving, setSaving] = useState(false);
  // Треки, уже забранные в «Мою музыку» за этот заход: галочка вместо плюса.
  const [taken, setTaken] = useState<Set<string>>(new Set());
  const [reportFor, setReportFor] = useState<PlaylistTrack | null>(null);
  const player = usePlayer();
  const playing = currentTrack();
  const name = item.is_default ? tr(item.name) : item.name;

  useEffect(() => {
    api.getPublicPlaylist(item.id)
      .then((r) => { setTracks(r.tracks); setStats(r.playlist); })
      .catch(() => setMissing(true));
  }, [item.id]);

  const save = async () => {
    if (saving) return;
    setSaving(true);
    try {
      const copy = await api.savePublicPlaylist(item.id);
      toast.success(tr("Плейлист «{name}» у вас", { name: copy.name }));
      onSaved(copy);
    } catch (e: any) {
      toast.error(e?.message || tr("Не получилось"));
    } finally { setSaving(false); }
  };

  const take = async (t: PlaylistTrack) => {
    if (taken.has(t.id)) return;
    try {
      const r = await api.addTrackFromPublic(t.id);
      setTaken((s) => new Set(s).add(t.id));
      toast.success(r.already ? tr("Уже есть в «Моей музыке»") : tr("Добавлено в «Мою музыку»"));
    } catch (e: any) { toast.error(e?.message || tr("Не получилось")); }
  };

  return (
    <>
      <div className="shrink-0 px-2 py-3 pad-safe-top bg-background border-b border-border min-h-14 flex items-center gap-2">
        <button type="button" onClick={onBack} className="ui-icon-btn p-2" aria-label={tr("Назад")}>
          <ChevronLeft className="w-5 h-5" />
        </button>
        <span className="text-h2 flex-1 truncate">{name}</span>
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-3" style={{ paddingBottom: "calc(16px + var(--mint-nav-space, 0px))" }}>
        <div className="flex items-center gap-3 px-1">
          <Identicon id={item.owner.id} avatarUrl={item.owner.avatar_url} className="w-9 h-9 rounded-md shrink-0" />
          <p className="text-small text-subtle min-w-0 truncate">
            {/* Имя владельца — жирным: шаблон делим по {owner}, порядок слов задаёт перевод. */}
            {(() => { const [before, after = ""] = tr("Плейлист {owner}").split("{owner}"); return <>{before}<b className="text-foreground">{item.owner.username}</b>{after}</>; })()}
            {tracks && <>{" · "}{tn(tracks.length, "{n} трек", "{n} трека", "{n} треков")}</>}
          </p>
          {stats && <PlaylistStatsBar id={item.id} own={false} plays={stats.plays} likes={stats.likes} liked={stats.liked} className="ml-auto shrink-0" />}
        </div>

        {missing ? (
          <div className="ui-card rounded-lg bg-surface-2 border border-border p-4 space-y-1">
            <p className="text-body font-semibold">{tr("Плейлиста нет")}</p>
            <p className="text-small text-subtle">{tr("Владелец закрыл его или удалил.")}</p>
          </div>
        ) : tracks === null ? (
          <p className="text-small text-subtle">{tr("Загрузка…")}</p>
        ) : (
          <>
            <button
              type="button"
              onClick={() => void save()}
              disabled={saving}
              className="w-full h-11 rounded-md bg-primary text-primary-foreground font-medium flex items-center justify-center gap-2 active:opacity-90 disabled:opacity-50"
            >
              <Download className="w-4 h-4" /> {saving ? tr("Сохраняю…") : tr("Сохранить плейлист себе")}
            </button>
            {(() => {
              const at = resumeTrack(tracks, item.id, stats?.resume);
              return at && stats?.resume ? (
                <ResumeButton track={at} position={stats.resume.position}
                  onClick={() => { void playPlaylist(tracks, toQueue, { playlistId: item.id }, stats.resume); reportPlaylistPlay(item.id); }} />
              ) : null;
            })()}
            {tracks.length === 0 ? (
              <p className="px-1 text-small text-subtle">{tr("Плейлист пуст.")}</p>
            ) : (
              <SettingsCard>
                {tracks.map((t, i) => {
                  const isNow = playing?.id === t.id;
                  const got = taken.has(t.id);
                  return (
                    <SettingsRow
                      key={t.id}
                      leading={
                        <span className={cn("w-9 h-9 rounded-md flex items-center justify-center shrink-0",
                          isNow ? "bg-primary text-primary-foreground" : "bg-surface-4 text-muted-foreground")}>
                          {isNow && player.playing ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4" />}
                        </span>
                      }
                      label={t.title}
                      hint={t.artist || undefined}
                      value={isNow && player.duration ? fmtTime(player.time) : undefined}
                      onClick={() => { void playQueue(tracks.map(toQueue), i, { source: { playlistId: item.id } }); reportPlaylistPlay(item.id); }}
                      trailing={
                        <span className="flex items-center shrink-0">
                          <button
                            type="button"
                            onClick={(e) => { e.stopPropagation(); void take(t); }}
                            className={cn("p-2", got ? "text-primary" : "text-subtle active:text-primary")}
                            aria-label={got ? tr("Добавлено в «Мою музыку»") : tr("В «Мою музыку»")}
                          >
                            {got ? <Check className="w-4 h-4" /> : <Plus className="w-4 h-4" />}
                          </button>
                          <button
                            type="button"
                            onClick={(e) => { e.stopPropagation(); setReportFor(t); }}
                            className="p-2 text-subtle active:text-destructive"
                            aria-label={tr("Пожаловаться на трек")}
                          >
                            <Flag className="w-4 h-4" />
                          </button>
                        </span>
                      }
                    />
                  );
                })}
              </SettingsCard>
            )}
          </>
        )}
      </div>
      {reportFor && (
        <ReportSheet target={{ type: "track", id: reportFor.id }} title={reportFor.title} onClose={() => setReportFor(null)} />
      )}
    </>
  );
};

export default PublicPlaylistView;
