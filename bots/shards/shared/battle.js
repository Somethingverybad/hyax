// Тактический бой на шестиугольниках. Состояние — state.battle; всё, что
// меняет бой, проходит через battleAct (проверка → изменение → события).

import { rand, randInt } from "./rng.js";
import { UNITS, SPELLS } from "./data.js";
import { BW, BH, neighbors, hexDist, adjacent, reachable, hexPath } from "./hex.js";

const ROWS7 = [1, 2, 3, 4, 5, 6, 7];

/**
 * Начать бой. sides — [{player, heroId, army (7 слотов), hero}, {...}];
 * hero — снимок навыков героя {atk, def, power, mana, spells} или null.
 */
export function createBattle(st, info, sides) {
  const stacks = [];
  let sid = 1;
  sides.forEach((s, side) => {
    s.army.forEach((slot, i) => {
      if (!slot || slot.n <= 0) return;
      const u = UNITS[slot.u];
      stacks.push({
        id: `s${sid++}`, side, slot: i, u: slot.u, n: slot.n, start: slot.n, hp: u.hp,
        x: side === 0 ? 0 : BW - 1, y: ROWS7[i], shots: u.shots || 0, retals: u.retal || 1,
        acted: false, waited: false, defending: false, fx: [],
      });
    });
  });
  // Препятствия — камни посередине, не на стартовых колонках.
  const obstacles = [];
  const nObs = randInt(st, 2, 5);
  for (let t = 0; obstacles.length < nObs && t < 40; t++) {
    const x = randInt(st, 3, BW - 4), y = randInt(st, 0, BH - 1);
    if (!obstacles.some((o) => o.x === x && o.y === y)) obstacles.push({ x, y });
  }
  st.battle = {
    ...info,
    sides: sides.map((s) => ({ player: s.player, heroId: s.heroId || null, hero: s.hero || null, cast: false })),
    auto: [false, false],
    stacks, obstacles, round: 1, active: null, log: [], seq: 0, over: false,
  };
  nextActor(st.battle);
  return st.battle;
}

// ---------- расчёты ----------

const unit = (s) => UNITS[s.u];

export function speedOf(s) {
  let v = unit(s).spd;
  for (const f of s.fx) if (f.k === "haste") v += 3; else if (f.k === "slow") v -= 3;
  return Math.max(1, v);
}

const defOf = (b, s) => {
  let d = unit(s).def + (b.sides[s.side].hero?.def || 0);
  for (const f of s.fx) if (f.k === "stoneskin") d += 5;
  return s.defending ? Math.round(d * 1.3) + 1 : d;
};
const atkOf = (b, s) => unit(s).atk + (b.sides[s.side].hero?.atk || 0);

const alive = (b) => b.stacks.filter((s) => s.n > 0);
export const stackAt = (b, x, y) => b.stacks.find((s) => s.n > 0 && s.x === x && s.y === y);
const isObstacle = (b, x, y) => b.obstacles.some((o) => o.x === x && o.y === y);

/** Занята ли клетка для отряда me (свою клетку он не считает). */
export const blockedFor = (b, me) => (x, y) => isObstacle(b, x, y) || b.stacks.some((s) => s !== me && s.n > 0 && s.x === x && s.y === y);

export const activeStack = (b) => b.stacks.find((s) => s.id === b.active) || null;

export function moveRange(b, s) {
  return reachable(s.x, s.y, speedOf(s), blockedFor(b, s), !!unit(s).fly);
}

/** Может ли стрелять: есть выстрелы и рядом нет врага. */
export function canShoot(b, s) {
  if (!s.shots) return false;
  return !alive(b).some((e) => e.side !== s.side && adjacent(s.x, s.y, e.x, e.y));
}

/** Средний урон (для подсказки и для ИИ). */
export function expectedDamage(b, a, d, ranged = false) {
  const [mn, mx] = unit(a).dmg;
  return Math.round(baseDamage(b, a, d, ranged, (mn + mx) / 2));
}

