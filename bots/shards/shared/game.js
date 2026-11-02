// Партия целиком: игроки, герои, города, ходы. act() — единственный способ
// изменить партию; сервер вызывает его на каждое действие игрока, клиент —
// не вызывает (только читает состояние и считает пути для подсказок).

import { rand, pick, weighted } from "./rng.js";
import {
  FACTIONS, UNITS, BUILDINGS, SPELLS_L1, SPELLS_L2, HALL_INCOME, MINES, MARKET, START_RES, HERO_MP, HERO_COST,
  MAX_HEROES, ARMY_SLOTS, PLAYER_COLORS, costOf, canAfford, pay, xpFor, STAT_NAME, buildingName, RES_NAME, SPELLS,
} from "./data.js";
import { generateMap, findPath, occupancy, reveal, emptyArmy, idx } from "./map.js";
import { createBattle, battleAct, aiAction, activeStack, losses } from "./battle.js";

export const VIEW_HERO = 4;
export const VIEW_TOWN = 5;

/**
 * Новая партия. players — [{uid, name, faction, ai}], size — S | M | L.
 */
export function createGame({ seed, size = "M", players }) {
  const st = { v: 1, rng: seed | 0, day: 1, turn: 0, heroSeq: 0, battle: null, pending: null, over: false, winner: null, log: [] };
  const map = generateMap(st, players, size);
  Object.assign(st, { w: map.w, h: map.h, terrain: map.terrain, objects: map.objects, heroes: [] });
  st.players = players.map((p, i) => ({
    uid: p.uid, name: p.name, faction: p.faction, ai: !!p.ai, color: PLAYER_COLORS[i],
    res: { ...START_RES }, alive: true, seen: "0".repeat(st.w * st.h),
  }));
  players.forEach((p, i) => {
    const town = st.objects.find((o) => o.kind === "town" && o.owner === i);
    const u = FACTIONS[p.faction].units;
    const army = emptyArmy();
    army[0] = { u: u[0], n: 18 };
    army[1] = { u: u[1], n: 6 };
    army[2] = { u: u[0], n: 8 };
    spawnHero(st, i, town.x, town.y, army);
    reveal(st, i, town.x, town.y, VIEW_TOWN);
  });
  note(st, `День 1. Ходит ${st.players[0].name}`);
  return st;
}

function note(st, text) {
  st.log.push({ day: st.day, text });
  if (st.log.length > 60) st.log.splice(0, st.log.length - 60);
}

function spawnHero(st, owner, x, y, army) {
  const f = st.players[owner].faction;
  const base = FACTIONS[f].hero;
  const used = new Set(st.heroes.map((h) => h.name));
  const free = FACTIONS[f].heroNames.filter((n) => !used.has(n));
  const hero = {
    id: `h${++st.heroSeq}`, owner, faction: f, name: free.length ? pick(st, free) : `Герой ${st.heroSeq}`,
    x, y, mp: HERO_MP, atk: base.atk, def: base.def, power: base.power, know: base.know,
    mana: base.know * 10, xp: 0, level: 1, army, spells: [], wellDay: 0,
  };
  st.heroes.push(hero);
  return hero;
}

// ---------- вспомогательное ----------

export const playerIndex = (st, uid) => st.players.findIndex((p) => p.uid === uid);
export const heroById = (st, id) => st.heroes.find((h) => h.id === id);
export const objById = (st, id) => st.objects.find((o) => o.id === id);
export const townsOf = (st, p) => st.objects.filter((o) => o.kind === "town" && o.owner === p);
export const heroesOf = (st, p) => st.heroes.filter((h) => h.owner === p);
export const heroInTown = (st, town) => st.heroes.find((h) => h.x === town.x && h.y === town.y);
export const maxMana = (h) => h.know * 10;

export const armyPower = (army, hero = null) => army.reduce((s, sl) => {
  if (!sl) return s;
  const u = UNITS[sl.u];
  return s + sl.n * u.hp * (u.atk + (hero?.atk || 0) + u.def + (hero?.def || 0)) * (u.shots ? 1.3 : 1) * (u.fly ? 1.15 : 1);
}, 0);

