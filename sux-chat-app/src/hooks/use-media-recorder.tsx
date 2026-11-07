import { useCallback, useEffect, useRef, useState } from "react";
import { Capacitor } from "@capacitor/core";
import { applog } from "@/lib/applog";
import { setBusy } from "@/lib/busy";
import { keepScreenAwake } from "@/lib/screenAwake";
import { micConstraints } from "@/lib/micSettings";

/**
 * Запись сообщения удержанием кнопки: голос или короткое видео с фронтальной
 * камеры («треугольник» — наш ответ кружкам).
 *
 * Формат выбирается по возможностям движка: WebKit умеет mp4, Chromium —
 * webm. Сервер принимает оба, поэтому подстраиваемся, а не навязываем один.
 */
export type RecordKind = "audio" | "video";

export interface VoiceRecording {
  file: File;
  seconds: number;
  kind: RecordKind;
}

type Facing = "user" | "environment";

/** Камера треугольника: снимать больше 360 нет смысла — в чате он 160–280 px,
 *  файл втрое легче, отправка заметно быстрее. */
const camera = (facing: Facing): MediaTrackConstraints => ({
  facingMode: facing,
  width: { ideal: 360 },
  height: { ideal: 360 },
  frameRate: { ideal: 24 },
});

/** getUserMedia с одной повторной попыткой: NotReadableError/AbortError —
 *  устройство ещё занято освобождением предыдущей записи (треки .stop()
 *  отпускаются железом асинхронно). NotAllowedError — настоящий отказ. */
async function getMedia(constraints: MediaStreamConstraints): Promise<MediaStream> {
  try {
    return await navigator.mediaDevices.getUserMedia(constraints);
  } catch (err) {
    const name = (err as { name?: string } | null)?.name;
    const transient = name === "NotReadableError" || name === "AbortError";
    if (!transient) throw err;
    await new Promise((r) => setTimeout(r, 300));
    return await navigator.mediaDevices.getUserMedia(constraints);
  }
}

/**
 * Микрофон начинает отдавать звук не сразу после getUserMedia: на Mac — сотни
 * миллисекунд, с Bluetooth-гарнитурой (AirPods переключаются в режим
 * гарнитуры) — две-три секунды; всё это время в потоке цифровая тишина.
 * Запись и индикатор стартовали сразу — и начало голосового пропадало
 * (баг-репорт afbe1e20, компьютер на Mac). Ждём первого ненулевого отсчёта (не
 * дольше maxMs; пока ждём — «Включаю микрофон… держите кнопку»), и только
 * потом пишем и показываем «идёт запись». Сначала ждали 1,5 с — AirPods не
 * успевали, и секунда тишины оставалась (e4bf89d4: «звук через 1511 мс»).
 * Возвращает, сколько ждали; -1 — проверить нечем (запись идёт как раньше).
 */
const MIC_WAIT_MS = 4000;
async function waitMicLive(stream: MediaStream, maxMs = MIC_WAIT_MS): Promise<number> {
  const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctx || !stream.getAudioTracks().length) return -1;
  const t0 = performance.now();
  let ctx: AudioContext | null = null;
  try {
    ctx = new Ctx();
    if (ctx.state === "suspended") await ctx.resume().catch(() => {});
    if (ctx.state !== "running") return -1;
    const an = ctx.createAnalyser();
    an.fftSize = 512;
    ctx.createMediaStreamSource(stream).connect(an);
    const buf = new Float32Array(an.fftSize);
    while (performance.now() - t0 < maxMs) {
      an.getFloatTimeDomainData(buf);
      if (buf.some((v) => v !== 0)) return Math.round(performance.now() - t0);
      await new Promise((r) => setTimeout(r, 20));
    }
    return Math.round(performance.now() - t0);
  } catch {
    return -1;
  } finally {
    void ctx?.close().catch(() => {});
  }
}

/**
 * Видео треугольника пишется не с камеры напрямую, а с холста, на который
 * рисуется кадр текущей камеры: так камеру можно сменить посреди записи —
 * меняется только источник холста, а MediaRecorder и звук идут дальше
 * (подмена дорожки в записываемом потоке обрывает запись).
 */