function baseDamage(b, a, d, ranged, roll) {
  let dmg = a.n * roll;
  const diff = atkOf(b, a) - defOf(b, d);
  dmg *= diff > 0 ? Math.min(3, 1 + 0.05 * diff) : Math.max(0.3, 1 + 0.025 * diff);
  // Стрелок в ближнем бою бьёт вполсилы, а издалека (больше 6 клеток) — тоже.
  if (unit(a).shots && !ranged) dmg *= 0.5;
  if (ranged && hexDist(a.x, a.y, d.x, d.y) > 6) dmg *= 0.5;
  return Math.max(1, dmg);
}

function rollDamage(st, b, a, d, ranged) {
  const [mn, mx] = unit(a).dmg;
  let roll = 0;
  // Больше десяти существ — бросаем как за десятку, иначе разброс огромный.
  const k = Math.min(a.n, 10);
  for (let i = 0; i < k; i++) roll += mn + rand(st) * (mx - mn + 1);
  return Math.floor(baseDamage(b, a, d, ranged, Math.min(mx, roll / k)));
}

/** Нанести урон: → сколько погибло. */
function hurt(s, dmg) {
  const max = unit(s).hp;
  let pool = (s.n - 1) * max + s.hp - dmg;
  const before = s.n;
  if (pool <= 0) { s.n = 0; s.hp = 0; return before; }
  s.n = Math.ceil(pool / max);
  s.hp = pool - (s.n - 1) * max;
  return before - s.n;
}

// ---------- очередь ----------

/** Кто ходит следующим; новый раунд, если все сходили. */
function nextActor(b) {
  for (let pass = 0; pass < 2; pass++) {
    const live = alive(b);
    const bySpeed = live.slice().sort((p, q) => speedOf(q) - speedOf(p) || p.side - q.side || p.y - q.y);
    let next = bySpeed.find((s) => !s.acted && !s.waited);
    if (!next) next = bySpeed.slice().reverse().find((s) => !s.acted && s.waited);
    if (next) { b.active = next.id; return; }
    // Новый раунд.
    b.round++;
    for (const s of live) {
      s.acted = false; s.waited = false; s.defending = false; s.retals = unit(s).retal || 1;
      s.fx = s.fx.map((f) => ({ ...f, r: f.r - 1 })).filter((f) => f.r > 0);
    }
    b.sides.forEach((sd) => (sd.cast = false));
    b.log.push(`— Раунд ${b.round} —`);
  }
  b.active = null;
}

/** Очередь хода на ближайшее время (для полосы над полем). */
export function turnQueue(b) {
  const live = alive(b);
  const bySpeed = live.slice().sort((p, q) => speedOf(q) - speedOf(p) || p.side - q.side || p.y - q.y);
  const now = bySpeed.filter((s) => !s.acted && !s.waited);
  const waited = bySpeed.slice().reverse().filter((s) => !s.acted && s.waited);
  return [...now, ...waited, ...bySpeed];
}

// ---------- действия ----------

const name = (s) => `${unit(s).name} ×${s.n}`;

function strike(st, b, a, d, ranged, events) {
  const dmg = rollDamage(st, b, a, d, ranged);
  const killed = hurt(d, dmg);
  b.log.push(`${unit(a).name} ${ranged ? "стреляет в" : "бьёт"} ${unit(d).name}: ${dmg} урона, погибло ${killed}`);
  events.push({ type: ranged ? "shot" : "hit", from: a.id, to: d.id, dmg, killed });
  return killed;
}

function melee(st, b, a, d, events) {
  strike(st, b, a, d, false, events);
  if (d.n > 0 && d.retals > 0 && !unit(a).noRetal) {
    d.retals--;
    strike(st, b, d, a, false, events);
  }
}