export const armyCount = (army) => army.filter(Boolean).length;

/** Положить отряд в армию: к таким же или в пустой слот. → удалось ли. */
export function addToArmy(army, u, n) {
  const same = army.findIndex((s) => s && s.u === u);
  if (same >= 0) { army[same].n += n; return true; }
  const empty = army.findIndex((s) => !s);
  if (empty < 0) return false;
  army[empty] = { u, n };
  return true;
}

export function townIncome(t) {
  return HALL_INCOME[t.built.hall3 ? 3 : t.built.hall2 ? 2 : 1];
}

export function dailyIncome(st, p) {
  const inc = { gold: 0, wood: 0, ore: 0, crystal: 0 };
  for (const t of townsOf(st, p)) inc.gold += townIncome(t);
  for (const m of st.objects) if (m.kind === "mine" && m.owner === p) inc[m.res] += MINES[m.res].daily;
  return inc;
}

/** Что сейчас можно построить в городе: [{id, name, cost, ok, why}]. */
export function buildOptions(st, town) {
  const res = st.players[town.owner]?.res || {};
  const out = [];
  for (const [id, b] of Object.entries(BUILDINGS)) {
    if (town.built[id]) continue;
    const missing = b.req.filter((r) => !town.built[r]);
    let why = missing.length ? `Нужно: ${missing.map((r) => buildingName(town.faction, r)).join(", ")}` : "";
    if (!why && town.builtDay === st.day) why = "Сегодня уже строили";
    if (!why && !canAfford(res, b.cost)) why = "Не хватает ресурсов";
    out.push({ id, name: buildingName(town.faction, id), cost: b.cost, desc: b.desc || unitLine(town, b.tier), ok: !why, why, locked: missing.length > 0 });
  }
  return out;
}

function unitLine(town, tier) {
  const u = UNITS[FACTIONS[town.faction].units[tier - 1]];
  return `${u.icon} ${u.name}: +${u.growth} в неделю`;
}

// ---------- ход ----------

export const currentPlayer = (st) => st.players[st.turn];

/**
 * Действие игрока p. Мутирует st. → {error} или {events}.
 * Приключения: move, end, build, recruit, transfer, hire, trade, choose.
 * Бой: b* (см. battle.js) — их может делать и защитник не в свой ход.
 */
export function act(st, p, a) {
  const events = [];
  if (st.over) return { error: "Партия окончена" };
  if (!a || typeof a.type !== "string") return { error: "Пустое действие" };
  const err = a.type[0] === "b" && a.type !== "build" ? doBattle(st, p, a, events) : doAdventure(st, p, a, events);
  if (err) return { error: err };
  return { events };
}

function doBattle(st, p, a, events) {
  const b = st.battle;
  if (!b) return "Боя нет";
  const side = b.sides.findIndex((s) => s.player === p);
  if (side < 0) return "Вы не участвуете в этом бою";
  const err = battleAct(st, side, a, events);
  if (err) return err;
  runBattleAI(st, events);
  return null;
}

/** Кто управляет стороной боя автоматически: нейтралы, компьютер, автобой. */
export function sideIsAuto(st, side) {
  const b = st.battle;
  const pl = b.sides[side].player;
  return pl === null || st.players[pl].ai || b.auto[side];
}

/** Доиграть ходы ИИ, пока очередь не дойдёт до человека; закрыть бой. */
export function runBattleAI(st, events) {
  for (let guard = 0; st.battle && guard < 500; guard++) {
    const b = st.battle;
    if (b.over) { resolveBattle(st, events); return; }
    const s = activeStack(b);
    if (!s || !sideIsAuto(st, s.side)) return;
    const a = aiAction(b);
    if (battleAct(st, s.side, a, events)) battleAct(st, s.side, { type: "bdefend" }, events);
  }
}

/** Ход за человека, который не успел (сервер — по таймеру). */
export function forceBattleStep(st, events) {
  const b = st.battle;
  const s = b && activeStack(b);
  if (!s) return;
  const a = aiAction(b);
  if (battleAct(st, s.side, a, events)) battleAct(st, s.side, { type: "bdefend" }, events);
  runBattleAI(st, events);
}

