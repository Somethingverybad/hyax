import { applog } from "@/lib/applog";

/**
 * Микрофон для звонка (браузер и программа WYX). Не открылся — микрофона нет,
 * он занят или доступ запрещён — звонок всё равно идёт: вместо голоса тихая
 * дорожка, человек слышит и видит собеседника и отвечает в чате. Раньше звонок
 * просто не начинался («Не удалось получить доступ к микрофону»); на Linux так
 * выходило, когда Chromium не видел ни одного устройства (баг-репорт fa81ad31).
 */
export type CallMic = {
  stream: MediaStream;
  /** Микрофона нет — дорожка тихая. */
  missing: boolean;
  /** Почему: NotFoundError (нет устройства), NotAllowedError (запрещено), NotReadableError (занят)… */
  reason?: string;
};

let silentCtx: AudioContext | null = null;

/** Тихая аудиодорожка: соединению нужна хоть какая-то, чтобы принимать звук собеседника. */
function silentStream(): MediaStream {
  const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctx) return new MediaStream();
  silentCtx ??= new Ctx();
  return silentCtx.createMediaStreamDestination().stream;
}

/** Какие устройства видит браузер — в журнал, чтобы по баг-репорту понять, почему микрофона нет. */
async function logDevices(reason: string): Promise<void> {
  try {
    const list = await navigator.mediaDevices.enumerateDevices();
    const count = (k: MediaDeviceKind) => list.filter((d) => d.kind === k).length;
    applog.warn(`mic: ${reason}; устройств: audioinput=${count("audioinput")} audiooutput=${count("audiooutput")} videoinput=${count("videoinput")}`);
  } catch (e) {
    applog.warn(`mic: ${reason}; enumerateDevices: ${String((e as Error)?.message || e)}`);
  }
}

export async function openCallMic(constraints: MediaTrackConstraints | boolean): Promise<CallMic> {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: constraints, video: false });
    if (stream.getAudioTracks().length) return { stream, missing: false };
  } catch (e) {
    const reason = (e as { name?: string })?.name || "Error";
    void logDevices(reason);
    return { stream: silentStream(), missing: true, reason };
  }
  void logDevices("нет аудиодорожки");
  return { stream: silentStream(), missing: true, reason: "NotFoundError" };
}

/** Подсказка, почему вас не слышно. */
export function micMissingText(reason: string | undefined, t: (s: string) => string): string {
  if (reason === "NotAllowedError" || reason === "SecurityError") return t("Нет доступа к микрофону — вас не слышно. Разрешите его в настройках, а пока можно отвечать в чате");
  if (reason === "NotReadableError") return t("Микрофон занят другой программой — вас не слышно. Можно отвечать в чате");
  return t("Микрофон не найден — вас не слышно. Можно отвечать в чате");
}
