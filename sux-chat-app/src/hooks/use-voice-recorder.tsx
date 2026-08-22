import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Запись голосового сообщения удержанием кнопки, как в мессенджерах.
 *
 * Формат выбирается по возможностям движка: WebKit умеет только mp4/aac,
 * Chromium — webm/opus. Сервер принимает оба, поэтому подстраиваемся, а не
 * навязываем один.
 */
export interface VoiceRecording {
  file: File;
  seconds: number;
}

export function useVoiceRecorder() {
  const [recording, setRecording] = useState(false);
  const [seconds, setSeconds] = useState(0);
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
    setRecording(false);
    setSeconds(0);
  }, []);

  const start = useCallback(async (): Promise<boolean> => {
    if (recorderRef.current) return false;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mime = MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
        ? "audio/webm;codecs=opus"
        : MediaRecorder.isTypeSupported("audio/mp4")
          ? "audio/mp4"
          : "";
      const recorder = mime ? new MediaRecorder(stream, { mimeType: mime }) : new MediaRecorder(stream);

      chunksRef.current = [];
      cancelledRef.current = false;
      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };
      recorder.onstop = () => {
        const type = recorder.mimeType || "audio/webm";
        const ext = type.includes("mp4") ? "m4a" : type.includes("ogg") ? "ogg" : "webm";
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
        done?.({ file: new File([blob], `voice.${ext}`, { type }), seconds: elapsed });
      };

      streamRef.current = stream;
      recorderRef.current = recorder;
      startedAtRef.current = Date.now();
      recorder.start();
      setRecording(true);
      setSeconds(0);
      timerRef.current = setInterval(
        () => setSeconds(Math.round((Date.now() - startedAtRef.current) / 1000)),
        250
      );
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

  return { recording, seconds, start, stop };
}
