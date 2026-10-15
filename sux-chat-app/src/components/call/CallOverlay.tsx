import { useEffect, useRef, useState } from "react";
import { playRingtone, resolveRingtoneUrl } from "@/lib/ringtone";
import { readCache } from "@/lib/session-cache";
import { playSfx } from "@/lib/sfx";
import { hasCallKit } from "@/lib/voip";
import { Capacitor } from "@capacitor/core";
import { Mic, MicOff, Phone, PhoneOff, Volume2, VolumeX, Volume1, Users, UserPlus, ChevronDown } from "lucide-react";
import Identicon from "@/components/Identicon";
import { cn } from "@/lib/utils";
import { t } from "@/lib/i18n";

export type CallUiState = "idle" | "outgoing" | "incoming" | "connecting" | "active";

/** Участник звонка: поток есть, когда соединение поднялось; без потока — «звоним». */
export interface CallParticipant {
  id: string;
  name: string;
  avatarUrl?: string | null;
  stream?: MediaStream | null;
  connected?: boolean;
}

interface CallOverlayProps {
  state: CallUiState;
  peer: { id: string; name: string; avatarUrl?: string | null };
  muted: boolean;
  /** Собеседники: в личном звонке один, в групповом — mesh из нескольких. */
  participants: CallParticipant[];
  /** Громкость каждого участника у меня: 1 — как есть, 0 — тихо, до 2 — громче. */
  volumes: Record<string, number>;
  onVolume: (peerId: string, volume: number) => void;
  /** Групповой звонок: вместо аватара — иконка группы. */
  isGroup?: boolean;
  /** Позвать ещё людей — доступно в активном звонке. */
  onAdd?: () => void;
  onAccept?: () => void;
  onReject?: () => void;
  onHangup: () => void;
  onToggleMute: () => void;
  speaker: boolean;
  onToggleSpeaker: () => void;
  /** Свёрнут: вместо экрана — виджет под шапкой, можно ходить по приложению. */
  minimized?: boolean;
  onMinimize?: () => void;
  onExpand?: () => void;
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
 * и активный (таймер, участники с громкостью, микрофон, отбой, «добавить»).
 * На iOS входящий показывает CallKit — сюда попадаем уже после ответа.
 */
const CallOverlay = ({
  state,
  peer,
  muted,
  participants,
  volumes,
  onVolume,
  isGroup,
  onAdd,
  onAccept,
  onReject,
  onHangup,
  onToggleMute,
  speaker,
  onToggleSpeaker,
  minimized,
  onMinimize,
  onExpand,
}: CallOverlayProps) => {
  const [seconds, setSeconds] = useState(0);

  // Рингтон на своём экране входящего. На iOS сюда не попадаем — там звонит
  // CallKit; на Android приложение в фоне звонит каналом уведомления.
  useEffect(() => {
    if (state !== "incoming") return;
    // iPhone: звонит CallKit. Свой звук тут запускать нельзя — <audio> в
    // WebView перехватывает аудиосессию у движка звонка, и после ответа
    // разговор идёт без звука в обе стороны.
    if (hasCallKit()) return;
    let stop: (() => void) | null = null;
    let cancelled = false;
    if (Capacitor.isNativePlatform()) {
      // Android: прежний способ, из бандла.
      playSfx("/sounds/call.mp3", { loop: true, volume: 0.8 }).then((s) => { if (cancelled) s(); else stop = s; });
    } else {
      // Веб и компьютер: звук из настроек (Профиль → Уведомления и звуки → Звук звонка).
      resolveRingtoneUrl(readCache<{ ringtone?: string }>("user")?.ringtone).then((url) => {
        if (cancelled) return;
        stop = playRingtone(url, 0.8);
      });
    }
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

  const showList = state === "active" || state === "connecting" || (state === "outgoing" && participants.length > 1);
  const statusText = state === "active"
    ? isGroup
      ? `${fmt(seconds)} · ${t("участников: {n}", { n: participants.length + 1 })}`
      : fmt(seconds)
    : t(STATUS[state]);
  // Звук собеседников — и в свёрнутом виде: экран звонка не размонтируется,
  // поэтому и таймер не сбрасывается.
  const audio = participants.map((p) => p.stream ? <RemoteAudio key={p.id} stream={p.stream} volume={volumes[p.id] ?? 1} /> : null);

  // Входящий не сворачивается — на него надо ответить.
  if (minimized && state !== "incoming") {
    return (
      <>
        {audio}
        <CallWidget peer={peer} isGroup={isGroup} status={state === "active" ? `${t("Звонок")} · ${statusText}` : statusText}
          muted={muted} onToggleMute={onToggleMute} onHangup={onHangup} onExpand={onExpand} />
      </>
    );
  }

  return (
    <div
      className="fixed inset-0 z-[60] bg-background flex flex-col items-center justify-between"
      style={{
        paddingTop: "calc(var(--sat) + 2rem)",
        paddingBottom: "calc(var(--sab) + 2.5rem)",
      }}
    >
      {audio}
      {onMinimize && state !== "incoming" && (
        <button
          type="button"
          onClick={onMinimize}
          className="absolute left-3 w-11 h-11 rounded-full flex items-center justify-center text-muted-foreground active:bg-surface-3 hover:bg-surface-2"
          style={{ top: "calc(var(--sat) + 0.5rem)" }}
          aria-label={t("Свернуть звонок")}
          title={t("Свернуть звонок")}
        >
          <ChevronDown className="w-7 h-7" />
        </button>
      )}

      <div className="flex flex-col items-center gap-3 w-full min-h-0 px-5">
        {isGroup ? (
          <div className="w-24 h-24 rounded-full bg-secondary flex items-center justify-center">
            <Users className="w-12 h-12 text-primary" />
          </div>
        ) : (
          <Identicon id={peer.id} avatarUrl={peer.avatarUrl} className="w-24 h-24" />
        )}
        <div className="text-2xl font-bold text-center px-4 truncate max-w-full">{peer.name}</div>
        <div className="text-muted-foreground text-sm">{statusText}</div>

        {showList && participants.length > 0 && (
          <div className="w-full max-w-md mt-2 space-y-2 overflow-y-auto max-h-[42vh]">
            {participants.map((p) => {
              const v = volumes[p.id] ?? 1;
              return (
                <div key={p.id} className="rounded-lg bg-surface-2 px-3 py-2 flex items-center gap-3">
                  <Identicon id={p.id} avatarUrl={p.avatarUrl} className="w-9 h-9 shrink-0" />
                  <div className="min-w-0 flex-1">
                    <div className="text-small font-semibold truncate">{p.name}</div>
                    <div className="text-caption text-subtle">
                      {p.connected || p.stream ? (v === 0 ? t("выключен") : t("громкость {percent}%", { percent: Math.round(v * 100) })) : t("звоним…")}
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => onVolume(p.id, v === 0 ? 1 : 0)}
                    className="w-8 h-8 shrink-0 flex items-center justify-center text-subtle"
                    aria-label={v === 0 ? t("Включить {name}", { name: p.name }) : t("Выключить {name}", { name: p.name })}
                  >
                    {v === 0 ? <VolumeX className="w-4 h-4" /> : v < 0.6 ? <Volume1 className="w-4 h-4" /> : <Volume2 className="w-4 h-4" />}
                  </button>
                  <input
                    type="range"
                    min={0}
                    max={2}
                    step={0.05}
                    value={v}
                    onChange={(e) => onVolume(p.id, Number(e.target.value))}
                    className="w-24 h-1 accent-primary shrink-0"
                    aria-label={t("Громкость: {name}", { name: p.name })}
                  />
                </div>
              );
            })}
          </div>
        )}
      </div>

      <div className="flex items-center gap-5">
        {state === "incoming" ? (
          <>
            <button
              type="button"
              onClick={onReject}
              className="w-16 h-16 rounded-full bg-[#ff3b30] text-white flex items-center justify-center"
              aria-label={t("Отклонить")}
            >
              <PhoneOff className="w-7 h-7" />
            </button>
            <button
              type="button"
              onClick={onAccept}
              className="w-16 h-16 rounded-full bg-success text-success-foreground flex items-center justify-center"
              aria-label={t("Принять")}
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
                "w-14 h-14 rounded-full border-2 flex items-center justify-center",
                muted ? "bg-foreground text-background border-foreground" : "border-border"
              )}
              aria-label={muted ? t("Включить микрофон") : t("Выключить микрофон")}
            >
              {muted ? <MicOff className="w-6 h-6" /> : <Mic className="w-6 h-6" />}
            </button>
            <button
              type="button"
              onClick={onToggleSpeaker}
              className={cn(
                "w-14 h-14 rounded-full border-2 flex items-center justify-center",
                speaker ? "bg-foreground text-background border-foreground" : "border-border"
              )}
              aria-label={speaker ? t("Выключить громкую связь") : t("Включить громкую связь")}
            >
              {speaker ? <Volume2 className="w-6 h-6" /> : <VolumeX className="w-6 h-6" />}
            </button>
            {onAdd && state === "active" && (
              <button
                type="button"
                onClick={onAdd}
                className="w-14 h-14 rounded-full border-2 border-border flex items-center justify-center"
                aria-label={t("Добавить участника")}
                title={t("Добавить участника")}
              >
                <UserPlus className="w-6 h-6" />
              </button>
            )}
            <button
              type="button"
              onClick={onHangup}
              className="w-14 h-14 rounded-full bg-[#ff3b30] text-white flex items-center justify-center"
              aria-label={t("Завершить")}
            >
              <PhoneOff className="w-6 h-6" />
            </button>
          </>
        )}
      </div>
    </div>
  );
};

