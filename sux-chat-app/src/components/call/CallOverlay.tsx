import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { playRingtone, resolveRingtoneUrl } from "@/lib/ringtone";
import { readCache } from "@/lib/session-cache";
import { playSfx } from "@/lib/sfx";
import { hasCallKit } from "@/lib/voip";
import type { AudioLevels, PeerRect, VideoRect } from "@/lib/nativeCall";
import type { ObsView } from "@/lib/obsRelay";
import { Capacitor } from "@capacitor/core";
import { Mic, MicOff, Phone, PhoneOff, Volume2, VolumeX, Volume1, Users, UserPlus, ChevronDown, Video, VideoOff, SwitchCamera, Settings2, LayoutGrid, AudioLines, Copy, Radio, ScreenShare, ScreenShareOff, MessageSquare } from "lucide-react";
import { toast } from "sonner";
import Identicon from "@/components/Identicon";
import { RailCallPortal } from "@/components/call/RailCall";
import VideoView from "./VideoView";
import GroupStage, { StageMask, type StageMode, type StageTile } from "./GroupStage";

const STAGE_MODE_KEY = "hyax:call-stage-mode";
const readStageMode = (): StageMode => {
  try { return localStorage.getItem(STAGE_MODE_KEY) === "speaker" ? "speaker" : "grid"; } catch { return "grid"; }
};
import { cn } from "@/lib/utils";
import { t } from "@/lib/i18n";
import { useMint, MintIcon } from "@/themes/mint";

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
  /** Трансляция в OBS (браузер и компьютер) — в настройках звонка. */
  obs?: CallObs;
  /** Звонок транслируется: «Вы транслируете…» / «Андрей транслирует…». */
  broadcast?: string | null;
  /** Звук компьютера собеседников при демонстрации — свои дорожки рядом с голосами
   *  (громкость — volumes[id], id вида «участник#screen»). */
  extraAudio?: { id: string; stream: MediaStream }[];
  /** Групповой звонок: плитки участников вместе с собой. */
  stage?: {
    tiles: StageTile[];
    getLevels?: () => Promise<AudioLevels>;
    nativeLayout?: (remotes: PeerRect[], local: VideoRect | null) => void;
  };
  /** Свёрнут: вместо экрана — виджет под шапкой, можно ходить по приложению. */
  minimized?: boolean;
  onMinimize?: () => void;
  onExpand?: () => void;
  /** Мой микрофон не открылся — текст подсказки (lib/callMic); звонок идёт без голоса. */
  micMissing?: string | null;
  /** У собеседника нет микрофона — он отвечает в чате. */
  peerNoMic?: boolean;
  /** Открыть переписку звонка (звонок сворачивается и продолжается). */
  onOpenChat?: () => void;
}

export interface CallObs {
  on: boolean;
  /** Сколько страниц OBS сейчас получают звонок. */
  pages: number;
  onToggle: () => void;
  /** Скопировать ссылку: весь звонок (без id) или один участник; view — видео:
   *  камеры с голосом или демонстрация экрана (без него — только звук). */
  onCopy: (peerId?: string | null, view?: ObsView | null) => void;
  /** Новая ссылка — прежние перестают работать. */
  onRenew: () => void;
  people: { id: string; name: string }[];
}

