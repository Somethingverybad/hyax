import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Radio, RadioTower } from "lucide-react";
import { api, type StationState } from "@/api/client";
import { stationLinkId } from "@/lib/linkify";
import { stationName } from "@/components/music/StationView";
import { t as tr, tn } from "@/lib/i18n";
import { cn } from "@/lib/utils";

/**
 * Эфир по ссылке /air/<id> в сообщении или посте: кто ведёт, что играет,
 * сколько слушают; тап — в «Музыку» на этот эфир. Эфир закончился (станции
 * больше нет) — карточка серая, не нажимается и так и говорит; название
 * берём из текста сообщения («Эфир «…»»), сервер его уже не помнит.
 */
const StationLinkCard = ({ url, text, own }: { url: string; text?: string | null; own?: boolean }) => {
  const navigate = useNavigate();
  const id = stationLinkId(url);
  const [data, setData] = useState<StationState | null | undefined>(undefined);

  useEffect(() => {
    if (!id) return;
    let alive = true;
    api.getStation(id).then((d) => alive && setData(d)).catch(() => alive && setData(null));
    return () => { alive = false; };
  }, [id]);

  if (!id) return null;
  const box = cn("ui-card mt-1.5 w-full min-w-[248px] max-w-[280px] rounded-lg overflow-hidden text-left", own ? "bg-black/15" : "bg-surface-2");
  const fromText = /«([^»]+)»/.exec(text || "")?.[1];

  if (data === null) {
    return (
      <div className={cn(box, "opacity-70")} aria-disabled>
        <div className="px-2.5 py-2 flex items-center gap-2.5">
          <span className="w-10 h-10 shrink-0 rounded-md bg-surface-3 flex items-center justify-center"><Radio className="w-5 h-5 opacity-60" /></span>
          <span className="min-w-0 flex-1">
            <span className="block text-small font-medium truncate">{fromText ? tr("Эфир «{name}»", { name: fromText }) : tr("Эфир")}</span>
            <span className="block text-caption opacity-70">{tr("Эфир закончен")}</span>
          </span>
        </div>
      </div>
    );
  }

  const st = data?.station;
  const host = st ? (st.channel ? st.channel.name : st.owner.username) : "";
  const now = data?.now?.track;
  return (
    <button type="button" className={cn(box, "block active:opacity-90")}
      onClick={(e) => { e.stopPropagation(); navigate("/music", { state: { stationId: id } }); }}>
      <div className="px-2.5 py-2 flex items-center gap-2.5">
        <span className={cn("w-10 h-10 shrink-0 rounded-md flex items-center justify-center", st && !st.paused ? "bg-destructive/15 text-destructive" : "bg-surface-3")}>
          <RadioTower className="w-5 h-5" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-small font-medium truncate">{st ? stationName(st) : fromText || tr("Загрузка…")}</span>
          <span className="block text-caption opacity-70 truncate">
            {st ? `${host} · ${st.paused ? tr("Пауза") : tn(st.listeners, "{n} слушает", "{n} слушают", "{n} слушают")}` : ""}
          </span>
          {now && <span className="block text-caption opacity-70 truncate">{now.artist ? `${now.artist} — ${now.title}` : now.title}</span>}
        </span>
        <span className="shrink-0 px-2 h-6 rounded-full text-caption font-semibold flex items-center bg-primary text-primary-foreground">{tr("Слушать")}</span>
      </div>
    </button>
  );
};

export default StationLinkCard;