function doAdventure(st, p, a, events) {
  if (st.turn !== p) return "Сейчас не ваш ход";
  if (st.battle) return "Сначала закончите бой";
  if (st.pending && a.type !== "choose") return "Сначала сделайте выбор";
  const pl = st.players[p];
  switch (a.type) {
    case "move": return doMove(st, p, a, events);
    case "end": endTurn(st, events); return null;
    case "choose": {
      const pd = st.pending;
      if (!pd || pd.player !== p) return "Нечего выбирать";
      const h = heroById(st, pd.hero);
      if (a.opt === "xp" && h) { gainXp(st, h, pd.xp, events); note(st, `${h.name}: +${pd.xp} опыта`); }
      else { pl.res.gold += pd.gold; note(st, `${pl.name}: +${pd.gold} золота из сундука`); }
      st.pending = null;
      return null;
    }
    case "build": {
      const t = objById(st, a.town);
      if (!t || t.kind !== "town" || t.owner !== p) return "Это не ваш город";
      const opt = buildOptions(st, t).find((o) => o.id === a.id);
      if (!opt) return "Нет такой постройки";
      if (!opt.ok) return opt.why;
      pay(pl.res, BUILDINGS[a.id].cost);
      t.built[a.id] = 1;
      t.builtDay = st.day;
      const tier = BUILDINGS[a.id].tier;
      if (tier) t.stock[tier] = (t.stock[tier] || 0) + UNITS[FACTIONS[t.faction].units[tier - 1]].growth;
      if (a.id === "guild1") t.spells.push(...pickSpells(st, SPELLS_L1, 2));
      if (a.id === "guild2") t.spells.push(...SPELLS_L2);
      const h = heroInTown(st, t);
      if (h) learn(h, t);
      events.push({ type: "built", town: t.id, id: a.id });
      return null;
    }
    case "recruit": {
      const t = objById(st, a.town);
      if (!t || t.kind !== "town" || t.owner !== p) return "Это не ваш город";
      const tier = Number(a.tier);
      const n = Math.floor(Number(a.n));
      if (!(tier >= 1 && tier <= 5) || !t.built[`dw${tier}`]) return "Нет такого жилища";
      if (!(n > 0) || n > (t.stock[tier] || 0)) return "Столько нет";
      const u = FACTIONS[t.faction].units[tier - 1];
      const cost = costOf(u, n);
      if (!canAfford(pl.res, cost)) return "Не хватает ресурсов";
      const h = heroInTown(st, t);
      const target = h && h.owner === p && (h.army.some((s) => s?.u === u) || h.army.some((s) => !s)) ? h.army : t.garrison;
      if (!addToArmy(target, u, n)) return "Нет места в армии";
      pay(pl.res, cost);
      t.stock[tier] -= n;
      return null;
    }
    case "transfer": {
      // Слот из гарнизона герою в городе или обратно.
      const t = objById(st, a.town);
      if (!t || t.kind !== "town" || t.owner !== p) return "Это не ваш город";
      const h = heroInTown(st, t);
      if (!h || h.owner !== p) return "В городе нет вашего героя";
      const [from, to] = a.from === "hero" ? [h.army, t.garrison] : [t.garrison, h.army];
      const slot = from[a.slot];
      if (!slot) return "Пустой слот";
      if (a.from === "hero" && armyCount(h.army) === 1) return "Герой не может остаться без армии";
      if (!addToArmy(to, slot.u, slot.n)) return "Нет места";
      from[a.slot] = null;
      return null;
    }
    case "hire": {
      const t = objById(st, a.town);
      if (!t || t.kind !== "town" || t.owner !== p) return "Это не ваш город";
      if (heroInTown(st, t)) return "В городе уже стоит герой";
      if (heroesOf(st, p).length >= MAX_HEROES) return `Не больше ${MAX_HEROES} героев`;
      if (pl.res.gold < HERO_COST) return "Не хватает золота";
      pl.res.gold -= HERO_COST;
      const army = emptyArmy();
      army[0] = { u: FACTIONS[pl.faction].units[0], n: 10 };
      const h = spawnHero(st, p, t.x, t.y, army);
      learn(h, t);
      note(st, `${pl.name} нанимает героя: ${h.name}`);
      return null;
    }
    case "trade": {
      const t = objById(st, a.town);
      if (!t || t.owner !== p || !t.built.market) return "Нужен рынок";
      const rate = MARKET[a.res];
      const n = Math.floor(Number(a.n));
      if (!rate || !(n > 0)) return "Неверная сделка";
      if (a.dir === "sell") {
        if (pl.res[a.res] < n) return `Не хватает: ${RES_NAME[a.res]}`;
        pl.res[a.res] -= n; pl.res.gold += n * rate.sell;
      } else {
        if (pl.res.gold < n * rate.buy) return "Не хватает золота";
        pl.res.gold -= n * rate.buy; pl.res[a.res] += n;
      }
      return null;
    }
    default: return "Неизвестное действие";
  }
}