export interface CallVideo {
  local: MediaStream | null;
  remote: MediaStream | null;
  /** Моя камера включена. */
  localOn: boolean;
  /** Камера собеседника включена. */
  remoteOn: boolean;
  /** У собеседника версия с видео — камеру можно включать. */
  available: boolean;
  /** Ответ собеседника уже пришёл; до этого available ничего не значит. */
  known: boolean;
  busy?: boolean;
  canFlip: boolean;
  /** Фронтальная камера — своё превью зеркалим. */
  mirrored: boolean;
  onToggle: () => void;
  onFlip: () => void;
  /** Демонстрация экрана собеседника — во весь экран, его камера окошком. */
  screen?: MediaStream | null;
  /** То же в приложении: картинку рисует движок (окно `${peerId}#screen`). */
  nativeScreen?: boolean;
  /** Я показываю экран. */
  screenOn?: boolean;
  /** …со звуком компьютера. */
  screenAudioOn?: boolean;
  /** Показать экран можно (компьютер, у собеседника новая версия). */
  canScreen?: boolean;
  /** Захват есть, но собеседник экран не увидит (телефон, старая версия). */
  screenUnavailable?: boolean;
  screenBusy?: boolean;
  onScreen?: () => void;
  /** Приложение: видео рисует нативный движок под прозрачной страницей,
   *  потоков в JS нет — сюда отдаём, где рисовать (пусто — не рисовать). */
  nativeLayout?: (remotes: PeerRect[], local: VideoRect | null) => void;
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
  micMissing,
  peerNoMic,
  onOpenChat,
  video,
  extraAudio,
  noise,
  obs,
  broadcast,
  stage,
}: CallOverlayProps) => {
  const [seconds, setSeconds] = useState(0);
  // «Мята»: экран звонка 1:1 без видео — по макету (аватар 98, крупные кнопки, док).
  const mint = useMint();
  const [settingsOpen, setSettingsOpen] = useState(false);
  // Что передавать в OBS по ссылке: звук, камеры или демонстрацию.
  const [obsKind, setObsKind] = useState<"audio" | ObsView>("audio");
  const [stageMode, setStageModeState] = useState<StageMode>(readStageMode);
  const setStageMode = (m: StageMode) => {
    setStageModeState(m);
    try { localStorage.setItem(STAGE_MODE_KEY, m); } catch { /* без памяти — не страшно */ }
  };
  // Где под страницей нативное видео группового звонка — там не рисуем фон.
  const [holes, setHoles] = useState<VideoRect[]>([]);
  const onHoles = useCallback((h: VideoRect[]) => {
    setHoles((prev) => (JSON.stringify(prev) === JSON.stringify(h) ? prev : h));
  }, []);

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

  // Нативное видео: рамки-заглушки на странице, по ним движок ставит картинку.
  const fullRef = useRef<HTMLDivElement>(null);
  const cornerRef = useRef<HTMLDivElement>(null);
  const peerCornerRef = useRef<HTMLDivElement>(null);
  // Только личный звонок: в групповом раскладкой занимается GroupStage.
  const nativeLayout = isGroup ? undefined : video?.nativeLayout;
  const remoteOn = !!video?.remoteOn;
  const localOn = !!video?.localOn;
  const nativeScreen = !!nativeLayout && !!video?.nativeScreen;
  const nativeShown = !!nativeLayout && state !== "idle" && !(minimized && state !== "incoming") && (remoteOn || localOn || nativeScreen);
  const layoutRef = useRef(nativeLayout);
  layoutRef.current = nativeLayout;
  useLayoutEffect(() => {
    if (!nativeLayout) return;
    document.documentElement.classList.toggle("native-video", nativeShown);
    if (!nativeShown) {
      nativeLayout([], null);
      return;
    }
    const rect = (el: HTMLElement | null): VideoRect | null => {
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return { x: r.left, y: r.top, w: r.width, h: r.height };
    };
    // Собеседник без камеры — своё видео во весь экран, иначе окошком в углу.
    // Демонстрация собеседника — во весь экран целиком, камеры — окошками.
    const push = () => {
      const full = rect(fullRef.current);
      const corner = rect(cornerRef.current);
      if (nativeScreen) {
        const peerCam = rect(peerCornerRef.current);
        nativeLayout(
          [
            ...(full ? [{ ...full, peerId: `${peer.id}#screen`, fit: true }] : []),
            ...(remoteOn && peerCam ? [{ ...peerCam, peerId: peer.id, r: 12, over: true }] : []),
          ],
          localOn && corner ? { ...corner, r: 12 } : null,
        );
        return;
      }
      nativeLayout(
        remoteOn && full ? [{ ...full, peerId: peer.id }] : [],
        localOn ? (remoteOn ? (corner && { ...corner, r: 12 }) : full) : null,
      );
    };
    push();
    const ro = new ResizeObserver(push);
    if (fullRef.current) ro.observe(fullRef.current);
    if (cornerRef.current) ro.observe(cornerRef.current);
    if (peerCornerRef.current) ro.observe(peerCornerRef.current);
    window.addEventListener("resize", push);
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", push);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nativeLayout, nativeShown, remoteOn, localOn, nativeScreen, peer.id]);
  // Экран звонка закрылся — страницу вернуть, видео из-под неё убрать.
  useLayoutEffect(() => () => {
    if (!layoutRef.current) return;
    document.documentElement.classList.remove("native-video");
    layoutRef.current([], null);
  }, []);

  if (state === "idle") return null;

  const showList = state === "active" || state === "connecting" || (state === "outgoing" && participants.length > 1);
  const statusText = state === "active"
    ? isGroup
      ? `${fmt(seconds)} · ${t("участников: {n}", { n: participants.length + 1 })}`
      : fmt(seconds)
    : t(STATUS[state]);
  // Звук собеседников — и в свёрнутом виде: экран звонка не размонтируется,
  // поэтому и таймер не сбрасывается.
  const audio = [
    ...participants.map((p) => p.stream ? <RemoteAudio key={p.id} stream={p.stream} volume={volumes[p.id] ?? 1} /> : null),
    ...(extraAudio ?? []).map((x) => <RemoteAudio key={x.id} stream={x.stream} volume={volumes[x.id] ?? 1} />),
  ];

  // Входящий не сворачивается — на него надо ответить.
  if (minimized && state !== "incoming") {
    return (
      <>
        {audio}
        {/* Широкое окно: столбиком в панели разделов на месте плеера (RailCall); телефон — плашка. */}
        <RailCallPortal peer={peer} isGroup={isGroup} status={state === "active" ? `${t("Звонок")} · ${statusText}` : statusText}
          muted={muted} onToggleMute={onToggleMute} onHangup={onHangup} onExpand={onExpand}
          fallback={<CallWidget peer={peer} isGroup={isGroup} status={state === "active" ? `${t("Звонок")} · ${statusText}` : statusText}
            remoteVideo={video?.screen || video?.remote || null}
            muted={muted} onToggleMute={onToggleMute} onHangup={onHangup} onExpand={onExpand} />} />
      </>
    );
  }

  // Кнопки разговора — общие для личного и группового экрана.
  // glyphs — значки клавиш из макета «Мяты» (экран 1:1 без видео).
  const renderControls = (roundBtn: (active: boolean) => string, glyphs = false) => (
    <>
      <button
        type="button"
        onClick={micMissing ? () => toast(micMissing) : onToggleMute}
        className={cn(roundBtn(muted), micMissing && "opacity-50")}
        aria-label={micMissing ? t("Микрофон недоступен") : muted ? t("Включить микрофон") : t("Выключить микрофон")}
        title={micMissing || undefined}
      >
        {glyphs ? <MintIcon name={muted ? "callMicOff" : "callMic"} size={[65, 55]} /> : muted ? <MicOff className="w-6 h-6" /> : <Mic className="w-6 h-6" />}
      </button>
      {video && (
        <button
          type="button"
          onClick={() => {
            if (video.known && !video.available && !video.localOn) {
              toast(t("У собеседника версия без видеозвонков — видео появится, когда он обновит приложение"));
              return;
            }
            video.onToggle();
          }}
          disabled={video.busy}
          className={cn(roundBtn(video.localOn), video.known && !video.available && !video.localOn && "opacity-50")}
          aria-label={video.localOn ? t("Выключить камеру") : t("Включить камеру")}
          title={video.localOn ? t("Выключить камеру") : t("Включить камеру")}
        >
          {glyphs ? <MintIcon name={video.localOn ? "callCam" : "callCamOff"} size={video.localOn ? [30, 20] : [30, 23]} /> : video.localOn ? <Video className="w-6 h-6" /> : <VideoOff className="w-6 h-6" />}
        </button>
      )}
      {video?.localOn && video.canFlip && (
        <button type="button" onClick={video.onFlip} className={roundBtn(false)} aria-label={t("Переключить камеру")} title={t("Переключить камеру")}>
          <SwitchCamera className="w-6 h-6" />
        </button>
      )}
      {/* Демонстрация экрана — с компьютера (браузер, программа WYX). */}
      {video?.onScreen && (video.canScreen || video.screenUnavailable || video.screenOn) && (
        <button
          type="button"
          onClick={() => {
            if (video.screenUnavailable && !video.screenOn) {
              toast(t("Собеседник не увидит экран: у него приложение на телефоне или старая версия"));
              return;
            }
            video.onScreen?.();
          }}
          disabled={video.screenBusy}
          className={cn(roundBtn(!!video.screenOn), video.screenUnavailable && !video.screenOn && "opacity-50")}
          aria-label={video.screenOn ? t("Перестать показывать экран") : t("Показать экран")}
          title={video.screenOn ? t("Перестать показывать экран") : t("Показать экран")}
        >
          {video.screenOn ? <ScreenShareOff className="w-6 h-6" /> : <ScreenShare className="w-6 h-6" />}
        </button>
      )}
      <button
        type="button"
        onClick={onToggleSpeaker}
        className={roundBtn(speaker)}
        aria-label={speaker ? t("Выключить громкую связь") : t("Включить громкую связь")}
      >
        {glyphs ? <MintIcon name={speaker ? "callSpeaker" : "callSpeakerOff"} size={[28, 23]} /> : speaker ? <Volume2 className="w-6 h-6" /> : <VolumeX className="w-6 h-6" />}
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
        className={glyphs ? "mint-call-key mint-call-key-end" : "w-14 h-14 rounded-full bg-[#ff3b30] text-white flex items-center justify-center"}
        aria-label={t("Завершить")}
      >
        {glyphs ? <MintIcon name="callEnd" size={[27, 27]} /> : <PhoneOff className="w-6 h-6" />}
      </button>
    </>
  );

  // Показываю экран — плашка с «Остановить» (личный и групповой экран).
  const screenPill = video?.screenOn ? (
    <button type="button" onClick={video.onScreen}
      className="inline-flex items-center gap-1.5 max-w-full rounded-full px-3 py-1 text-caption font-medium bg-primary text-primary-foreground shadow active:opacity-80">
      <ScreenShare className="w-3.5 h-3.5 shrink-0" aria-hidden />
      <span className="truncate">{video.screenAudioOn ? t("Вы показываете экран со звуком") : t("Вы показываете экран")} · <span className="underline">{t("Остановить")}</span></span>
    </button>
  ) : null;

  // Микрофона нет — звонок без голоса: подсказка и переход в переписку.
  const noMicPill = micMissing && state !== "incoming" ? (
    <span className="inline-flex items-center gap-2 max-w-full rounded-full pl-3 pr-1 py-1 text-caption font-medium bg-[#ff9500]/15 text-[#b25f00] dark:text-[#ffb340]" role="status">
      <MicOff className="w-3.5 h-3.5 shrink-0" aria-hidden />
      <span className="truncate">{micMissing}</span>
      {onOpenChat && (
        <button type="button" onClick={onOpenChat} className="shrink-0 rounded-full px-2.5 py-0.5 bg-[#ff9500] text-white font-semibold active:opacity-80">{t("Чат")}</button>
      )}
    </span>
  ) : null;

  // Пометка «звонок транслируется» — видят все участники.
  const broadcastPill = (onDark: boolean) => (
    <span className={cn("inline-flex items-center gap-1.5 max-w-full rounded-full px-3 py-1 text-caption font-medium",
      onDark ? "bg-black/45 text-white" : "bg-[#ff3b30]/10 text-[#d70015] dark:text-[#ff6961]")} role="status">
      <span className="w-2 h-2 rounded-full bg-[#ff3b30] shrink-0 animate-pulse" aria-hidden />
      <span className="truncate">{broadcast}</span>
    </span>
  );

  // Настройки звонка: шумодав и трансляция в OBS.
  const settingsPanel = (top: string) => (
    <>
      <div className="absolute inset-0 z-20" onClick={() => setSettingsOpen(false)} aria-hidden />
      <div className="absolute z-30 right-3 w-80 max-w-[calc(100vw-1.5rem)] max-h-[70vh] overflow-y-auto rounded-lg bg-surface-1 text-foreground border border-border shadow-xl p-3 space-y-3"
        style={{ top }}>
        {noise && (
          <label className="flex items-center gap-3 cursor-pointer">
            <span className="flex-1 min-w-0">
              <span className="block text-body font-medium">{t("Шумоподавление")}</span>
              <span className="block text-caption text-subtle">{t("Убирает фоновый шум микрофона. Выключите, если голос звучит глухо или нужна музыка")}</span>
            </span>
            <input type="checkbox" className="w-5 h-5 accent-primary shrink-0" checked={noise.on} onChange={noise.onToggle} aria-label={t("Шумоподавление")} />
          </label>
        )}
        {obs && (
          <div className={cn("space-y-2", noise && "pt-3 border-t border-border")}>
            <label className="flex items-center gap-3 cursor-pointer">
              <Radio className={cn("w-5 h-5 shrink-0", obs.on ? "text-[#ff3b30]" : "text-subtle")} />
              <span className="flex-1 min-w-0">
                <span className="block text-body font-medium">{t("Трансляция в OBS")}</span>
                <span className="block text-caption text-subtle">
                  {!obs.on
                    ? t("Звук и видео звонка — в OBS или другую программу для стримов. Участники увидят, что звонок транслируется")
                    : obs.pages
                      ? t("Звонок идёт в OBS: источников — {n}", { n: obs.pages })
                      : t("Ждём OBS: добавьте ссылку как источник «Браузер»")}
                </span>
              </span>
              <input type="checkbox" className="w-5 h-5 accent-primary shrink-0" checked={obs.on} onChange={obs.onToggle} aria-label={t("Трансляция в OBS")} />
            </label>
            <div className="flex rounded-md bg-surface-2 p-0.5" role="tablist" aria-label={t("Что передавать в OBS")}>
              {([["audio", t("Звук")], ["cam", t("Видео")], ["screen", t("Экран")]] as const).map(([k, label]) => (
                <button key={k} type="button" role="tab" aria-selected={obsKind === k} onClick={() => setObsKind(k)}
                  className={cn("flex-1 rounded px-2 py-1 text-small", obsKind === k ? "bg-surface-1 text-foreground shadow-sm font-medium" : "text-subtle")}>
                  {label}
                </button>
              ))}
            </div>
            <div className="rounded-md bg-surface-2 divide-y divide-border">
              <button type="button" onClick={() => obs.onCopy(null, obsKind === "audio" ? null : obsKind)} className="w-full flex items-center gap-2 px-3 py-2 text-left text-small active:bg-surface-3">
                <Copy className="w-4 h-4 shrink-0 text-subtle" />
                <span className="flex-1 min-w-0 truncate">{obsKind === "screen" ? t("Ссылка: кто показывает экран") : t("Ссылка: весь звонок")}</span>
              </button>
              {obs.people.map((p) => (
                <button key={p.id} type="button" onClick={() => obs.onCopy(p.id, obsKind === "audio" ? null : obsKind)} className="w-full flex items-center gap-2 px-3 py-2 text-left text-small active:bg-surface-3">
                  <Copy className="w-4 h-4 shrink-0 text-subtle" />
                  <span className="flex-1 min-w-0 truncate">{t("Ссылка: {name}", { name: p.name })}</span>
                </button>
              ))}
            </div>
            <p className="text-caption text-subtle">
              {obsKind === "audio"
                ? t("В OBS: Источники → «+» → Браузер, вставьте ссылку и включите «Управлять звуком через OBS». Ссылка на одного участника — отдельный ползунок в микшере. Свой микрофон в OBS можно не добавлять: ваш голос тоже идёт из звонка.")
                : obsKind === "cam"
                  ? t("Камера и голос без интерфейса WYX, фон прозрачный: один участник — во всё окно, весь звонок — сеткой. Камера выключена — аватарка. Каждую ссылку — отдельным источником «Браузер», размер — как у сцены.")
                  : t("Демонстрация экрана во всё окно со звуком компьютера показывающего, без голосов и интерфейса WYX. «Кто показывает» — того, кто показывает сейчас; никто — источник прозрачный.")}
            </p>
            <button type="button" onClick={obs.onRenew} className="text-caption text-subtle underline underline-offset-2">
              {t("Новая ссылка (прежние перестанут работать)")}
            </button>
          </div>
        )}
      </div>
    </>
  );

  // Групповой звонок: плитки участников (сетка или «говорящий»).
  if (isGroup && stage && state !== "incoming") {
    const masked = holes.length > 0;
    const gBtn = (active: boolean) => cn(
      "w-14 h-14 rounded-full border-2 flex items-center justify-center",
      active ? "bg-foreground text-background border-foreground" : "border-border bg-background",
    );
    const headBtn = "w-11 h-11 shrink-0 rounded-full flex items-center justify-center text-muted-foreground active:bg-surface-3 hover:bg-surface-2";
    return (
      <div
        className={cn("call-layer fixed inset-0 z-[60] flex flex-col", masked ? "bg-transparent" : "bg-background")}
        style={{ paddingTop: "var(--sat)", paddingBottom: "calc(var(--sab) + 1.25rem)" }}
      >
        {audio}
        {masked && <StageMask holes={holes} />}
        <div className="relative z-10 shrink-0 flex items-center gap-1 px-2 h-14">
          {onMinimize && (
            <button type="button" onClick={onMinimize} className={headBtn} aria-label={t("Свернуть звонок")} title={t("Свернуть звонок")}>
              <ChevronDown className="w-7 h-7" />
            </button>
          )}
          <div className="min-w-0 flex-1 px-1">
            <div className="text-body font-semibold truncate">{peer.name}</div>
            <div className="text-caption text-subtle tabular-nums truncate">{statusText}</div>
          </div>
          {stage.tiles.length > 1 && (
            <div className="shrink-0 flex items-center rounded-full bg-surface-2 p-0.5" role="group" aria-label={t("Вид")}>
              {([["grid", LayoutGrid, t("Сетка")], ["speaker", AudioLines, t("Говорящий")]] as const).map(([m, Icon, label]) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => setStageMode(m)}
                  className={cn("w-9 h-9 rounded-full flex items-center justify-center", stageMode === m ? "bg-background text-foreground shadow-sm" : "text-subtle")}
                  aria-label={label}
                  aria-pressed={stageMode === m}
                  title={label}
                >
                  <Icon className="w-[18px] h-[18px]" />
                </button>
              ))}
            </div>
          )}
          {onOpenChat && state === "active" && (
            <button type="button" onClick={onOpenChat} className={headBtn} aria-label={t("Чат звонка")} title={t("Чат звонка")}>
              <MessageSquare className="w-6 h-6" />
            </button>
          )}
          {(noise || obs) && (
            <button type="button" onClick={() => setSettingsOpen((v) => !v)} className={headBtn} aria-label={t("Настройки звонка")} title={t("Настройки звонка")}>
              <Settings2 className="w-6 h-6" />
            </button>
          )}
        </div>
        {broadcast && <div className="relative z-10 shrink-0 flex justify-center px-2 pb-1">{broadcastPill(false)}</div>}
        {video?.screenOn && <div className="relative z-10 shrink-0 flex justify-center px-2 pb-1">{screenPill}</div>}
        {noMicPill && <div className="relative z-10 shrink-0 flex justify-center px-2 pb-1">{noMicPill}</div>}
        {settingsOpen && settingsPanel("calc(var(--sat) + 3.5rem)")}
        <GroupStage
          className="relative z-10 flex-1 min-h-0 mx-2 mt-1"
          tiles={stage.tiles}
          mode={stageMode}
          onModeChange={setStageMode}
          getLevels={stage.getLevels}
          nativeLayout={stage.nativeLayout}
          onHoles={onHoles}
          volumes={volumes}
          onVolume={onVolume}
        />
        <div className="relative z-10 shrink-0 flex items-center flex-wrap justify-center gap-3 pt-4 px-2">
          {renderControls(gBtn)}
        </div>
      </div>
    );
  }

  // Видео собеседника — во весь экран, поверх него имя, таймер и кнопки.
  // В приложении во весь экран и своё видео, пока собеседник без камеры.
  const native = !!nativeLayout;
  const onVideo = native ? remoteOn || localOn || nativeScreen : !!video?.remote || !!video?.screen;
  // Окошки в углу: своя камера, а при демонстрации собеседника — и его камера.
  const cornerTile = "w-28 h-40 md:w-40 md:h-56 rounded-xl overflow-hidden shadow-xl border border-white/20 bg-black";
  const chromeBtn = onVideo
    ? "text-white bg-black/30 active:bg-black/50 hover:bg-black/40"
    : "text-muted-foreground active:bg-surface-3 hover:bg-surface-2";
  const mintCall = mint && !onVideo;
  const roundBtn = (active: boolean) => mintCall ? cn("mint-call-key", active && "mint-call-key-on") : cn(
    "w-14 h-14 rounded-full border-2 flex items-center justify-center",
    onVideo
      ? active ? "bg-white text-black border-white" : "border-white/50 text-white bg-black/20"
      : active ? "bg-foreground text-background border-foreground" : "border-border",
  );

  return (
    <div
      className={cn("call-layer fixed inset-0 z-[60] flex flex-col items-center justify-between",
        onVideo ? native ? "bg-transparent text-white" : "bg-black text-white" : "bg-background")}
      style={mintCall ? {
        paddingTop: "max(calc(var(--sat) + 2rem), 35vh)",
        paddingBottom: state === "incoming" ? "max(calc(var(--sab) + 2.5rem), 27vh)" : "max(calc(var(--sab) + 2.5rem), 17vh)",
      } : {
        paddingTop: "calc(var(--sat) + 2rem)",
        paddingBottom: "calc(var(--sab) + 2.5rem)",
      }}
    >
      {audio}
      {onVideo && (
        <>
          {native
            ? <div ref={fullRef} className="absolute inset-0 pointer-events-none" aria-hidden />
            : video?.screen
              ? <VideoView stream={video.screen} className="absolute inset-0 w-full h-full object-contain" />
              : <VideoView stream={video!.remote!} className="absolute inset-0 w-full h-full object-cover" />}
          <div className="absolute inset-x-0 top-0 h-44 bg-gradient-to-b from-black/60 to-transparent pointer-events-none" aria-hidden />
          <div className="absolute inset-x-0 bottom-0 h-56 bg-gradient-to-t from-black/70 to-transparent pointer-events-none" aria-hidden />
        </>
      )}
      {/* Своя камера — окошком в углу (в приложении — рамка, картинка под ней);
          при демонстрации собеседника над ней и его камера. */}
      {native && (nativeScreen ? remoteOn || localOn : remoteOn && localOn) && (
        <div className="absolute right-3 z-10 flex flex-col gap-2 pointer-events-none" style={{ top: "calc(var(--sat) + 3.75rem)" }} aria-hidden>
          {nativeScreen && remoteOn && <div ref={peerCornerRef} className="w-28 h-40 md:w-40 md:h-56 rounded-xl border border-white/20" />}
          {localOn && <div ref={cornerRef} className="w-28 h-40 md:w-40 md:h-56 rounded-xl border border-white/20" />}
        </div>
      )}
      {!native && (video?.local || (video?.screen && video.remote)) && (
        <div className="absolute right-3 z-10 flex flex-col gap-2" style={{ top: "calc(var(--sat) + 3.75rem)" }}>
          {video?.screen && video.remote && (
            <div className={cornerTile}><VideoView stream={video.remote} className="w-full h-full object-cover" /></div>
          )}
          {video?.local && (
            <div className={cornerTile}><VideoView stream={video.local} mirrored={video.mirrored} className="w-full h-full object-cover" /></div>
          )}
        </div>
      )}
      {/* Показываю экран — плашка с кнопкой «Остановить» (себе экран не дублируем). */}
      {video?.screenOn && state !== "incoming" && (
        <div className="absolute z-20 inset-x-0 flex justify-center px-16" style={{ top: broadcast ? "calc(var(--sat) + 2.85rem)" : "calc(var(--sat) + 0.85rem)" }}>
          {screenPill}
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
      {(noise || obs) && state !== "incoming" && (
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
          {settingsOpen && settingsPanel("calc(var(--sat) + 3.25rem)")}
        </>
      )}
      {onOpenChat && state === "active" && (
        <button
          type="button"
          onClick={onOpenChat}
          className={cn("absolute z-20 w-11 h-11 rounded-full flex items-center justify-center", chromeBtn, noise || obs ? "right-16" : "right-3")}
          style={{ top: "calc(var(--sat) + 0.5rem)" }}
          aria-label={t("Чат звонка")}
          title={t("Чат звонка")}
        >
          <MessageSquare className="w-6 h-6" />
        </button>
      )}
      {broadcast && state !== "incoming" && (
        <div className="absolute z-10 inset-x-0 flex justify-center pointer-events-none" style={{ top: "calc(var(--sat) + 0.85rem)" }}>
          {broadcastPill(onVideo)}
        </div>
      )}

      <div className={cn("relative z-10 flex flex-col items-center gap-3 w-full min-h-0 px-5", onVideo && "self-start items-start")}>
        {onVideo ? null : isGroup ? (
          <div className="w-24 h-24 rounded-full bg-secondary flex items-center justify-center">
            <Users className="w-12 h-12 text-primary" />
          </div>
        ) : (
          <Identicon id={peer.id} avatarUrl={peer.avatarUrl} className={mintCall ? "w-[98px] h-[98px] mint-call-avatar" : "w-24 h-24"} />
        )}
        <div className={cn("truncate max-w-full", mintCall ? "mt-[14px] text-[26.7px] leading-[30px] font-semibold text-center px-4 mint-call-name" : "text-2xl font-bold", !mintCall && (onVideo ? "pl-12 pr-36 text-left drop-shadow" : "text-center px-4"))}>{peer.name}</div>
        <div className={cn(mintCall ? "text-[16px] text-[#9cb2ab]" : "text-sm", !mintCall && (onVideo ? "pl-12 text-white/85 drop-shadow" : "text-muted-foreground"))}>{statusText}</div>
        {peerNoMic && state === "active" && (
          <div className={cn("text-caption flex items-center gap-1.5", onVideo ? "pl-12 text-white/85 drop-shadow" : "text-subtle")}>
            <MicOff className="w-3.5 h-3.5 shrink-0" aria-hidden />
            <span>{t("Собеседник без микрофона — отвечает в чате")}</span>
          </div>
        )}
        {noMicPill && <div className={cn("mt-1 max-w-full", onVideo && "pl-12")}>{noMicPill}</div>}

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

      <div className={cn("relative z-10 flex items-center justify-center",
        mintCall ? state === "incoming" ? "gap-[25px]" : "mint-call-dock" : cn("flex-wrap", video ? "gap-4" : "gap-5"))}>
        {state === "incoming" ? (
          mintCall ? (
            <>
              <button type="button" onClick={onReject} className="mint-call-big" aria-label={t("Отклонить")}>
                <span className="mint-call-decline"><MintIcon name="callDecline" size={[65, 55]} /></span>
              </button>
              <button type="button" onClick={onAccept} className="mint-call-big" aria-label={t("Принять")}>
                <span className="mint-call-accept"><MintIcon name="callAccept" size={[65, 55]} /></span>
              </button>
            </>
          ) : (
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
          )
        ) : (
          renderControls(roundBtn, mintCall)
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
