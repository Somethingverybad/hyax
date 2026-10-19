import { Play } from "lucide-react";
import type { PlaylistTrack } from "@/api/client";
import { t as tr } from "@/lib/i18n";
import { fmtTime } from "@/lib/player";

/** «Продолжить: <трек> · 1:23» — плейлист уже включали, продолжаем с того места (lib/playlistResume). */
export default function ResumeButton({ track, position, onClick }: { track: PlaylistTrack; position: number; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick}
      className="w-full h-11 rounded-md border border-primary text-primary font-medium flex items-center justify-center gap-2 px-3 active:opacity-80">
      <Play className="w-4 h-4 shrink-0" />
      <span className="truncate">{tr("Продолжить: {title}", { title: track.title })}{position >= 1 ? ` · ${fmtTime(position)}` : ""}</span>
    </button>
  );
}
