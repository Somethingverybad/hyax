import { useEffect, useRef, useState } from "react";
import { playRingtone, resolveRingtoneUrl } from "@/lib/ringtone";
import { readCache } from "@/lib/session-cache";
import { playSfx } from "@/lib/sfx";
import { hasCallKit } from "@/lib/voip";
import { Capacitor } from "@capacitor/core";
import { Mic, MicOff, Phone, PhoneOff, Volume2, VolumeX, Volume1, Users, UserPlus, ChevronDown, Video, VideoOff, SwitchCamera, Settings2 } from "lucide-react";
import { toast } from "sonner";
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
  /** Видео (веб и компьютер): своя камера, видео собеседника, кнопки. */
  video?: CallVideo;
  /** Шумоподавление микрофона — переключатель в настройках звонка. */
  noise?: { on: boolean; onToggle: () => void };
  /** Свёрнут: вместо экрана — виджет под шапкой, можно ходить по приложению. */
  minimized?: boolean;
  onMinimize?: () => void;
  onExpand?: () => void;
}

export interface CallVideo {
  local: MediaStream | null;
  remote: MediaStream | null;
  /** У собеседника версия с видео — камеру можно включать. */
  available: boolean;
  busy?: boolean;
  canFlip: boolean;
  /** Фронтальная камера — своё превью зеркалим. */
  mirrored: boolean;
  onToggle: () => void;
  onFlip: () => void;
}