/**
 * Свёрнутый звонок — виджет, как у мини-плеера: карточка под шапкой (под
 * плеером, если играет музыка), на любом экране. Кто, сколько идёт,
 * микрофон и отбой; тап по карточке — снова экран звонка. Высоту виджет
 * сообщает переменной --call-h: по ней, как и по --player-h, сдвигаются
 * закреп в переписке и список чатов.
 */
const CallWidget = ({ peer, isGroup, status, muted, onToggleMute, onHangup, onExpand }: {
  peer: { id: string; name: string; avatarUrl?: string | null };
  isGroup?: boolean;
  status: string;
  muted: boolean;
  onToggleMute: () => void;
  onHangup: () => void;
  onExpand?: () => void;
}) => {
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const root = document.documentElement;
    root.style.setProperty("--call-h", `${box.current?.offsetHeight || 60}px`);
    return () => { root.style.setProperty("--call-h", "0px"); };
  }, []);
  return (
    <div
      ref={box}
      className="player-bar fixed left-0 right-0 z-30 px-2 pt-1 md:left-auto md:right-3 md:w-[380px]"
      style={{ top: "calc(var(--player-top, calc(var(--sat) + 56px)) + var(--player-h, 0px))" }}
    >
      <div className="rounded-lg border border-success/40 bg-surface-2 shadow-lg flex items-center gap-2 px-2 py-2">
        <button type="button" onClick={onExpand} className="min-w-0 flex-1 flex items-center gap-2.5 text-left" aria-label={t("Вернуться к звонку")}>
          <span className="relative shrink-0">
            {isGroup ? (
              <span className="w-9 h-9 rounded-full bg-secondary flex items-center justify-center"><Users className="w-5 h-5 text-primary" /></span>
            ) : (
              <Identicon id={peer.id} avatarUrl={peer.avatarUrl} className="w-9 h-9" />
            )}
            <span className="call-bar-dot absolute -right-0.5 -bottom-0.5 w-3 h-3 rounded-full bg-success border-2 border-surface-2" aria-hidden />
          </span>
          <span className="min-w-0">
            <span className="block text-small font-semibold truncate">{peer.name}</span>
            <span className="block text-caption text-success tabular-nums truncate">{status}</span>
          </span>
        </button>
        <button type="button" onClick={onToggleMute}
          className={cn("w-9 h-9 shrink-0 rounded-full flex items-center justify-center active:opacity-80", muted ? "bg-foreground text-background" : "bg-surface-4 text-foreground")}
          aria-label={muted ? t("Включить микрофон") : t("Выключить микрофон")}>
          {muted ? <MicOff className="w-4 h-4" /> : <Mic className="w-4 h-4" />}
        </button>
        {/* Отбой — красный в любой теме: цвет темы (в «Мяте» лайм) не читается как «положить трубку». */}
        <button type="button" onClick={onHangup} className="w-9 h-9 shrink-0 rounded-full bg-[#ff3b30] text-white flex items-center justify-center active:opacity-80"
          aria-label={t("Завершить")}>
          <PhoneOff className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
};