interface CameraMix {
  stream: MediaStream;
  setSource: (cam: MediaStream) => void;
  stop: () => void;
}

async function mixCamera(cam: MediaStream): Promise<CameraMix | null> {
  const canvas = document.createElement("canvas");
  if (typeof canvas.captureStream !== "function") return null;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  // Кадры видео без DOM на iOS не обновляются — держим его в документе невидимым.
  const video = document.createElement("video");
  video.muted = true;
  video.playsInline = true;
  video.setAttribute("playsinline", "");
  video.style.cssText = "position:fixed;left:0;top:0;width:2px;height:2px;opacity:0.01;pointer-events:none;z-index:-1";
  document.body.appendChild(video);
  const show = async (s: MediaStream) => {
    video.srcObject = new MediaStream(s.getVideoTracks());
    await video.play().catch(() => {});
  };
  await show(cam);
  // Размер записи — как у первой камеры; другая вписывается в него с обрезкой.
  const st = cam.getVideoTracks()[0]?.getSettings?.() || {};
  canvas.width = (st.width || video.videoWidth || 360) & ~1;
  canvas.height = (st.height || video.videoHeight || 360) & ~1;
  let alive = true;
  let timer = 0;
  const draw = () => {
    if (!alive) return;
    const vw = video.videoWidth, vh = video.videoHeight;
    if (vw && vh && video.readyState >= 2) {
      const k = Math.max(canvas.width / vw, canvas.height / vh);
      const sw = canvas.width / k, sh = canvas.height / k;
      ctx.drawImage(video, (vw - sw) / 2, (vh - sh) / 2, sw, sh, 0, 0, canvas.width, canvas.height);
    }
    timer = window.setTimeout(draw, 1000 / 24);
  };
  draw();
  const out = canvas.captureStream(24);
  return {
    stream: new MediaStream([...out.getVideoTracks(), ...cam.getAudioTracks()]),
    setSource: (s) => { void show(s); },
    stop: () => {
      alive = false;
      window.clearTimeout(timer);
      out.getTracks().forEach((t) => t.stop());
      video.srcObject = null;
      video.remove();
    },
  };
}

/** Пределы записи. Треугольник (видео) — минута: он тяжёлый (~5 МБ).
 *  Голосовое — полторы минуты; дошли до предела — запись уходит сама. */
const MAX_VIDEO_SECONDS = 60;
export const MAX_VOICE_SECONDS = 90;

