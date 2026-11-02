// Поле боя — шестиугольники «odd-r»: нечётные ряды сдвинуты вправо на
// полклетки. x — колонка, y — ряд.

export const BW = 11; // колонок
export const BH = 9;  // рядов

export const inField = (x, y) => x >= 0 && y >= 0 && x < BW && y < BH;

const DIRS = [
  [[+1, 0], [0, -1], [-1, -1], [-1, 0], [-1, +1], [0, +1]], // чётный ряд
  [[+1, 0], [+1, -1], [0, -1], [-1, 0], [0, +1], [+1, +1]], // нечётный ряд
];

export function neighbors(x, y) {
  return DIRS[y & 1].map(([dx, dy]) => [x + dx, y + dy]).filter(([a, b]) => inField(a, b));
}

function toCube(x, y) {
  const q = x - (y - (y & 1)) / 2;
  return [q, y, -q - y];
}

export function hexDist(x1, y1, x2, y2) {
  const [a1, b1, c1] = toCube(x1, y1);
  const [a2, b2, c2] = toCube(x2, y2);
  return Math.max(Math.abs(a1 - a2), Math.abs(b1 - b2), Math.abs(c1 - c2));
}

export const adjacent = (x1, y1, x2, y2) => hexDist(x1, y1, x2, y2) === 1;

/**
 * Куда может дойти отряд: {"x,y": шагов}. blocked(x, y) — занятая клетка.
 * Летуны не обходят препятствия, им важна только дальность и свободная цель.
 */
export function reachable(sx, sy, speed, blocked, flying = false) {
  const out = new Map();
  if (flying) {
    for (let y = 0; y < BH; y++)
      for (let x = 0; x < BW; x++) {
        const d = hexDist(sx, sy, x, y);
        if (d > 0 && d <= speed && !blocked(x, y)) out.set(`${x},${y}`, d);
      }
    return out;
  }
  const seen = new Set([`${sx},${sy}`]);
  let front = [[sx, sy]];
  for (let step = 1; step <= speed && front.length; step++) {
    const next = [];
    for (const [x, y] of front)
      for (const [nx, ny] of neighbors(x, y)) {
        const k = `${nx},${ny}`;
        if (seen.has(k) || blocked(nx, ny)) continue;
        seen.add(k);
        out.set(k, step);
        next.push([nx, ny]);
      }
    front = next;
  }
  return out;
}

/** Путь по шагам (для анимации пехоты) — BFS до цели. */
export function hexPath(sx, sy, tx, ty, blocked) {
  const prev = new Map([[`${sx},${sy}`, null]]);
  let front = [[sx, sy]];
  while (front.length) {
    const next = [];
    for (const [x, y] of front)
      for (const [nx, ny] of neighbors(x, y)) {
        const k = `${nx},${ny}`;
        if (prev.has(k) || (blocked(nx, ny) && !(nx === tx && ny === ty))) continue;
        prev.set(k, `${x},${y}`);
        if (nx === tx && ny === ty) {
          const path = [];
          for (let c = k; c; c = prev.get(c)) path.unshift(c.split(",").map(Number));
          return path;
        }
        next.push([nx, ny]);
      }
    front = next;
  }
  return null;
}
