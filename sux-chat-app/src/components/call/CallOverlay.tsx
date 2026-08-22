import { useEffect, useRef, useState } from "react";
import { Mic, MicOff, Phone, PhoneOff } from "lucide-react";
import Identicon from "@/components/Identicon";
import { cn } from "@/lib/utils";

export type CallUiState = "idle" | "outgoing" | "incoming" | "connecting" | "active";

interface CallOverlayProps {
  state: CallUiState;
  peer: { id: string; name: string; avatarUrl?: string | null };
  muted: boolean;
  remoteStream: MediaStream | null;
  onAccept?: () => void;
  onReject?: () => void;
  onHangup: () => void;
  onToggleMute: () => void;
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
  remoteStream,
  onAccept,
  onReject,
  onHangup,
  onToggleMute,
}: CallOverlayProps) => {
  const audioRef = useRef<HTMLAudioElement>(null);
  const [seconds, setSeconds] = useState(0);

  useEffect(() => {
    if (audioRef.current && remoteStream) {
      audioRef.current.srcObject = remoteStream;
      audioRef.current.play().catch(() => {});
    }
  }, [remoteStream]);

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
      <audio ref={audioRef} autoPlay playsInline />

      <div className="flex flex-col items-center gap-4">
        <Identicon id={peer.id} avatarUrl={peer.avatarUrl} className="w-28 h-28" />
        <div className="text-2xl font-bold">{peer.name}</div>
        <div className="text-muted-foreground text-sm">
          {state === "active" ? fmt(seconds) : STATUS[state]}
        </div>
      </div>

      <div className="flex items-center gap-8">
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

export default CallOverlay;
