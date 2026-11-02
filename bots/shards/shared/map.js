// Карта приключений: генерация и поиск пути. Клетки — квадраты, ходить можно
// в восемь сторон; диагональ дороже в 1,4 раза.

import { rand, randInt, pick, shuffle } from "./rng.js";
import { TERRAIN, NEUTRALS, UNITS, FACTIONS, ARMY_SLOTS } from "./data.js";

export const SIZES = { S: 28, M: 36, L: 44 };

export const idx = (st, x, y) => y * st.w + x;
export const inMap = (st, x, y) => x >= 0 && y >= 0 && x < st.w && y < st.h;
export const terrainAt = (st, x, y) => st.terrain[idx(st, x, y)];
export const isBlockedTerrain = (st, x, y) => !!TERRAIN[terrainAt(st, x, y)].block;

const DIR8 = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];

// ---------- генерация ----------

/** Шум значений: сетка случайных чисел с плавной интерполяцией. */
function noise(h, w, hgt, cell) {
  const gw = Math.ceil(w / cell) + 2, gh = Math.ceil(hgt / cell) + 2;
  const g = Array.from({ length: gw * gh }, () => rand(h));
  const sm = (t) => t * t * (3 - 2 * t);
  return (x, y) => {
    const fx = x / cell, fy = y / cell;
    const x0 = Math.floor(fx), y0 = Math.floor(fy);
    const tx = sm(fx - x0), ty = sm(fy - y0);
    const v = (i, j) => g[(y0 + j) * gw + (x0 + i)];
    const a = v(0, 0) + (v(1, 0) - v(0, 0)) * tx;
    const b = v(0, 1) + (v(1, 1) - v(0, 1)) * tx;
    return a + (b - a) * ty;
  };
}

/** Позиции стартовых городов: углы с отступом, порядок перемешан. */
function startSpots(h, w, n) {
  const m = 3;
  const corners = [[m, m], [w - 1 - m, w - 1 - m], [w - 1 - m, m], [m, w - 1 - m]];
  if (n === 2) return rand(h) < 0.5 ? [corners[0], corners[1]] : [corners[2], corners[3]];
  return shuffle(h, corners.slice()).slice(0, n);
}

/** Прорубить дорогу от a до b: ломаная с небольшими отклонениями. */
function carve(st, h, [ax, ay], [bx, by]) {
  let x = ax, y = ay;
  let guard = 0;
  while ((x !== bx || y !== by) && guard++ < 500) {
    const dx = Math.sign(bx - x), dy = Math.sign(by - y);
    const r = rand(h);
    if (r < 0.15 && dx) x += dx;
    else if (r < 0.3 && dy) y += dy;
    else { x += dx; y += dy; }
    const i = idx(st, x, y);
    if (TERRAIN[st.terrain[i]].block || rand(h) < 0.6) st.terrain[i] = "d";
  }
}

/** Клетки, достижимые от (x, y) по проходимой местности. */
function flood(st, x, y) {
  const seen = new Uint8Array(st.w * st.h);
  const stack = [[x, y]];
  seen[idx(st, x, y)] = 1;
  while (stack.length) {
    const [cx, cy] = stack.pop();
    for (const [dx, dy] of DIR8) {
      const nx = cx + dx, ny = cy + dy;
      if (!inMap(st, nx, ny)) continue;
      const i = idx(st, nx, ny);
      if (seen[i] || TERRAIN[st.terrain[i]].block) continue;
      seen[i] = 1;
      stack.push([nx, ny]);
    }
  }
  return seen;
}

/** Нейтральный отряд на «ценность» value (в золоте найма). */
function monsterFor(h, value) {
  const tierCap = value < 2500 ? 2 : value < 6000 ? 3 : value < 12000 ? 4 : 5;
  const options = NEUTRALS.filter((u) => UNITS[u].tier <= tierCap && UNITS[u].tier >= tierCap - 2);
  const u = pick(h, options);
  return { u, n: Math.max(2, Math.round(value / UNITS[u].cost.gold * (0.8 + rand(h) * 0.4))) };
}

export function emptyArmy() {
  return Array.from({ length: ARMY_SLOTS }, () => null);
}

/**
 * Новая карта. players — [{faction}], size — "S" | "M" | "L".
 * Возвращает {w, h, terrain (массив символов), objects, starts}.
 */