function castSpell(st, b, side, spellId, target, events) {
  const sd = b.sides[side];
  const sp = SPELLS[spellId];
  const p = sd.hero.power;
  sd.hero.mana -= sp.mana;
  sd.cast = true;
  let text = `${sp.name}: ${unit(target).name}`;
  if (spellId === "firebolt" || spellId === "lightning") {
    const dmg = spellId === "firebolt" ? 10 + 10 * p : 25 + 15 * p;
    const killed = hurt(target, dmg);
    text += ` — ${dmg} урона, погибло ${killed}`;
    events.push({ type: "spell", spell: spellId, to: target.id, dmg, killed });
  } else if (spellId === "mend") {
    const max = unit(target).hp;
    let pool = (target.n - 1) * max + target.hp + 20 + 15 * p;
    pool = Math.min(pool, target.start * max);
    const before = target.n;
    target.n = Math.ceil(pool / max);
    target.hp = pool - (target.n - 1) * max;
    text += target.n > before ? ` — поднято ${target.n - before}` : " — раны затянулись";
    events.push({ type: "spell", spell: spellId, to: target.id });
  } else {
    target.fx = target.fx.filter((f) => f.k !== spellId);
    target.fx.push({ k: spellId, r: 3 });
    events.push({ type: "spell", spell: spellId, to: target.id });
  }
  b.log.push(text);
}

/**
 * Действие в бою от стороны side. → строка ошибки или null.
 * Типы: bmove {x,y} · battack {target, x, y} · bshoot {target} · bwait ·
 * bdefend · bcast {spell, target} · bauto {on}.
 */
export function battleAct(st, side, a, events) {
  const b = st.battle;
  if (!b || b.over) return "Боя нет";
  if (a.type === "bauto") { b.auto[side] = a.on !== false; return null; }
  const s = activeStack(b);
  if (!s) return "Нет хода";
  if (a.type === "bcast") {
    const sd = b.sides[side];
    const sp = SPELLS[a.spell];
    if (!sd.hero || !sp || !sd.hero.spells.includes(a.spell)) return "Нет такого заклинания";
    if (s.side !== side) return "Колдовать можно в свой ход";
    if (sd.cast) return "В этом раунде герой уже колдовал";
    if (sd.hero.mana < sp.mana) return "Не хватает маны";
    const t = b.stacks.find((x) => x.id === a.target && x.n > 0);
    if (!t) return "Нет цели";
    if ((sp.target === "enemy") !== (t.side !== side)) return "Не та цель";
    castSpell(st, b, side, a.spell, t, events);
    finishIfOver(b);
    return null; // ход отряда не тратится
  }
  if (s.side !== side) return "Сейчас ходит противник";

  if (a.type === "bwait") {
    if (s.waited) return "Уже ждёт";
    s.waited = true;
    b.log.push(`${name(s)} ждёт`);
  } else if (a.type === "bdefend") {
    s.defending = true;
    s.acted = true;
    b.log.push(`${name(s)} защищается`);
  } else if (a.type === "bmove") {
    const range = moveRange(b, s);
    if (!range.has(`${a.x},${a.y}`)) return "Туда не дойти";
    events.push({ type: "move", id: s.id, path: unit(s).fly ? [[s.x, s.y], [a.x, a.y]] : hexPath(s.x, s.y, a.x, a.y, blockedFor(b, s)) });
    s.x = a.x; s.y = a.y;
    s.acted = true;
  } else if (a.type === "battack") {
    const t = b.stacks.find((x) => x.id === a.target && x.n > 0 && x.side !== side);
    if (!t) return "Нет цели";
    const here = a.x === s.x && a.y === s.y;
    if (!here && !moveRange(b, s).has(`${a.x},${a.y}`)) return "Туда не дойти";
    if (!adjacent(a.x, a.y, t.x, t.y)) return "Цель не рядом";
    if (!here) {
      events.push({ type: "move", id: s.id, path: unit(s).fly ? [[s.x, s.y], [a.x, a.y]] : hexPath(s.x, s.y, a.x, a.y, blockedFor(b, s)) });
      s.x = a.x; s.y = a.y;
    }
    melee(st, b, s, t, events);
    s.acted = true;
  } else if (a.type === "bshoot") {
    const t = b.stacks.find((x) => x.id === a.target && x.n > 0 && x.side !== side);
    if (!t) return "Нет цели";
    if (!canShoot(b, s)) return "Стрелять нельзя";
    s.shots--;
    strike(st, b, s, t, true, events);
    s.acted = true;
  } else return "Неизвестное действие";

  if (!finishIfOver(b)) nextActor(b);
  return null;
}