function pickSpells(st, pool, n) {
  const left = pool.slice();
  const out = [];
  while (out.length < n && left.length) out.push(left.splice(Math.floor(rand(st) * left.length), 1)[0]);
  return out;
}

function learn(h, town) {
  for (const s of town.spells) if (!h.spells.includes(s)) h.spells.push(s);
}

function gainXp(st, h, xp, events) {
  h.xp += xp;
  while (h.xp >= xpFor(h.level + 1)) {
    h.level++;
    const stat = weighted(st, FACTIONS[h.faction].hero.grow);
    h[stat]++;
    events.push({ type: "levelup", hero: h.id, level: h.level, stat });
    note(st, `${h.name} — уровень ${h.level}, ${STAT_NAME[stat]} +1`);
  }
}

// ---------- передвижение ----------

function doMove(st, p, a, events) {
  const h = heroById(st, a.hero);
  if (!h || h.owner !== p) return "Это не ваш герой";
  const path = findPath(st, h, Number(a.x), Number(a.y), st.players[p].seen);
  if (!path) return "Туда не пройти";
  const occ = occupancy(st);
  const walked = [[h.x, h.y]];
  for (let i = 0; i < path.length; i++) {
    const step = path[i];
    const prevCost = i ? path[i - 1].cost : 0;
    if (step.cost - prevCost > h.mp) break;
    const cell = occ.get(`${step.x},${step.y}`);
    const last = i === path.length - 1;
    // Враг на клетке — бой, герой остаётся на соседней.
    const enemyHero = cell?.hero && cell.hero.owner !== p ? cell.hero : null;
    const o = cell?.obj;
    if (enemyHero || o?.kind === "monster" || (o?.kind === "town" && o.owner !== p && (o.garrison.some(Boolean) || heroInTown(st, o)))) {
      if (!last) break;
      h.mp -= step.cost - prevCost;
      events.push({ type: "move", hero: h.id, path: walked.slice() });
      startBattle(st, h, enemyHero, o, events);
      return null;
    }
    if (cell?.hero) break; // свой герой — не наступаем
    h.mp -= step.cost - prevCost;
    h.x = step.x; h.y = step.y;
    walked.push([h.x, h.y]);
    reveal(st, p, h.x, h.y, VIEW_HERO);
    if (o) {
      const stop = visit(st, h, o, events);
      if (stop) break;
    }
  }
  if (walked.length > 1) events.push({ type: "move", hero: h.id, path: walked });
  return null;
}

