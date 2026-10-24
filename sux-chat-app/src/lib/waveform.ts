/**
 * Настоящая форма волны голосового сообщения: скачиваем файл, декодируем и
 * берём пиковые амплитуды по N интервалам. Кэшируем по URL, чтобы не
 * пересчитывать при перерисовке.
 *
 * Работает там, где движок умеет декодировать кодек записи: webm/opus на
 * Chromium (Android/десктоп), mp4/aac на iOS. Если декодировать нельзя —
 * бросаем, а вызывающий рисует запасную «дорожку».
 */

const cache = new Map<string, number[]>();

/** Декодируем в OfflineAudioContext: обычный AudioContext на iOS занимает
 *  аудиосессию, и музыка другого приложения останавливалась просто от того,
 *  что лента построила форму волны (баг-репорт e439fccb). Офлайн-контекст
 *  сессию не трогает. */
function decode(arr: ArrayBuffer): Promise<AudioBuffer> {
  const Off = (window as any).OfflineAudioContext || (window as any).webkitOfflineAudioContext;
  const c: OfflineAudioContext = new Off(1, 1, 44100);
  // Safari: decodeAudioData у офлайн-контекста — только с колбэками.
  return new Promise((res, rej) => {
    const r = c.decodeAudioData(arr, res, rej);
    if (r && typeof (r as Promise<AudioBuffer>).then === "function") (r as Promise<AudioBuffer>).then(res, rej);
  });
}

export async function loadWaveform(url: string, buckets = 40): Promise<number[]> {
  const cached = cache.get(url);
  if (cached) return cached;

  const resp = await fetch(url);
  if (!resp.ok) throw new Error(`waveform fetch ${resp.status}`);
  const arr = await resp.arrayBuffer();
  const audio = await decode(arr);

  const data = audio.getChannelData(0);
  const block = Math.floor(data.length / buckets) || 1;
  const peaks: number[] = [];
  for (let i = 0; i < buckets; i++) {
    let max = 0;
    const start = i * block;
    for (let j = 0; j < block; j++) {
      const v = Math.abs(data[start + j] || 0);
      if (v > max) max = v;
    }
    peaks.push(max);
  }
  // Нормируем к пику; тихие записи не должны выглядеть плоской линией.
  const norm = Math.max(...peaks, 0.0001);
  const out = peaks.map((p) => Math.min(1, p / norm));
  cache.set(url, out);
  return out;
}