export function useMediaRecorder() {
  const [recording, setRecording] = useState(false);
  // Пока пишем — «занято»: обновление по воздуху не перезагрузит интерфейс
  // посреди записи (lib/busy, lib/ota). И экран не гаснет: с блокировкой
  // телефон отбирает микрофон, и запись обрывается (lib/screenAwake).
  useEffect(() => {
    if (!recording) return;
    setBusy("record", true);
    keepScreenAwake("record", true);
    return () => { setBusy("record", false); keepScreenAwake("record", false); };
  }, [recording]);
  const [seconds, setSeconds] = useState(0);
  const [stream, setStream] = useState<MediaStream | null>(null);
  // Камера, что снимает сейчас (могли сменить посреди записи), и можно ли менять.
  const [facing, setFacing] = useState<Facing>("user");
  const [canSwitch, setCanSwitch] = useState(false);
  const facingRef = useRef<Facing>("user");
  const mixRef = useRef<CameraMix | null>(null);
  const camRef = useRef<MediaStream | null>(null);
  const switchingRef = useRef(false);
  const kindRef = useRef<RecordKind>("audio");
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<BlobPart[]>([]);
  const streamRef = useRef<MediaStream | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const startedAtRef = useRef(0);
  const resolveRef = useRef<((r: VoiceRecording | null) => void) | null>(null);
  const cancelledRef = useRef(false);
  // Запись дошла до лимита и остановилась сама: отдаём результат сюда — иначе
  // при закреплённой записи (палец уже отпущен) файл было некому забрать.
  const autoStopRef = useRef<((r: VoiceRecording | null) => void) | null>(null);

  const cleanup = useCallback(() => {
    if (timerRef.current) clearInterval(timerRef.current);
    timerRef.current = null;
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    camRef.current?.getTracks().forEach((t) => t.stop());
    camRef.current = null;
    mixRef.current?.stop();
    mixRef.current = null;
    recorderRef.current = null;
    setStream(null);
    setCanSwitch(false);
    setRecording(false);
    setSeconds(0);
  }, []);

  // Микрофон — выбранный в настройках (как у звонков, lib/micSettings): раньше
  // запись брала системный, и с подключёнными AirPods их было не обойти.
  const acquire = (kind: RecordKind, facing: Facing): Promise<MediaStream> =>
    getMedia(kind === "video" ? { audio: micConstraints(), video: camera(facing) } : { audio: micConstraints() });

  const start = useCallback(async (
    kind: RecordKind = "audio",
    facing: Facing = "user",
    onAutoStop?: (r: VoiceRecording | null) => void,
  ): Promise<boolean> => {
    if (recorderRef.current) return false;
    kindRef.current = kind;
    autoStopRef.current = onAutoStop ?? null;
    try {
      const media = await acquire(kind, facing);
      // Ждём, пока микрофон реально зазвучит (waitMicLive). Не на iPhone:
      // там звук приложения ведёт аудиосессия, лишний AudioContext в неё не тащим.
      if (Capacitor.getPlatform() !== "ios") {
        const waited = await waitMicLive(media);
        const label = media.getAudioTracks()[0]?.label || "?";
        applog.info(`rec mic «${label.slice(0, 40)}» ${waited < 0 ? "без проверки" : waited >= MIC_WAIT_MS ? `звука нет и через ${waited} мс — пишем как есть` : `звук через ${waited} мс`}`);
      }
      const candidates =
        kind === "video"
          ? ["video/mp4", "video/webm;codecs=vp8,opus", "video/webm"]
          // WebKit (iPhone, Safari) пишет WebM/Opus, но из памяти (blob:) его
          // не играет и волну по нему не строит — секретные голосовые были
          // немыми. MP4/AAC он играет откуда угодно, остальные — тоже.
          : /AppleWebKit/.test(navigator.userAgent) && !/Chrome|Chromium|Edg|Electron/.test(navigator.userAgent)
            ? ["audio/mp4", "audio/webm;codecs=opus", "audio/webm"]
            : ["audio/webm;codecs=opus", "audio/mp4", "audio/webm"];
      const mime = candidates.find((c) => MediaRecorder.isTypeSupported(c)) || "";
      // Битрейт пониже: минутный треугольник ~5 МБ вместо 15, голос — ~0.4 МБ.
      const options: MediaRecorderOptions = kind === "video"
        ? { videoBitsPerSecond: 700_000, audioBitsPerSecond: 64_000 }
        : { audioBitsPerSecond: 48_000 };
      if (mime) options.mimeType = mime;
      // Видео — через холст (mixCamera), чтобы камеру можно было сменить на
      // ходу. Не вышло собрать — пишем камеру напрямую, как раньше, без смены.
      let mix: CameraMix | null = null;
      if (kind === "video") {
        try { mix = await mixCamera(media); } catch { mix = null; }
      }
      const make = (src: MediaStream) => {
        try { return new MediaRecorder(src, options); }
        catch { return mime ? new MediaRecorder(src, { mimeType: mime }) : new MediaRecorder(src); }
      };
      let recorder: MediaRecorder;
      if (mix) {
        // Движок не пишет поток с холста — пишем камеру напрямую.
        try { recorder = make(mix.stream); }
        catch { mix.stop(); mix = null; recorder = make(media); }
      } else {
        recorder = make(media);
      }
      const stream = media;

      chunksRef.current = [];
      cancelledRef.current = false;
      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };
      recorder.onstop = () => {
        const kindNow = kindRef.current;
        const type = recorder.mimeType || (kindNow === "video" ? "video/webm" : "audio/webm");
        const ext = type.includes("mp4")
          ? kindNow === "video"
            ? "mp4"
            : "m4a"
          : type.includes("ogg")
            ? "ogg"
            : "webm";
        const blob = new Blob(chunksRef.current, { type });
        const elapsed = Math.max(1, Math.round((Date.now() - startedAtRef.current) / 1000));
        const done = resolveRef.current ?? autoStopRef.current;
        resolveRef.current = null;
        autoStopRef.current = null;
        cleanup();
        // Слишком короткое нажатие — это промах по кнопке, а не сообщение.
        if (cancelledRef.current || blob.size < 1200 || elapsed < 1) {
          done?.(null);
          return;
        }
        const name = kindNow === "video" ? `video.${ext}` : `voice.${ext}`;
        done?.({ file: new File([blob], name, { type }), seconds: elapsed, kind: kindNow });
      };

      streamRef.current = stream;
      mixRef.current = mix;
      facingRef.current = facing;
      setFacing(facing);
      // Кнопка смены — если есть что менять: вторая камера на устройстве.
      if (mix) {
        void navigator.mediaDevices.enumerateDevices?.()
          .then((d) => { if (mixRef.current === mix) setCanSwitch(d.filter((x) => x.kind === "videoinput").length > 1); })
          .catch(() => {});
      }
      recorderRef.current = recorder;
      startedAtRef.current = Date.now();
      recorder.start();
      setStream(kind === "video" ? stream : null);
      setRecording(true);
      setSeconds(0);
      timerRef.current = setInterval(() => {
        const elapsed = Math.round((Date.now() - startedAtRef.current) / 1000);
        setSeconds(elapsed);
        if (elapsed >= (kind === "video" ? MAX_VIDEO_SECONDS : MAX_VOICE_SECONDS)) {
          try {
            recorder.stop();
          } catch {
            /* уже остановлен */
          }
        }
      }, 250);
      return true;
    } catch {
      cleanup();
      return false;
    }
  }, [cleanup]);

  /** Останавливает запись. cancel — выбросить, иначе вернуть файл. */
  const stop = useCallback((cancel = false): Promise<VoiceRecording | null> => {
    const recorder = recorderRef.current;
    if (!recorder) return Promise.resolve(null);
    cancelledRef.current = cancel;
    return new Promise((resolve) => {
      resolveRef.current = resolve;
      try {
        recorder.stop();
      } catch {
        cleanup();
        resolve(null);
      }
    });
  }, [cleanup]);

  /** Сменить камеру посреди записи треугольника (фронтальная ↔ задняя).
   *  Вернёт камеру, что снимает теперь, или null — не вышло. */
  const switchCamera = useCallback(async (): Promise<Facing | null> => {
    const mix = mixRef.current;
    if (!mix || switchingRef.current) return null;
    switchingRef.current = true;
    const prev = facingRef.current;
    const next: Facing = prev === "user" ? "environment" : "user";
    // iPhone держит одну камеру: прежнюю отпускаем до запроса новой. На это
    // время холст держит последний кадр, запись и звук идут дальше.
    const stopVideo = () => {
      streamRef.current?.getVideoTracks().forEach((t) => t.stop());
      camRef.current?.getTracks().forEach((t) => t.stop());
      camRef.current = null;
    };
    const take = async (f: Facing) => {
      const cam = await getMedia({ video: camera(f) });
      // Запись успела закончиться, пока камера просыпалась, — она не нужна.
      if (mixRef.current !== mix) { cam.getTracks().forEach((t) => t.stop()); return false; }
      camRef.current = cam;
      mix.setSource(cam);
      facingRef.current = f;
      setFacing(f);
      setStream(cam);
      return true;
    };
    try {
      stopVideo();
      return (await take(next)) ? next : null;
    } catch {
      // Новая не открылась — возвращаем прежнюю.
      try { await take(prev); } catch { /* останется последний кадр */ }
      return null;
    } finally {
      switchingRef.current = false;
    }
  }, []);

  useEffect(() => cleanup, [cleanup]);

  return { recording, seconds, stream, start, stop, facing, canSwitch, switchCamera };
}
