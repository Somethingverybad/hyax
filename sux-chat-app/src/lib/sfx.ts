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

// Тихий режим iPhone. Web Audio в WKWebView играет как «фоновый» звук, и
// переключатель тишины его глушит — вместе со звуком, который человек сам
// включил нажатием. Такие звуки на время проигрывания переводим в режим
// «воспроизведение» (Audio Session API, WebKit с iOS 17): он играет и в тихом
// режиме, как голосовые и видео. Служебные звуки (отправлено, входящее) по
// тишине по-прежнему молчат. После последнего такого звука — снова «auto».
let tapSounds = 0;

function audioSession(): { type: string } | null {
  return (navigator as any).audioSession ?? null;
}

function tapSoundStarted() {
  const s = audioSession();
  if (!s) return;
  tapSounds += 1;
  try { s.type = "playback"; } catch { /* старый WebKit */ }
}

function tapSoundEnded() {
  const s = audioSession();
  if (!s || tapSounds === 0) return;
  tapSounds -= 1;
  if (tapSounds === 0) {
    try { s.type = "auto"; } catch { /* старый WebKit */ }
  }
}

/** Проиграть звук. Возвращает функцию остановки (нужна для зацикленного рингтона).
 *  tap — звук включён нажатием человека: играет и в тихом режиме iPhone. */
export async function playSfx(
  url: string,
  opts: { volume?: number; loop?: boolean; onEnded?: () => void; tap?: boolean } = {}
): Promise<() => void> {
  const c = context();
  if (!c) return () => {};
  let tapActive = false;
  const release = () => { if (tapActive) { tapActive = false; tapSoundEnded(); } };
  try {
    if (opts.tap) { tapActive = true; tapSoundStarted(); }
    if (c.state === "suspended") await c.resume();
    const buf = await load(url, c);
    const src = c.createBufferSource();
    src.buffer = buf;
    src.loop = !!opts.loop;
    src.onended = () => { release(); opts.onEnded?.(); };
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
    release();
    return () => {};
  }
}