export function generateMap(h, players, size) {
  const n = players.length;
  const w = SIZES[size] || SIZES.M;
  const st = { w, h: w, terrain: new Array(w * w).fill("g"), objects: [] };
  const base = noise(h, w, w, 6), alt = noise(h, w, w, 5), obst = noise(h, w, w, 3.2), water = noise(h, w, w, 7);

  for (let y = 0; y < w; y++)
    for (let x = 0; x < w; x++) {
      const b = base(x, y), a = alt(x, y), o = obst(x, y), wa = water(x, y);
      let t = "g";
      if (b > 0.68) t = a > 0.5 ? "s" : "n";
      else if (b < 0.25) t = "m";
      else if (a > 0.72) t = "d";
      if (wa > 0.8) t = "~";
      else if (o > 0.66) t = a > 0.45 ? "T" : "M";
      st.terrain[idx(st, x, y)] = t;
    }
  // Рамка по краям — лес и скалы: так карта читается как замкнутый край.
  for (let i = 0; i < w; i++)
    for (const [x, y] of [[i, 0], [i, w - 1], [0, i], [w - 1, i]])
      st.terrain[idx(st, x, y)] = rand(h) < 0.5 ? "T" : "M";

  const starts = startSpots(h, w, n);
  const c = Math.floor(w / 2);
  const neutralSpots = n >= 3 || w >= 36
    ? [[c - 3 + randInt(h, 0, 1), c - 3 + randInt(h, 0, 1)], [c + 2 + randInt(h, 0, 1), c + 2 + randInt(h, 0, 1)]]
    : [[c, c]];
  const towns = [...starts, ...neutralSpots];

  // Вокруг городов — чистая земля, между ними — дороги через центр.
  for (const [tx, ty] of towns)
    for (let dy = -2; dy <= 2; dy++)
      for (let dx = -2; dx <= 2; dx++) {
        const x = tx + dx, y = ty + dy;
        if (inMap(st, x, y) && x > 0 && y > 0 && x < w - 1 && y < w - 1 && TERRAIN[terrainAt(st, x, y)].block)
          st.terrain[idx(st, x, y)] = "g";
      }
  for (const t of towns) carve(st, h, t, [c, c]);
  for (let i = 0; i < starts.length; i++) carve(st, h, starts[i], starts[(i + 1) % starts.length]);

  // Отрезанные от городов «карманы» зарастают лесом — там нечего делать.
  const reach = flood(st, starts[0][0], starts[0][1]);
  for (let i = 0; i < reach.length; i++) if (!reach[i] && !TERRAIN[st.terrain[i]].block) st.terrain[i] = "T";

  let nextId = 1;
  const taken = new Set();
  const key = (x, y) => `${x},${y}`;
  const add = (o) => { o.id = `o${nextId++}`; st.objects.push(o); taken.add(key(o.x, o.y)); return o; };
  const freeTile = (x, y) => inMap(st, x, y) && !isBlockedTerrain(st, x, y) && !taken.has(key(x, y));
  // Вход в город держим свободным: клетки вплотную к городу не занимаем.
  for (const [tx, ty] of towns)
    for (const [dx, dy] of DIR8) taken.add(key(tx + dx, ty + dy));
  const distToStart = (x, y) => Math.min(...starts.map(([sx, sy]) => Math.max(Math.abs(sx - x), Math.abs(sy - y))));

  starts.forEach(([x, y], i) => {
    const f = players[i].faction;
    add({ kind: "town", x, y, faction: f, owner: i, name: FACTIONS[f].towns[0], built: { hall: 1, dw1: 1 },
          stock: { 1: UNITS[FACTIONS[f].units[0]].growth }, garrison: emptyArmy(), spells: [], builtDay: 0 });
  });
  neutralSpots.forEach(([x, y], i) => {
    const f = pick(h, Object.keys(FACTIONS));
    const g = emptyArmy();
    const m = monsterFor(h, 7000 + i * 1000);
    g[0] = { u: m.u, n: Math.ceil(m.n / 2) };
    g[1] = { u: m.u, n: Math.floor(m.n / 2) };
    add({ kind: "town", x, y, faction: f, owner: null, name: FACTIONS[f].towns[1 + i], built: { hall: 1, dw1: 1, dw2: 1 },
          stock: { 1: UNITS[FACTIONS[f].units[0]].growth, 2: UNITS[FACTIONS[f].units[1]].growth }, garrison: g, spells: [], builtDay: 0 });
  });

  /** Случайная свободная клетка на расстоянии [dmin, dmax] от (cx, cy). */
  const near = (cx, cy, dmin, dmax) => {
    for (let t = 0; t < 80; t++) {
      const x = cx + randInt(h, -dmax, dmax), y = cy + randInt(h, -dmax, dmax);
      const d = Math.max(Math.abs(x - cx), Math.abs(y - cy));
      if (d >= dmin && d <= dmax && freeTile(x, y)) return [x, y];
    }
    return null;
  };
  const anywhere = (dmin = 0) => {
    for (let t = 0; t < 200; t++) {
      const x = randInt(h, 1, w - 2), y = randInt(h, 1, w - 2);
      if (freeTile(x, y) && distToStart(x, y) >= dmin) return [x, y];
    }
    return null;
  };
  const guardValue = (x, y) => {
    const d = distToStart(x, y);
    return d < 6 ? 1200 : d < 9 ? 3000 : d < 13 ? 6500 : 11000;
  };
  /** Охрана рядом с ценностью: монстр на соседней свободной клетке. */
  const guard = (x, y, mult = 1) => {
    const p = near(x, y, 1, 1);
    if (p) add({ kind: "monster", x: p[0], y: p[1], ...monsterFor(h, guardValue(x, y) * mult) });
  };

  // Шахты: у каждого старта лесопилка и рудник рядом, золото и кристаллы дальше.
  for (const [sx, sy] of starts) {
    for (const res of ["wood", "ore"]) {
      const p = near(sx, sy, 3, 5);
      if (p) add({ kind: "mine", x: p[0], y: p[1], res, owner: null });
    }
    for (const res of ["gold", "crystal"]) {
      const p = near(sx, sy, 6, 9);
      if (p) { add({ kind: "mine", x: p[0], y: p[1], res, owner: null }); guard(p[0], p[1]); }
    }
  }
  const area = w * w;
  for (let i = 0; i < Math.round(area / 260); i++) {
    const p = anywhere(8);
    if (p) { add({ kind: "mine", x: p[0], y: p[1], res: pick(h, ["gold", "crystal", "wood", "ore"]), owner: null }); guard(p[0], p[1]); }
  }
  // Кучки ресурсов.
  for (let i = 0; i < Math.round(area / 22); i++) {
    const p = anywhere(2);
    if (!p) continue;
    const res = pick(h, ["gold", "gold", "wood", "ore", "crystal"]);
    const amt = res === "gold" ? randInt(h, 5, 10) * 100 : res === "crystal" ? randInt(h, 2, 4) : randInt(h, 5, 9);
    add({ kind: "res", x: p[0], y: p[1], res, amt });
  }
  // Сундуки: золото или опыт на выбор.
  for (let i = 0; i < Math.round(area / 70); i++) {
    const p = anywhere(4);
    if (!p) continue;
    const t = randInt(h, 1, 3);
    add({ kind: "chest", x: p[0], y: p[1], gold: 500 + t * 500, xp: 250 + t * 500 });
    if (rand(h) < 0.5) guard(p[0], p[1], 0.8);
  }
  // Святыни (+1 к навыку один раз на героя) и колодцы (мана).
  for (const stat of ["atk", "def", "power", "know"]) {
    for (let k = 0; k < (w >= 36 ? 2 : 1); k++) {
      const p = anywhere(5);
      if (p) { add({ kind: "shrine", x: p[0], y: p[1], stat, visited: [] }); guard(p[0], p[1], 0.7); }
    }
  }
  for (let i = 0; i < Math.round(area / 300) + 1; i++) {
    const p = anywhere(3);
    if (p) add({ kind: "well", x: p[0], y: p[1] });
  }
  // Бродячие отряды.
  for (let i = 0; i < Math.round(area / 45); i++) {
    const p = anywhere(4);
    if (p) add({ kind: "monster", x: p[0], y: p[1], ...monsterFor(h, guardValue(p[0], p[1])) });
  }

  return { w, h: w, terrain: st.terrain.join(""), objects: st.objects, starts };
}

