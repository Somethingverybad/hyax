import { test } from "node:test";
import assert from "node:assert/strict";
import { createGame, act, heroesOf, townsOf } from "../shared/game.js";
import { findPath } from "../shared/map.js";

const game = () => createGame({ seed: 5, size: "S", players: [
  { uid: "a", name: "А", faction: "dawn" }, { uid: "b", name: "Б", faction: "ash" }] });

test("чужой ход и чужой герой отклоняются", () => {
  const st = game();
  const hb = heroesOf(st, 1)[0];
  assert.equal(act(st, 1, { type: "end" }).error, "Сейчас не ваш ход");
  assert.equal(act(st, 0, { type: "move", hero: hb.id, x: 5, y: 5 }).error, "Это не ваш герой");
});

test("ход героя тратит очки и не уходит дальше запаса", () => {
  const st = game();
  const h = heroesOf(st, 0)[0];
  const seen = st.players[0].seen;
  let target = null;
  for (let y = 0; y < st.h && !target; y++) for (let x = 0; x < st.w && !target; x++) {
    const p = seen[y * st.w + x] === "1" && findPath(st, h, x, y, seen);
    if (p && p.length >= 3 && !st.objects.some((o) => o.x === x && o.y === y)) target = [x, y, p];
  }
  const [x, y, p] = target;
  const r = act(st, 0, { type: "move", hero: h.id, x, y });
  assert.ok(!r.error, r.error);
  const cost = p[p.length - 1].cost;
  if (cost <= 160) { assert.deepEqual([h.x, h.y], [x, y]); assert.equal(h.mp, 160 - cost); }
  else assert.ok(h.mp < cost);
});

test("стройка: раз в день и за ресурсы; найм — в армию", () => {
  const st = game();
  const t = townsOf(st, 0)[0];
  assert.ok(!act(st, 0, { type: "build", town: t.id, id: "dw2" }).error);
  assert.equal(act(st, 0, { type: "build", town: t.id, id: "guild1" }).error, "Сегодня уже строили");
  const gold = st.players[0].res.gold;
  assert.ok(!act(st, 0, { type: "recruit", town: t.id, tier: 2, n: 3 }).error);
  assert.equal(st.players[0].res.gold, gold - 300);
  assert.equal(act(st, 0, { type: "recruit", town: t.id, tier: 2, n: 999 }).error, "Столько нет");
});

test("новый день — доход и полный запас хода", () => {
  const st = game();
  const g0 = st.players[1].res.gold;
  act(st, 0, { type: "end" });
  assert.equal(st.turn, 1);
  assert.equal(st.players[1].res.gold, g0 + 500);
  act(st, 1, { type: "end" });
  assert.equal(st.day, 2);
  assert.equal(heroesOf(st, 0)[0].mp, 160);
});

test("бой двух людей: защитник ходит не в свой ход, итог применяется", () => {
  const st = game();
  const ha = heroesOf(st, 0)[0], hb = heroesOf(st, 1)[0];
  // Ставим героя Б вплотную к А на свободную клетку.
  const free = [[1, 0], [0, 1], [1, 1], [-1, 0], [0, -1]].map(([dx, dy]) => [ha.x + dx, ha.y + dy])
    .find(([x, y]) => !"TM~".includes(st.terrain[y * st.w + x]) && !st.objects.some((o) => o.x === x && o.y === y));
  [hb.x, hb.y] = free;
  st.players[0].seen = "1".repeat(st.w * st.h);
  assert.ok(!act(st, 0, { type: "move", hero: ha.id, x: hb.x, y: hb.y }).error);
  assert.ok(st.battle, "бой начался");
  assert.deepEqual(st.battle.sides.map((s) => s.player), [0, 1]);
  let guard = 0;
  while (st.battle && guard++ < 400) {
    const b = st.battle;
    const s = b.stacks.find((x) => x.id === b.active);
    const owner = b.sides[s.side].player;
    assert.equal(act(st, 1 - owner, { type: "bdefend" }).error, "Сейчас ходит противник");
    const enemy = b.stacks.find((x) => x.side !== s.side && x.n > 0);
    const r = act(st, owner, { type: "bshoot", target: enemy.id });
    if (r.error) act(st, owner, { type: "bauto", on: true });
  }
  assert.equal(st.battle, null, "бой закончился");
  assert.equal(st.heroes.length, 1, "проигравший герой ушёл с карты");
});
