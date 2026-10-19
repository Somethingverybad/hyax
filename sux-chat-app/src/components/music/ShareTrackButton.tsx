import { useState } from "react";
import { toast } from "sonner";
import { Share2 } from "lucide-react";
import { api } from "@/api/client";
import ShareToChat from "@/components/ShareToChat";
import { t as tr } from "@/lib/i18n";
import type { Track } from "@/lib/player";
import { cn } from "@/lib/utils";

/** «Поделиться треком» в плеере: выбрать чат или группу — трек уйдёт туда
 *  файлом, как музыка из плейлиста («Отправить в чат» на экране плейлиста).
 *  Секретные чаты в списке не показываем: файл ушёл бы без шифрования. */
export default function ShareTrackButton({ track, className, iconClass = "w-4 h-4" }: { track: Track; className?: string; iconClass?: string }) {
  const [open, setOpen] = useState(false);
  const send = async (chatId: string, title: string) => {
    try {
      await api.sendTrackToChat(chatId, { file_url: track.raw, title: track.artist ? `${track.artist} — ${track.title}` : track.title });
      toast.success(tr("Трек отправлен: {chat}", { chat: title }));
    } catch (e) {
      toast.error((e as Error).message || tr("Не получилось"));
    }
  };
  return (
    <>
      <button type="button" onClick={(e) => { e.stopPropagation(); setOpen(true); }}
        className={cn("shrink-0 flex items-center justify-center text-subtle active:text-primary", className)}
        aria-label={tr("Поделиться треком")} title={tr("Поделиться треком")}>
        <Share2 className={iconClass} />
      </button>
      {open && (
        <ShareToChat open text="" title={tr("Поделиться треком")} onClose={() => setOpen(false)}
          onPick={(chatId, title) => void send(chatId, title)} />
      )}
    </>
  );
}