/** Герой зашёл на клетку объекта. → остановиться ли. */
function visit(st, h, o, events) {
  const pl = st.players[h.owner];
  switch (o.kind) {
    case "res":
      pl.res[o.res] += o.amt;
      events.push({ type: "pickup", res: o.res, amt: o.amt, x: o.x, y: o.y });
      removeObj(st, o);
      return true;
    case "chest":
      st.pending = { player: h.owner, hero: h.id, gold: o.gold, xp: o.xp };
      removeObj(st, o);
      return true;
    case "mine":
      if (o.owner !== h.owner) {
        o.owner = h.owner;
        events.push({ type: "flag", obj: o.id });
        note(st, `${pl.name} захватывает: ${MINES[o.res].name}`);
      }
      return false;
    case "shrine":
      if (!o.visited.includes(h.id)) {
        o.visited.push(h.id);
        h[o.stat]++;
        events.push({ type: "shrine", hero: h.id, stat: o.stat });
        note(st, `${h.name}: ${STAT_NAME[o.stat]} +1 у святыни`);
      }
      return true;
    case "well":
      if (h.wellDay !== st.day) { h.wellDay = st.day; h.mana = Math.max(h.mana, maxMana(h)); events.push({ type: "well", hero: h.id }); }
      return true;
    case "town":
      if (o.owner !== h.owner) captureTown(st, o, h.owner, events);
      learn(h, o);
      h.mana = Math.max(h.mana, maxMana(h));
      return true;
  }
  return false;
}

function removeObj(st, o) {
  st.objects.splice(st.objects.indexOf(o), 1);
}

function captureTown(st, t, p, events) {
  const old = t.owner;
  t.owner = p;
  t.garrison = emptyArmy();
  note(st, `${st.players[p].name} захватывает город ${t.name}`);
  events.push({ type: "capture", town: t.id });
  reveal(st, p, t.x, t.y, VIEW_TOWN);
  if (old !== null) checkAlive(st, events);
}

// ---------- бой на карте ----------

const heroSnap = (h) => h && { atk: h.atk, def: h.def, power: h.power, mana: h.mana, spells: h.spells.slice() };

function startBattle(st, h, enemyHero, o, events) {
  const attacker = { player: h.owner, heroId: h.id, army: h.army, hero: heroSnap(h) };
  let defender, info;
  if (enemyHero) {
    const town = st.objects.find((t) => t.kind === "town" && t.x === enemyHero.x && t.y === enemyHero.y);
    defender = { player: enemyHero.owner, heroId: enemyHero.id, army: enemyHero.army, hero: heroSnap(enemyHero) };
    info = { kind: "hero", townId: town?.id || null, x: enemyHero.x, y: enemyHero.y };
  } else if (o.kind === "monster") {
    // Нейтралы делятся на 2–4 отряда, как стая.
    const parts = Math.min(4, Math.max(1, Math.min(o.n, 2 + Math.floor(rand(st) * 3))));
    const army = emptyArmy();
    for (let i = 0; i < parts; i++) army[i * 2 % ARMY_SLOTS] = { u: o.u, n: Math.floor(o.n / parts) + (i < o.n % parts ? 1 : 0) };
    defender = { player: null, army };
    info = { kind: "monster", objId: o.id, x: o.x, y: o.y };
  } else {
    const inTown = heroInTown(st, o);
    if (inTown) return startBattle(st, h, inTown, null, events);
    defender = { player: o.owner, army: o.garrison };
    info = { kind: "town", townId: o.id, x: o.x, y: o.y };
  }
  createBattle(st, info, [attacker, defender]);
  events.push({ type: "battle" });
  note(st, `Бой: ${h.name} против ${enemyHero ? enemyHero.name : o.kind === "monster" ? UNITS[o.u].name : `гарнизона ${o.name}`}`);
  runBattleAI(st, events);
}

