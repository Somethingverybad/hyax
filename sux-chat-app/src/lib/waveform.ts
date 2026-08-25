/**
 * Настоящая форма волны голосового сообщения: скачиваем файл, декодируем и
 * берём пиковые амплитуды по N интервалам. Кэшируем по URL, чтобы не
 * пересчитывать при перерисовке.
 *
 * Работает там, где движок умеет декодировать кодек записи: webm/opus на
 * Chromium (Android/десктоп), mp4/aac на iOS. Если декодировать нельзя —
 * бросаем, а вызывающий рисует запасную «дорожку».
 */

let actx: AudioContext | null = null;
const cache = new Map<string, number[]>();

function ctx(): AudioContext {
  if (!actx) {
    const Ctor = window.AudioContext || (window as any).webkitAudioContext;
    actx = new Ctor();
  }
  return actx;
}

export async function loadWaveform(url: string, buckets = 40): Promise<number[]> {
  const cached = cache.get(url);
  if (cached) return cached;

  const resp = await fetch(url);
  if (!resp.ok) throw new Error(`waveform fetch ${resp.status}`);
  const arr = await resp.arrayBuffer();
  const audio = await ctx().decodeAudioData(arr);

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
