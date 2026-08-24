/**
 * Короткие UI-звуки (входящее сообщение, отправка, аудио-стикеры, рингтон)
 * через Web Audio API.
 *
 * Зачем не <audio>: на iOS в WKWebView любой HTMLMediaElement регистрируется
 * в системном Now Playing — на заблокированном экране повисает медиа-виджет
 * с названием приложения и залипает там. Буфер Web Audio такого не делает,
 * поэтому короткие звуки не «захватывают» локскрин.
 */

let ctx: AudioContext | null = null;
const cache = new Map<string, Promise<AudioBuffer>>();

function context(): AudioContext | null {
  try {
    if (!ctx) {
      const Ctor = window.AudioContext || (window as any).webkitAudioContext;
      if (!Ctor) return null;
      ctx = new Ctor();
    }
    return ctx;
  } catch {
    return null;
  }
}

function load(url: string, c: AudioContext): Promise<AudioBuffer> {
  let p = cache.get(url);
  if (!p) {
    p = fetch(url)
      .then((r) => r.arrayBuffer())
      .then((b) => c.decodeAudioData(b));
    cache.set(url, p);
  }
  return p;
}

/** Проиграть звук. Возвращает функцию остановки (нужна для зацикленного рингтона). */
export async function playSfx(
  url: string,
  opts: { volume?: number; loop?: boolean; onEnded?: () => void } = {}
): Promise<() => void> {
  const c = context();
  if (!c) return () => {};
  try {
    if (c.state === "suspended") await c.resume();
    const buf = await load(url, c);
    const src = c.createBufferSource();
    src.buffer = buf;
    src.loop = !!opts.loop;
    if (opts.onEnded) src.onended = opts.onEnded;
    const gain = c.createGain();
    gain.gain.value = opts.volume ?? 1;
    src.connect(gain).connect(c.destination);
    src.start();
    return () => {
      try {
        src.stop();
      } catch {
        /* уже остановлен */
      }
    };
  } catch {
    return () => {};
  }
}