/** Итоги боя — обратно на карту. */
function resolveBattle(st, events) {
  const b = st.battle;
  const lost = losses(b);
  const sideArmy = (side) => {
    const army = emptyArmy();
    for (const s of b.stacks) if (s.side === side && s.n > 0) army[s.slot] = { u: s.u, n: s.n };
    return army;
  };
  const att = heroById(st, b.sides[0].heroId);
  const defHero = b.sides[1].heroId ? heroById(st, b.sides[1].heroId) : null;
  if (att) att.mana = b.sides[0].hero.mana;
  if (defHero) defHero.mana = b.sides[1].hero.mana;
  const result = { type: "battleEnd", winner: b.winner, kind: b.kind, lost, attacker: b.sides[0].player, defender: b.sides[1].player };

  if (b.winner === 0) {
    att.army = sideArmy(0);
    gainXp(st, att, lost[1].hp, events);
    if (b.kind === "monster") removeObj(st, objById(st, b.objId));
    if (defHero) killHero(st, defHero);
    const town = b.townId ? objById(st, b.townId) : null;
    if (town) {
      captureTown(st, town, att.owner, events);
      att.x = town.x; att.y = town.y;
      learn(att, town);
    }
    note(st, `${att.name} побеждает`);
  } else {
    if (defHero) { defHero.army = sideArmy(1); gainXp(st, defHero, lost[0].hp, events); }
    else if (b.kind === "monster") {
      const m = objById(st, b.objId);
      m.n = b.stacks.filter((s) => s.side === 1).reduce((s, x) => s + x.n, 0);
    } else objById(st, b.townId).garrison = sideArmy(1);
    if (att) { note(st, `${att.name} пал в бою`); killHero(st, att); }
  }
  st.battle = null;
  events.push(result);
  checkAlive(st, events);
}

function killHero(st, h) {
  st.heroes.splice(st.heroes.indexOf(h), 1);
}

function checkAlive(st, events) {
  st.players.forEach((pl, i) => {
    if (!pl.alive) return;
    if (!townsOf(st, i).length && !heroesOf(st, i).length) {
      pl.alive = false;
      note(st, `${pl.name} выбывает из игры`);
      events.push({ type: "eliminated", player: i });
    }
  });
  const left = st.players.map((pl, i) => (pl.alive ? i : -1)).filter((i) => i >= 0);
  if (left.length <= 1) {
    st.over = true;
    st.winner = left.length ? left[0] : null;
    note(st, left.length ? `Победа: ${st.players[left[0]].name}!` : "Ничья");
    events.push({ type: "gameOver", winner: st.winner });
  }
}

// ---------- конец хода, новый день ----------

function endTurn(st, events) {
  const n = st.players.length;
  let next = st.turn;
  for (let k = 0; k < n; k++) {
    next = (next + 1) % n;
    if (next === 0) newDay(st, events);
    if (st.players[next].alive) break;
  }
  st.turn = next;
  startTurn(st, next, events);
}

function newDay(st, events) {
  st.day++;
  if ((st.day - 1) % 7 === 0) {
    // Новая неделя: прирост в жилищах, нейтралы подрастают.
    for (const t of st.objects) {
      if (t.kind === "town") {
        for (let tier = 1; tier <= 5; tier++)
          if (t.built[`dw${tier}`]) t.stock[tier] = Math.min((t.stock[tier] || 0) + UNITS[FACTIONS[t.faction].units[tier - 1]].growth, UNITS[FACTIONS[t.faction].units[tier - 1]].growth * 3);
      } else if (t.kind === "monster") t.n = Math.ceil(t.n * 1.1);
    }
    note(st, `Неделя ${Math.ceil(st.day / 7)}: в жилищах пополнение`);
    events.push({ type: "week" });
  }
}

function startTurn(st, p, events) {
  const pl = st.players[p];
  const inc = dailyIncome(st, p);
  for (const k of Object.keys(inc)) pl.res[k] += inc[k];
  for (const h of heroesOf(st, p)) {
    h.mp = HERO_MP;
    h.mana = Math.min(maxMana(h), h.mana + 2);
    const town = st.objects.find((t) => t.kind === "town" && t.owner === p && t.x === h.x && t.y === h.y);
    if (town) h.mana = Math.max(h.mana, maxMana(h));
  }
  // Туман вокруг своих городов и героев.
  for (const t of townsOf(st, p)) reveal(st, p, t.x, t.y, VIEW_TOWN);
  for (const h of heroesOf(st, p)) reveal(st, p, h.x, h.y, VIEW_HERO);
  note(st, `День ${st.day}. Ходит ${pl.name}`);
  events.push({ type: "turn", player: p, day: st.day, income: inc });
}

export { idx, SPELLS };
