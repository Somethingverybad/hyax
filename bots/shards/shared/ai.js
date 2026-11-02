// Компьютерный игрок на карте приключений: по одному действию за вызов.
// Бои за него ведёт battle.js (aiAction), здесь — стройка, найм и походы.

import { FACTIONS, HERO_COST, costOf, canAfford } from "./data.js";
import { occupancy, passThrough, stepCost, inMap, isBlockedTerrain, idx } from "./map.js";
import {
  townsOf, heroesOf, heroInTown, buildOptions, armyPower,
} from "./game.js";

const BUILD_ORDER = ["dw2", "dw3", "hall2", "guild1", "dw4", "hall3", "dw5", "market", "guild2"];
const DIR8 = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];

/** Стоимость пути от героя до каждой клетки (как findPath, но до всех). */
function distanceField(st, hero) {
  const occ = occupancy(st);
  const seen = st.players[hero.owner].seen;
  const N = st.w * st.h;
  const dist = new Float64Array(N).fill(Infinity);
  const start = idx(st, hero.x, hero.y);
  dist[start] = 0;
  // Карта маленькая — хватает простой очереди с повторным добавлением.
  const queue = [start];
  while (queue.length) {
    const i = queue.shift();
    const x = i % st.w, y = (i / st.w) | 0;
    if (i !== start && !passThrough(occ.get(`${x},${y}`), hero.owner)) continue;
    for (const [dx, dy] of DIR8) {
      const nx = x + dx, ny = y + dy;
      if (!inMap(st, nx, ny) || isBlockedTerrain(st, nx, ny)) continue;
      const ni = idx(st, nx, ny);
      if (seen[ni] !== "1") continue;
      const nd = dist[i] + stepCost(st, x, y, nx, ny);
      if (nd < dist[ni]) { dist[ni] = nd; queue.push(ni); }
    }
  }
  return dist;
}

const RES_VALUE = { gold: 1, wood: 120, ore: 120, crystal: 350 };

function targetValue(st, hero, o, power) {
  const p = hero.owner;
  switch (o.kind) {
    case "res": return o.amt * RES_VALUE[o.res];
    case "chest": return 1500;
    case "mine": return o.owner === p ? 0 : o.res === "gold" ? 4000 : 2500;
    case "shrine": return o.visited.includes(hero.id) ? 0 : 1200;
    case "monster": {
      const mp = armyPower([{ u: o.u, n: o.n }]);
      return power > mp * 1.5 ? 400 + mp / 15 : 0;
    }
    case "town": {
      if (o.owner === p) {
        // Домой — забрать войска, если там есть кого взять.
        const t = o;
        const hasTroops = t.garrison.some(Boolean);
        return hasTroops && !heroInTown(st, t) ? 1800 : 0;
      }
      const def = heroInTown(st, o);
      const dp = def ? armyPower(def.army, def) : armyPower(o.garrison);
      return power > dp * 1.3 ? 9000 : 0;
    }
  }
  return 0;
}

/**
 * Следующее действие компьютера p. mem — память на этот ход (сервер
 * обнуляет её в начале хода): какие герои уже упёрлись.
 */
export function nextAiAction(st, p, mem) {
  mem.stuck ||= new Set();
  mem.tries = (mem.tries || 0) + 1;
  if (mem.tries > 120) return { type: "end" };
  if (st.pending?.player === p) return { type: "choose", opt: "gold" };
  const pl = st.players[p];

  // Города: строим, нанимаем, отдаём войска герою.
  for (const t of townsOf(st, p)) {
    if (t.builtDay !== st.day) {
      const opts = buildOptions(st, t).filter((o) => o.ok);
      const id = BUILD_ORDER.find((b) => opts.some((o) => o.id === b));
      // Ратушу и жилища ставим, если после этого останется на найм.
      if (id) return { type: "build", town: t.id, id };
    }
    const hero = heroInTown(st, t);
    for (let tier = 5; tier >= 1; tier--) {
      if (!t.built[`dw${tier}`] || !(t.stock[tier] > 0)) continue;
      const u = FACTIONS[t.faction].units[tier - 1];
      let n = t.stock[tier];
      while (n > 0 && !canAfford(pl.res, costOf(u, n))) n = Math.floor(n * 0.7);
      const room = (army) => army.some((s) => !s || s.u === u);
      const key = `r${t.id}${tier}`;
      if (n > 0 && !mem[key] && (room(t.garrison) || (hero && room(hero.army)))) {
        mem[key] = 1;
        return { type: "recruit", town: t.id, tier, n };
      }
    }
    if (hero && hero.owner === p) {
      const slot = t.garrison.findIndex((s) => s && hero.army.some((h) => !h || h.u === s.u));
      if (slot >= 0) return { type: "transfer", town: t.id, from: "garrison", slot };
    }
    if (!hero && heroesOf(st, p).length < 2 && pl.res.gold >= HERO_COST + 1500 && st.day >= 3 && !mem[`h${t.id}`]) {
      mem[`h${t.id}`] = 1;
      return { type: "hire", town: t.id };
    }
  }

  // Герои: идём к самой выгодной цели.
  for (const hero of heroesOf(st, p)) {
    if (hero.mp <= 0 || mem.stuck.has(hero.id)) continue;
    const last = mem[`m${hero.id}`];
    if (last && last.x === hero.x && last.y === hero.y && last.mp === hero.mp) { mem.stuck.add(hero.id); continue; }
    mem[`m${hero.id}`] = { x: hero.x, y: hero.y, mp: hero.mp };
    const dist = distanceField(st, hero);
    const power = armyPower(hero.army, hero);
    let best = null;
    const consider = (x, y, v) => {
      const d = dist[idx(st, x, y)];
      if (!isFinite(d) || d === 0 || v <= 0) return;
      const sc = v / (d + 40);
      if (!best || sc > best.sc) best = { sc, x, y };
    };
    for (const o of st.objects) consider(o.x, o.y, targetValue(st, hero, o, power));
    for (const e of st.heroes) {
      if (e.owner === p) continue;
      if (power > armyPower(e.army, e) * 1.3) consider(e.x, e.y, 6000);
    }
    if (!best) {
      // Разведка: ближайшая видимая клетка у края тумана.
      const seen = pl.seen;
      for (let y = 1; y < st.h - 1; y++)
        for (let x = 1; x < st.w - 1; x++) {
          const i = idx(st, x, y);
          if (seen[i] !== "1" || !isFinite(dist[i])) continue;
          if (DIR8.some(([dx, dy]) => seen[idx(st, x + dx, y + dy)] !== "1")) consider(x, y, 300);
        }
    }
    if (best) return { type: "move", hero: hero.id, x: best.x, y: best.y };
    mem.stuck.add(hero.id);
  }
  return { type: "end" };
}