// ---------- путь ----------

/** Что стоит на клетке: объект и/или герой. */
export function occupancy(st) {
  const map = new Map();
  for (const o of st.objects) map.set(`${o.x},${o.y}`, { obj: o });
  for (const hr of st.heroes) {
    const k = `${hr.x},${hr.y}`;
    map.set(k, { ...(map.get(k) || {}), hero: hr });
  }
  return map;
}

/**
 * Можно ли пройти клетку насквозь (не останавливаясь). Насквозь — по шахтам,
 * святыням, колодцам и своим городам; остальное (монстр, чужой герой или
 * город, ресурсы, сундук) — только цель шага.
 */
export function passThrough(cell, owner) {
  if (!cell) return true;
  if (cell.hero) return false;
  const o = cell.obj;
  if (!o) return true;
  if (o.kind === "mine" || o.kind === "shrine" || o.kind === "well") return true;
  if (o.kind === "town") return o.owner === owner;
  return false;
}

export const stepCost = (st, x0, y0, x1, y1) => {
  const c = Math.max(TERRAIN[terrainAt(st, x0, y0)].cost, TERRAIN[terrainAt(st, x1, y1)].cost);
  return x0 !== x1 && y0 !== y1 ? Math.round(c * 1.41) : c;
};

/**
 * Путь героя до (tx, ty) — Дейкстра. → [{x, y, cost}] без стартовой клетки
 * (cost — сколько очков хода от старта) или null.
 * seen — строка видимости игрока: в туман не ходим.
 */