function finishIfOver(b) {
  const live = alive(b);
  const l0 = live.some((s) => s.side === 0), l1 = live.some((s) => s.side === 1);
  if (l0 && l1) return false;
  b.over = true;
  b.winner = l0 ? 0 : 1;
  b.active = null;
  b.log.push(b.winner === 0 ? "Нападающие победили" : "Защитники победили");
  return true;
}

// ---------- ИИ ----------

const value = (s) => s.n * unit(s).hp * (unit(s).atk + unit(s).def);

/** Одно действие за активный отряд — для нейтралов, компьютера и автобоя. */
export function aiAction(b) {
  const s = activeStack(b);
  if (!s) return null;
  const side = s.side;
  const enemies = alive(b).filter((e) => e.side !== side);
  if (!enemies.length) return { type: "bdefend" };
  const sd = b.sides[side];
  // Колдун: урон по самому ценному врагу, если есть мана.
  if (sd.hero && !sd.cast) {
    for (const sp of ["lightning", "firebolt"]) {
      if (sd.hero.spells.includes(sp) && sd.hero.mana >= SPELLS[sp].mana) {
        const t = enemies.slice().sort((p, q) => value(q) - value(p))[0];
        return { type: "bcast", spell: sp, target: t.id };
      }
    }
  }
  const score = (e) => {
    const dmg = expectedDamage(b, s, e, true);
    const kills = Math.min(e.n, dmg / unit(e).hp);
    return kills * (unit(e).atk + unit(e).def) * unit(e).hp / 10 + (unit(e).shots ? 30 : 0);
  };
  if (canShoot(b, s)) {
    const t = enemies.slice().sort((p, q) => score(q) - score(p))[0];
    return { type: "bshoot", target: t.id };
  }
  // Ударить того, до кого можно дойти, — лучшего по счёту.
  const range = moveRange(b, s);
  let best = null;
  for (const e of enemies) {
    const spots = neighbors(e.x, e.y).filter(([x, y]) => (x === s.x && y === s.y) || range.has(`${x},${y}`));
    if (!spots.length) continue;
    const sc = score(e) - (unit(e).noRetal || e.retals === 0 ? 0 : expectedDamage(b, e, s) / 20);
    if (!best || sc > best.sc) {
      spots.sort(([ax, ay], [bx, by]) => hexDist(ax, ay, s.x, s.y) - hexDist(bx, by, s.x, s.y));
      best = { sc, e, at: spots[0] };
    }
  }
  if (best) return { type: "battack", target: best.e.id, x: best.at[0], y: best.at[1] };
  // Стрелок, которого заперли, держит оборону; остальные идут к ближнему врагу.
  const target = enemies.slice().sort((p, q) => hexDist(s.x, s.y, p.x, p.y) - hexDist(s.x, s.y, q.x, q.y))[0];
  let to = null, bestD = hexDist(s.x, s.y, target.x, target.y);
  for (const k of range.keys()) {
    const [x, y] = k.split(",").map(Number);
    const d = hexDist(x, y, target.x, target.y);
    if (d < bestD) { bestD = d; to = [x, y]; }
  }
  if (to) return { type: "bmove", x: to[0], y: to[1] };
  return { type: "bdefend" };
}

/** Сколько существ каждой стороны погибло — для итогов и опыта. */
export function losses(b) {
  const out = [{ hp: 0, list: [] }, { hp: 0, list: [] }];
  for (const s of b.stacks) {
    const dead = s.start - s.n;
    if (dead <= 0) continue;
    out[s.side].hp += dead * unit(s).hp;
    out[s.side].list.push({ u: s.u, n: dead });
  }
  return out;
}
