// Детерминированный генератор: его состояние лежит в самой игре (state.rng),
// поэтому сервер может сохранить партию и продолжить её с той же точки.

/** Следующее число [0, 1) — mulberry32, состояние в holder.rng. */
export function rand(holder) {
  let t = (holder.rng = (holder.rng + 0x6d2b79f5) | 0);
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

/** Целое из [a, b] включительно. */
export const randInt = (h, a, b) => a + Math.floor(rand(h) * (b - a + 1));

export const pick = (h, list) => list[Math.floor(rand(h) * list.length)];

export function shuffle(h, list) {
  for (let i = list.length - 1; i > 0; i--) {
    const j = Math.floor(rand(h) * (i + 1));
    [list[i], list[j]] = [list[j], list[i]];
  }
  return list;
}

/** Взвешенный выбор: weights — {ключ: вес}. */
export function weighted(h, weights) {
  const keys = Object.keys(weights);
  let r = rand(h) * keys.reduce((s, k) => s + weights[k], 0);
  for (const k of keys) {
    r -= weights[k];
    if (r < 0) return k;
  }
  return keys[keys.length - 1];
}
