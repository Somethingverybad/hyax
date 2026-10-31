import workletCode from "./autotune.worklet.js?raw";
import { MIC_TRACK_EVENT } from "@/lib/micSettings";

/**
 * Автотюн голоса в звонке (браузер и программа WYX; в приложениях на
 * телефонах звук ведёт нативный движок — там его пока нет).
 *
 * Микрофон в потоке звонка остаётся как был (выключение микрофона, OBS,
 * индикатор речи — всё по нему), а в соединения вместо него уходит дорожка
 * после обработки (lib/autotune.worklet.js). Собеседники слышат эффект,
 * пересогласования нет — только replaceTrack.
 *
 * Цепочка одна на приложение: звонок бывает один, а личный, превратившись
 * в групповой (adopt), уносит с собой и поток, и соединение.
 */

type Chain = {
  ctx: AudioContext;
  node: AudioWorkletNode;
  src: MediaStreamAudioSourceNode;
  input: MediaStreamTrack;
  output: MediaStreamTrack;
};

let chain: Chain | null = null;
let moduleUrl: string | null = null;
const EVENT = "hyax:autotune";

export const autotuneOn = (): boolean => !!chain;

/** Подписка на включение и выключение; вернёт отписку. */
export function onAutotune(cb: (on: boolean) => void): () => void {
  const h = () => cb(!!chain);
  window.addEventListener(EVENT, h);
  return () => window.removeEventListener(EVENT, h);
}

/** Есть ли чем: AudioWorklet и захват потока из графа. */
export const canAutotune = (): boolean =>
  typeof AudioContext !== "undefined" && typeof AudioWorkletNode !== "undefined" &&
  typeof MediaStreamAudioDestinationNode !== "undefined";

const emit = () => {
  window.dispatchEvent(new Event(EVENT));
  // Трансляция в OBS и прочие слушатели дорожки микрофона — пересинхронизироваться.
  window.dispatchEvent(new Event(MIC_TRACK_EVENT));
};

/** Что отправлять в соединение вместо дорожки микрофона. */
export const sendTrack = (t: MediaStreamTrack): MediaStreamTrack => (chain && chain.input === t ? chain.output : t);

/** Эту дорожку микрофона обрабатывает автотюн (в соединениях — не она). */
export const tunesTrack = (t: MediaStreamTrack | null | undefined): boolean => !!t && !!chain && chain.input === t;

/** Микрофон переоткрыли (lib/micSettings swapMicTrack): эффект слушает новый. */
export function retargetAutotune(old: MediaStreamTrack, fresh: MediaStreamTrack): boolean {
  if (!chain || chain.input !== old) return false;
  chain.src.disconnect();
  chain.src = chain.ctx.createMediaStreamSource(new MediaStream([fresh]));
  chain.src.connect(chain.node);
  chain.input = fresh;
  return true;
}

/**
 * Включить или выключить автотюн для микрофона из `stream` во всех
 * соединениях `pcs`. Включение — по нажатию (AudioContext заводится от жеста).
 */
export async function setAutotune(on: boolean, stream: MediaStream | null, pcs: Iterable<RTCPeerConnection>): Promise<void> {
  const list = [...pcs];
  if (!on) {
    if (!chain) return;
    const c = chain;
    chain = null;
    for (const pc of list) {
      const sender = pc.getSenders().find((s) => s.track === c.output);
      if (sender) await sender.replaceTrack(c.input).catch(() => {});
    }
    c.output.stop();
    void c.ctx.close().catch(() => {});
    emit();
    return;
  }
  if (chain) return;
  const input = stream?.getAudioTracks()[0];
  if (!input) throw new Error("no_mic");
  const ctx = new AudioContext({ latencyHint: "interactive" });
  try {
    moduleUrl ??= URL.createObjectURL(new Blob([workletCode], { type: "application/javascript" }));
    await ctx.audioWorklet.addModule(moduleUrl);
    const node = new AudioWorkletNode(ctx, "hyax-autotune", { numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [1] });
    const src = ctx.createMediaStreamSource(new MediaStream([input]));
    const dest = ctx.createMediaStreamDestination();
    src.connect(node);
    node.connect(dest);
    const output = dest.stream.getAudioTracks()[0];
    await ctx.resume();
    chain = { ctx, node, src, input, output };
    for (const pc of list) {
      const sender = pc.getSenders().find((s) => s.track === input);
      if (sender) await sender.replaceTrack(output);
    }
  } catch (e) {
    // Не вышло на полпути — вернуть микрофон тем соединениям, что успели подменить.
    const c = chain as Chain | null;
    chain = null;
    if (c) for (const pc of list) {
      const sender = pc.getSenders().find((s) => s.track === c.output);
      if (sender) await sender.replaceTrack(input).catch(() => {});
    }
    void ctx.close().catch(() => {});
    throw e;
  }
  emit();
}

/** Звонок кончился — граф закрыть (соединений уже нет, подменять нечего). */
export function stopAutotune(): void {
  if (!chain) return;
  const c = chain;
  chain = null;
  c.output.stop();
  void c.ctx.close().catch(() => {});
  emit();
}
