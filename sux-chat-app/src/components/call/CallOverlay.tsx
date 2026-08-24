import { useEffect, useRef, useState } from "react";
import { playSfx } from "@/lib/sfx";
import { Mic, MicOff, Phone, PhoneOff, Volume2, VolumeX, Users } from "lucide-react";
import Identicon from "@/components/Identicon";
import { cn } from "@/lib/utils";

export type CallUiState = "idle" | "outgoing" | "incoming" | "connecting" | "active";

interface CallOverlayProps {
  state: CallUiState;
  peer: { id: string; name: string; avatarUrl?: string | null };
  muted: boolean;
  /** Потоки собеседников: в группе их несколько (mesh). */
  streams: MediaStream[];
  /** Групповой звонок: вместо аватара — иконка группы. */
  isGroup?: boolean;
  participantsCount?: number;
  onAccept?: () => void;
  onReject?: () => void;
  onHangup: () => void;
  onToggleMute: () => void;
  speaker: boolean;
  onToggleSpeaker: () => void;
}

const STATUS: Record<CallUiState, string> = {
  idle: "",
  outgoing: "Вызов…",
  incoming: "Входящий звонок",
  connecting: "Соединение…",
  active: "",
};

const fmt = (s: number) =>
  `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;

/**
 * Экран звонка поверх приложения: входящий (принять/отклонить), исходящий
 * и активный (таймер, микрофон, отбой). На iOS входящий показывает CallKit —
 * сюда попадаем уже после ответа.
 */
const CallOverlay = ({
  state,
  peer,
  muted,
  streams,
  isGroup,
  participantsCount,
  onAccept,
  onReject,
  onHangup,
  onToggleMute,
  speaker,
  onToggleSpeaker,
}: CallOverlayProps) => {
  const [seconds, setSeconds] = useState(0);



  // Рингтон на своём экране входящего. На iOS сюда не попадаем — там звонит
  // CallKit; на Android приложение в фоне звонит каналом уведомления.
  useEffect(() => {
    if (state !== "incoming") return;
    let stop: (() => void) | null = null;
    let cancelled = false;
    playSfx("/sounds/call.mp3", { loop: true, volume: 0.8 }).then((s) => {
      if (cancelled) s();
      else stop = s;
    });
    return () => {
      cancelled = true;
      stop?.();
    };
  }, [state]);

  useEffect(() => {
    if (state !== "active") {
      setSeconds(0);
      return;
    }
    const id = setInterval(() => setSeconds((s) => s + 1), 1000);
    return () => clearInterval(id);
  }, [state]);

  if (state === "idle") return null;

  return (
    <div
      className="fixed inset-0 z-[60] bg-background flex flex-col items-center justify-between"
      style={{
        paddingTop: "calc(env(safe-area-inset-top) + 3rem)",
        paddingBottom: "calc(env(safe-area-inset-bottom) + 3rem)",
      }}
    >
      {streams.map((stream, i) => (
        <RemoteAudio key={stream.id || i} stream={stream} />
      ))}

      <div className="flex flex-col items-center gap-4">
        {isGroup ? (
          <div className="w-28 h-28 bg-secondary flex items-center justify-center">
            <Users className="w-14 h-14 text-primary" />
          </div>
        ) : (
          <Identicon id={peer.id} avatarUrl={peer.avatarUrl} className="w-28 h-28" />
        )}
        <div className="text-2xl font-bold">{peer.name}</div>
        <div className="text-muted-foreground text-sm">
          {state === "active"
            ? isGroup
              ? `${fmt(seconds)} · участников: ${(participantsCount ?? 0) + 1}`
              : fmt(seconds)
            : STATUS[state]}
        </div>
      </div>

      <div className="flex items-center gap-6">
        {state === "incoming" ? (
          <>
            <button
              type="button"
              onClick={onReject}
              className="w-16 h-16 bg-primary text-primary-foreground flex items-center justify-center"
              aria-label="Отклонить"
            >
              <PhoneOff className="w-7 h-7" />
            </button>
            <button
              type="button"
              onClick={onAccept}
              className="w-16 h-16 bg-success text-success-foreground flex items-center justify-center"
              aria-label="Принять"
            >
              <Phone className="w-7 h-7" />
            </button>
          </>
        ) : (
          <>
            <button
              type="button"
              onClick={onToggleMute}
              className={cn(
                "w-16 h-16 border-2 flex items-center justify-center",
                muted ? "bg-foreground text-background border-foreground" : "border-border"
              )}
              aria-label={muted ? "Включить микрофон" : "Выключить микрофон"}
            >
              {muted ? <MicOff className="w-7 h-7" /> : <Mic className="w-7 h-7" />}
            </button>
            <button
              type="button"
              onClick={onToggleSpeaker}
              className={cn(
                "w-16 h-16 border-2 flex items-center justify-center",
                speaker ? "bg-foreground text-background border-foreground" : "border-border"
              )}
              aria-label={speaker ? "Выключить громкую связь" : "Включить громкую связь"}
            >
              {speaker ? <Volume2 className="w-7 h-7" /> : <VolumeX className="w-7 h-7" />}
            </button>
            <button
              type="button"
              onClick={onHangup}
              className="w-16 h-16 bg-primary text-primary-foreground flex items-center justify-center"
              aria-label="Завершить"
            >
              <PhoneOff className="w-7 h-7" />
            </button>
          </>
        )}
      </div>
    </div>
  );
};

/**
 * Один поток — один элемент. Автозапуск в WebView иногда отклоняется, если
 * поток пришёл не сразу после жеста, поэтому повторяем попытку.
 */
const RemoteAudio = ({ stream }: { stream: MediaStream }) => {
  const ref = useRef<HTMLAudioElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.srcObject = stream;
    let tries = 0;
    const play = () => {
      el.play().catch(() => {
        if (++tries < 10) setTimeout(play, 300);
      });
    };
    play();
  }, [stream]);
  return <audio ref={ref} autoPlay playsInline />;
};

export default CallOverlay;