/** Поток в <video>: звук играет RemoteAudio, поэтому здесь всегда без звука. */
const VideoView = ({ stream, mirrored, className }: { stream: MediaStream; mirrored?: boolean; className?: string }) => {
  const ref = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (el.srcObject !== stream) el.srcObject = stream;
    el.play?.().catch(() => {});
  }, [stream]);
  return <video ref={ref} autoPlay playsInline muted className={className} style={mirrored ? { transform: "scaleX(-1)" } : undefined} />;
};

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
  video,
  noise,
}: CallOverlayProps) => {
  const [seconds, setSeconds] = useState(0);
  const [settingsOpen, setSettingsOpen] = useState(false);

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
          remoteVideo={video?.remote || null}
          muted={muted} onToggleMute={onToggleMute} onHangup={onHangup} onExpand={onExpand} />
      </>
    );
  }

  // Видео собеседника — во весь экран, поверх него имя, таймер и кнопки.
  const onVideo = !!video?.remote;
  const chromeBtn = onVideo
    ? "text-white bg-black/30 active:bg-black/50 hover:bg-black/40"
    : "text-muted-foreground active:bg-surface-3 hover:bg-surface-2";
  const roundBtn = (active: boolean) => cn(
    "w-14 h-14 rounded-full border-2 flex items-center justify-center",
    onVideo
      ? active ? "bg-white text-black border-white" : "border-white/50 text-white bg-black/20"
      : active ? "bg-foreground text-background border-foreground" : "border-border",
  );

  return (
    <div
      className={cn("fixed inset-0 z-[60] flex flex-col items-center justify-between", onVideo ? "bg-black text-white" : "bg-background")}
      style={{
        paddingTop: "calc(var(--sat) + 2rem)",
        paddingBottom: "calc(var(--sab) + 2.5rem)",
      }}
    >
      {audio}
      {onVideo && (
        <>
          <VideoView stream={video!.remote!} className="absolute inset-0 w-full h-full object-cover" />
          <div className="absolute inset-x-0 top-0 h-44 bg-gradient-to-b from-black/60 to-transparent pointer-events-none" aria-hidden />
          <div className="absolute inset-x-0 bottom-0 h-56 bg-gradient-to-t from-black/70 to-transparent pointer-events-none" aria-hidden />
        </>
      )}
      {/* Своя камера — окошком в углу. */}
      {video?.local && (
        <div className="absolute right-3 z-10 w-28 h-40 md:w-40 md:h-56 rounded-xl overflow-hidden shadow-xl border border-white/20 bg-black"
          style={{ top: "calc(var(--sat) + 3.75rem)" }}>
          <VideoView stream={video.local} mirrored={video.mirrored} className="w-full h-full object-cover" />
        </div>
      )}
      {onMinimize && state !== "incoming" && (
        <button
          type="button"
          onClick={onMinimize}
          className={cn("absolute z-10 left-3 w-11 h-11 rounded-full flex items-center justify-center", chromeBtn)}
          style={{ top: "calc(var(--sat) + 0.5rem)" }}
          aria-label={t("Свернуть звонок")}
          title={t("Свернуть звонок")}
        >
          <ChevronDown className="w-7 h-7" />
        </button>
      )}
      {noise && state !== "incoming" && (
        <>
          <button
            type="button"
            onClick={() => setSettingsOpen((v) => !v)}
            className={cn("absolute z-20 right-3 w-11 h-11 rounded-full flex items-center justify-center", chromeBtn)}
            style={{ top: "calc(var(--sat) + 0.5rem)" }}
            aria-label={t("Настройки звонка")}
            title={t("Настройки звонка")}
          >
            <Settings2 className="w-6 h-6" />
          </button>
          {settingsOpen && (
            <>
              <div className="absolute inset-0 z-20" onClick={() => setSettingsOpen(false)} aria-hidden />
              <div className="absolute z-30 right-3 w-72 rounded-lg bg-surface-1 text-foreground border border-border shadow-xl p-3"
                style={{ top: "calc(var(--sat) + 3.25rem)" }}>
                <label className="flex items-center gap-3 cursor-pointer">
                  <span className="flex-1 min-w-0">
                    <span className="block text-body font-medium">{t("Шумоподавление")}</span>
                    <span className="block text-caption text-subtle">{t("Убирает фоновый шум микрофона. Выключите, если голос звучит глухо или нужна музыка")}</span>
                  </span>
                  <input type="checkbox" className="w-5 h-5 accent-primary shrink-0" checked={noise.on} onChange={noise.onToggle} aria-label={t("Шумоподавление")} />
                </label>
              </div>
            </>
          )}
        </>
      )}

      <div className={cn("relative z-10 flex flex-col items-center gap-3 w-full min-h-0 px-5", onVideo && "self-start items-start")}>
        {onVideo ? null : isGroup ? (
          <div className="w-24 h-24 rounded-full bg-secondary flex items-center justify-center">
            <Users className="w-12 h-12 text-primary" />
          </div>
        ) : (
          <Identicon id={peer.id} avatarUrl={peer.avatarUrl} className="w-24 h-24" />
        )}
        <div className={cn("text-2xl font-bold truncate max-w-full", onVideo ? "pl-12 pr-36 text-left drop-shadow" : "text-center px-4")}>{peer.name}</div>
        <div className={cn("text-sm", onVideo ? "pl-12 text-white/85 drop-shadow" : "text-muted-foreground")}>{statusText}</div>

        {showList && participants.length > 0 && !onVideo && (
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

      <div className={cn("relative z-10 flex items-center flex-wrap justify-center", video ? "gap-4" : "gap-5")}>
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
              className={roundBtn(muted)}
              aria-label={muted ? t("Включить микрофон") : t("Выключить микрофон")}
            >
              {muted ? <MicOff className="w-6 h-6" /> : <Mic className="w-6 h-6" />}
            </button>
            {video && (
              <button
                type="button"
                onClick={() => {
                  if (!video.available && !video.local) {
                    toast(t("У собеседника версия без видеозвонков — видео появится, когда он обновит приложение"));
                    return;
                  }
                  video.onToggle();
                }}
                disabled={video.busy}
                className={cn(roundBtn(!!video.local), !video.available && !video.local && "opacity-50")}
                aria-label={video.local ? t("Выключить камеру") : t("Включить камеру")}
                title={video.local ? t("Выключить камеру") : t("Включить камеру")}
              >
                {video.local ? <Video className="w-6 h-6" /> : <VideoOff className="w-6 h-6" />}
              </button>
            )}
            {video?.local && video.canFlip && (
              <button type="button" onClick={video.onFlip} className={roundBtn(false)} aria-label={t("Переключить камеру")} title={t("Переключить камеру")}>
                <SwitchCamera className="w-6 h-6" />
              </button>
            )}
            <button
              type="button"
              onClick={onToggleSpeaker}
              className={roundBtn(speaker)}
              aria-label={speaker ? t("Выключить громкую связь") : t("Включить громкую связь")}
            >
              {speaker ? <Volume2 className="w-6 h-6" /> : <VolumeX className="w-6 h-6" />}
            </button>
            {onAdd && state === "active" && (
              <button
                type="button"
                onClick={onAdd}
                className={roundBtn(false)}
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
const CallWidget = ({ peer, isGroup, status, muted, onToggleMute, onHangup, onExpand, remoteVideo }: {
  peer: { id: string; name: string; avatarUrl?: string | null };
  isGroup?: boolean;
  remoteVideo?: MediaStream | null;
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
            {remoteVideo ? (
              <VideoView stream={remoteVideo} className="w-9 h-12 rounded-md object-cover bg-black" />
            ) : isGroup ? (
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