/**
 * Один поток — один элемент. Автозапуск в WebView иногда отклоняется, если
 * поток пришёл не сразу после жеста, поэтому повторяем попытку.
 *
 * Громкость: до 100% — у самого элемента; выше — через GainNode Web Audio
 * (элемент при этом глушим, иначе звук шёл бы дважды). В нативных сборках
 * звук играет движок, и сюда потоки не приходят.
 */
const RemoteAudio = ({ stream, volume }: { stream: MediaStream; volume: number }) => {
  const ref = useRef<HTMLAudioElement>(null);
  const gainRef = useRef<{ ctx: AudioContext; gain: GainNode } | null>(null);
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
    return () => {
      gainRef.current?.ctx.close().catch(() => {});
      gainRef.current = null;
    };
  }, [stream]);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (volume <= 1) {
      // Усилитель больше не нужен — возвращаем звук элементу.
      if (gainRef.current) { gainRef.current.gain.gain.value = 0; }
      el.muted = false;
      el.volume = Math.max(0, volume);
      return;
    }
    const AC = (window as any).AudioContext || (window as any).webkitAudioContext;
    if (!AC) { el.volume = 1; return; }
    if (!gainRef.current) {
      const ctx: AudioContext = new AC();
      const src = ctx.createMediaStreamSource(stream);
      const gain = ctx.createGain();
      src.connect(gain).connect(ctx.destination);
      gainRef.current = { ctx, gain };
    }
    gainRef.current.gain.gain.value = volume;
    gainRef.current.ctx.resume().catch(() => {});
    el.muted = true;
  }, [volume, stream]);
  return <audio ref={ref} autoPlay playsInline />;
};

export default CallOverlay;
