import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { Pause, Play, SkipBack, SkipForward, Volume2, VolumeX, X, Music2, Plus, Download } from "lucide-react";
import { t as tr } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { api } from "@/api/client";
import { resolveMediaUrl } from "@/hooks/use-media-url";
import { saveFileToDevice } from "@/lib/saveFile";
import ShareTrackButton from "@/components/music/ShareTrackButton";
import { currentTrack, fmtTime, next, prev, seek, setVolume, stop, toggle, usePlayer, type Track } from "@/lib/player";

/**
 * Плеер на десктопе — вертикально, под разделами у левого края (NavRail): на
 * месте всегда, а не всплывающей полоской сверху (MiniPlayer на этих экранах
 * не показывается). Ничего не играет — «Ничего не воспроизводится», клик
 * ведёт в «Музыку». Сверху вниз: назад, играть/пауза, вперёд, перемотка
 * (вертикальная полоса, клик — в это место), название, «Добавить себе»,
 * «Скачать», звук, закрыть.
 */
/** «Добавить себе» — в «Мою музыку»: из сообщения или поста — по id сообщения,
 *  чужой трек (плейлист, эфир, ссылка) — по id трека. */
const addToMine = async (tk: Track) => {
  const r = tk.source === "message" ? await api.addTrackFromMessage(tk.id) : await api.addTrackFromPublic(tk.id, tk.token);
  return r.already;
};
const RailPlayer = ({ mint }: { mint: boolean }) => {
  const s = usePlayer();
  const tk = currentTrack();
  const navigate = useNavigate();
  const box = mint ? "mint-rail rail-player" : "rail-player flex flex-col items-center gap-1 py-2 border-t border-border w-full";
  const btn = "w-[46px] h-[30px] shrink-0 flex items-center justify-center rounded-[14px] transition-opacity active:opacity-60 disabled:opacity-40";
  const [adding, setAdding] = useState(false);

  if (!tk) {
    return (
      <button type="button" onClick={() => navigate("/music")} className={cn(box, "text-subtle")} title={tr("Открыть «Музыку»")}>
        <span className={btn}><Music2 className="w-5 h-5" /></span>
        <span className="rail-player-title rail-vertical text-caption">{tr("Ничего не воспроизводится")}</span>
      </button>
    );
  }

  const frac = s.duration ? Math.min(1, s.time / s.duration) : 0;
  const canAdd = tk.source === "message" || tk.source === "track";
  const add = async () => {
    setAdding(true);
    try { toast.success((await addToMine(tk)) ? tr("Уже в «Моей музыке»") : tr("Добавлено в «Мою музыку»")); }
    catch (e) { toast.error((e as Error)?.message || tr("Не удалось добавить")); }
    finally { setAdding(false); }
  };
  const download = async () => {
    try {
      const url = await resolveMediaUrl(tk.raw);
      const ext = (tk.raw.split("?")[0].match(/\.[a-z0-9]{2,5}$/i) || [".mp3"])[0];
      await saveFileToDevice(url, `${tk.artist ? `${tk.artist} — ` : ""}${tk.title}${ext}`.replace(/[/\\:*?"<>|]+/g, "_"));
    } catch { toast.error(tr("Не удалось скачать файл")); }
  };
  return (
    <div className={box} aria-label={tr("Плеер")}>
      {!s.live && (
        <button type="button" onClick={() => void prev()} className={btn} aria-label={tr("Предыдущий")} title={tr("Предыдущий")}>
          <SkipBack className="w-4 h-4" />
        </button>
      )}
      <button type="button" onClick={() => void toggle()} className={cn(btn, "bg-primary text-primary-foreground h-9")} aria-label={s.playing ? tr("Пауза") : tr("Играть")}>
        {s.playing ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4" />}
      </button>
      {!s.live && (
        <button type="button" onClick={() => void next()} className={btn} aria-label={tr("Следующий")} title={tr("Следующий")}>
          <SkipForward className="w-4 h-4" />
        </button>
      )}
      {/* Перемотка снизу вверх, как громкость в системных плеерах. В эфире место
          задаёт расписание станции — только показываем. */}
      <span
        role="slider"
        aria-label={tr("Перемотка")}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(frac * 100)}
        title={`${fmtTime(s.time)}${s.duration ? ` / ${fmtTime(s.duration)}` : ""}`}
        onClick={(e) => {
          if (s.live || !s.duration) return;
          const r = e.currentTarget.getBoundingClientRect();
          seek(Math.min(1, Math.max(0, (r.bottom - e.clientY) / r.height)) * s.duration);
        }}
        className={cn("relative my-1 w-1.5 h-14 shrink-0 rounded-full bg-black/15 overflow-hidden", !s.live && "cursor-pointer")}
      >
        <span className="absolute left-0 right-0 bottom-0 bg-primary rounded-full" style={{ height: `${frac * 100}%` }} />
      </span>
      <span className="text-[10px] text-subtle tabular-nums">{fmtTime(s.time)}</span>
      <span className="rail-player-title rail-vertical text-caption" title={tk.title}>
        {s.live ? `📻 ${tk.title}` : tk.title}
      </span>
      {canAdd && (
        <button type="button" onClick={() => void add()} disabled={adding} className={cn(btn, "text-subtle")}
          aria-label={tr("Добавить себе")} title={tr("Добавить себе")}>
          <Plus className="w-4 h-4" />
        </button>
      )}
      {!s.live && (
        <button type="button" onClick={() => void download()} className={cn(btn, "text-subtle")} aria-label={tr("Скачать")} title={tr("Скачать")}>
          <Download className="w-4 h-4" />
        </button>
      )}
      <button type="button" onClick={() => setVolume(s.volume > 0 ? 0 : 1)} className={cn(btn, "text-subtle")}
        aria-label={s.volume > 0 ? tr("Выключить звук") : tr("Включить звук")} title={s.volume > 0 ? tr("Выключить звук") : tr("Включить звук")}>
        {s.volume === 0 ? <VolumeX className="w-4 h-4" /> : <Volume2 className="w-4 h-4" />}
      </button>
      <ShareTrackButton track={tk} className={btn} />
      <button type="button" onClick={stop} className={cn(btn, "text-subtle")} aria-label={tr("Закрыть плеер")} title={tr("Закрыть плеер")}>
        <X className="w-4 h-4" />
      </button>
    </div>
  );
};

export default RailPlayer;
