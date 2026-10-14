import { t as tr, tn } from "@/lib/i18n";
import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { toast } from "sonner";
import { ArrowLeft, Download, Music2, Pause, Play } from "lucide-react";
import { SettingsCard, SettingsRow } from "@/components/settings";
import { api, type Playlist, type PlaylistTrack } from "@/api/client";
import { playQueue, usePlayer, currentTrack, fmtTime, type Track } from "@/lib/player";
import { cn } from "@/lib/utils";

/**
 * Плейлист по ссылке: послушать и забрать себе.
 *
 * Открывает любой, у кого есть ссылка — плейлист становится общим только
 * после того, как владелец сам нажал «Поделиться», и ссылку можно отозвать.
 * «Сохранить себе» делает свою копию: чужой плейлист от этого не меняется.
 */
const toQueue = (t: PlaylistTrack): Track => ({
  id: t.id, raw: t.file_url, title: t.title, artist: t.artist || undefined,
});

const SharedPlaylist = () => {
  const { token = "" } = useParams();
  const navigate = useNavigate();
  const [data, setData] = useState<{ playlist: Playlist; owner: string; tracks: PlaylistTrack[] } | null>(null);
  const [state, setState] = useState<"loading" | "ok" | "missing">("loading");
  const [saving, setSaving] = useState(false);
  const player = usePlayer();
  const playing = currentTrack();

  useEffect(() => {
    api.getSharedPlaylist(token)
      .then((r) => { setData(r); setState("ok"); })
      .catch(() => setState("missing"));
  }, [token]);

  const save = async () => {
    if (!data || saving) return;
    setSaving(true);
    try {
      const copy = await api.savePlaylistCopy(token);
      toast.success(tr("Плейлист «{name}» у вас", { name: copy.is_default ? tr(copy.name) : copy.name }));
      navigate("/music");
    } catch (e: any) {
      toast.error(e?.message || tr("Не получилось"));
    } finally { setSaving(false); }
  };

  return (
    <div className="h-screen flex flex-col bg-background">
      <div className="shrink-0 px-2 py-3 pad-safe-top bg-background border-b border-border min-h-14 flex items-center gap-2">
        <button type="button" onClick={() => navigate("/music")} className="ui-icon-btn p-2" aria-label={tr("К музыке")}>
          <ArrowLeft className="w-5 h-5" />
        </button>
        <span className="text-h2 flex-1 truncate">{(data?.playlist.is_default ? tr(data.playlist.name) : data?.playlist.name) || tr("Плейлист")}</span>
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-3">
        {state === "loading" && <p className="text-small text-subtle">{tr("Загрузка…")}</p>}
        {state === "missing" && (
          <div className="ui-card rounded-lg bg-surface-2 border border-border p-4 space-y-1">
            <p className="text-body font-semibold">{tr("Плейлиста нет")}</p>
            <p className="text-small text-subtle">{tr("Ссылка отозвана или неверна.")}</p>
          </div>
        )}
        {state === "ok" && data && (
          <>
            <p className="px-1 text-small text-subtle">
              {/* Имя владельца — жирным: шаблон делим по {owner}, порядок слов задаёт перевод. */}
              {(() => { const [before, after = ""] = tr("Плейлист {owner}").split("{owner}"); return <>{before}<b>{data.owner}</b>{after}</>; })()}
              {" · "}{tn(data.tracks.length, "{n} трек", "{n} трека", "{n} треков")}
            </p>
            <button
              type="button"
              onClick={() => void save()}
              disabled={saving}
              className="w-full h-11 rounded-md bg-primary text-primary-foreground font-medium flex items-center justify-center gap-2 active:opacity-90 disabled:opacity-50"
            >
              <Download className="w-4 h-4" /> {saving ? tr("Сохраняю…") : tr("Сохранить себе")}
            </button>

            {data.tracks.length === 0 ? (
              <p className="px-1 text-small text-subtle">{tr("Плейлист пуст.")}</p>
            ) : (
              <SettingsCard>
                {data.tracks.map((t, i) => {
                  const isNow = playing?.id === t.id;
                  return (
                    <SettingsRow
                      key={t.id}
                      leading={
                        <span className={cn("w-9 h-9 rounded-md flex items-center justify-center shrink-0",
                          isNow ? "bg-primary text-primary-foreground" : "bg-surface-4 text-muted-foreground")}>
                          {isNow && player.playing ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4" />}
                        </span>
                      }
                      icon={undefined}
                      label={t.title}
                      hint={t.artist || undefined}
                      value={isNow && player.duration ? fmtTime(player.time) : undefined}
                      onClick={() => void playQueue(data.tracks.map(toQueue), i)}
                    />
                  );
                })}
              </SettingsCard>
            )}
          </>
        )}
      </div>
    </div>
  );
};

export default SharedPlaylist;