export function findPath(st, hero, tx, ty, seen = null) {
  if (!inMap(st, tx, ty) || isBlockedTerrain(st, tx, ty)) return null;
  if (seen && seen[idx(st, tx, ty)] !== "1") return null;
  if (hero.x === tx && hero.y === ty) return null;
  const occ = occupancy(st);
  const N = st.w * st.h;
  const dist = new Float64Array(N).fill(Infinity);
  const prev = new Int32Array(N).fill(-1);
  const start = idx(st, hero.x, hero.y), goal = idx(st, tx, ty);
  dist[start] = 0;
  // Двоичная куча по расстоянию.
  const heap = [[0, start]];
  const push = (d, i) => {
    heap.push([d, i]);
    let k = heap.length - 1;
    while (k > 0) {
      const p = (k - 1) >> 1;
      if (heap[p][0] <= heap[k][0]) break;
      [heap[p], heap[k]] = [heap[k], heap[p]];
      k = p;
    }
  };
  const pop = () => {
    const top = heap[0], last = heap.pop();
    if (heap.length) {
      heap[0] = last;
      let k = 0;
      for (;;) {
        const l = 2 * k + 1, r = l + 1;
        let m = k;
        if (l < heap.length && heap[l][0] < heap[m][0]) m = l;
        if (r < heap.length && heap[r][0] < heap[m][0]) m = r;
        if (m === k) break;
        [heap[m], heap[k]] = [heap[k], heap[m]];
        k = m;
      }
    }
    return top;
  };
  while (heap.length) {
    const [d, i] = pop();
    if (d > dist[i]) continue;
    if (i === goal) break;
    const x = i % st.w, y = (i / st.w) | 0;
    if (i !== start && !passThrough(occ.get(`${x},${y}`), hero.owner)) continue;
    for (const [dx, dy] of DIR8) {
      const nx = x + dx, ny = y + dy;
      if (!inMap(st, nx, ny) || isBlockedTerrain(st, nx, ny)) continue;
      const ni = idx(st, nx, ny);
      if (seen && seen[ni] !== "1") continue;
      const nd = d + stepCost(st, x, y, nx, ny);
      if (nd < dist[ni]) { dist[ni] = nd; prev[ni] = i; push(nd, ni); }
    }
  }
  if (!isFinite(dist[goal])) return null;
  const path = [];
  for (let i = goal; i !== start; i = prev[i]) path.unshift({ x: i % st.w, y: (i / st.w) | 0, cost: dist[i] });
  return path;
}

/** Открыть туман вокруг (x, y) для игрока p. */
export function reveal(st, p, x, y, r) {
  const seen = st.players[p].seen.split("");
  for (let dy = -r; dy <= r; dy++)
    for (let dx = -r; dx <= r; dx++) {
      const nx = x + dx, ny = y + dy;
      if (inMap(st, nx, ny) && dx * dx + dy * dy <= r * r + 1) seen[idx(st, nx, ny)] = "1";
    }
  st.players[p].seen = seen.join("");
}
