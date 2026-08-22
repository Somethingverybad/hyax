import { useCallback, useEffect, useRef, useState } from "react";

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

/** Дольше минуты — уже не «сообщение на бегу», обрываем сами. */
const MAX_SECONDS = 60;

export function useMediaRecorder() {
  const [recording, setRecording] = useState(false);
  const [seconds, setSeconds] = useState(0);
  const [stream, setStream] = useState<MediaStream | null>(null);
  const kindRef = useRef<RecordKind>("audio");
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<BlobPart[]>([]);
  const streamRef = useRef<MediaStream | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const startedAtRef = useRef(0);
  const resolveRef = useRef<((r: VoiceRecording | null) => void) | null>(null);
  const cancelledRef = useRef(false);

  const cleanup = useCallback(() => {
    if (timerRef.current) clearInterval(timerRef.current);
    timerRef.current = null;
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    recorderRef.current = null;
    setStream(null);
    setRecording(false);
    setSeconds(0);
  }, []);

  const start = useCallback(async (kind: RecordKind = "audio"): Promise<boolean> => {
    if (recorderRef.current) return false;
    kindRef.current = kind;
    try {
      const media = await navigator.mediaDevices.getUserMedia(
        kind === "video"
          ? {
              audio: true,
              video: {
                facingMode: "user",
                width: { ideal: 480 },
                height: { ideal: 480 },
                frameRate: { ideal: 24 },
              },
            }
          : { audio: true }
      );
      const candidates =
        kind === "video"
          ? ["video/mp4", "video/webm;codecs=vp8,opus", "video/webm"]
          : ["audio/webm;codecs=opus", "audio/mp4", "audio/webm"];
      const mime = candidates.find((c) => MediaRecorder.isTypeSupported(c)) || "";
      const recorder = mime ? new MediaRecorder(media, { mimeType: mime }) : new MediaRecorder(media);
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
        const done = resolveRef.current;
        resolveRef.current = null;
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
      recorderRef.current = recorder;
      startedAtRef.current = Date.now();
      recorder.start();
      setStream(kind === "video" ? stream : null);
      setRecording(true);
      setSeconds(0);
      timerRef.current = setInterval(() => {
        const elapsed = Math.round((Date.now() - startedAtRef.current) / 1000);
        setSeconds(elapsed);
        if (elapsed >= MAX_SECONDS) {
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

  useEffect(() => cleanup, [cleanup]);

  return { recording, seconds, stream, start, stop };
}
