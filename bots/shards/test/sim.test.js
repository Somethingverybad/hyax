import { test } from "node:test";
import assert from "node:assert/strict";
import { createGame, act, currentPlayer } from "../shared/game.js";
import { nextAiAction } from "../shared/ai.js";

/** Партия одних компьютеров до конца или до лимита дней. */
function simulate(seed, size, factions, maxDays = 90) {
  const st = createGame({ seed, size, players: factions.map((f, i) => ({ uid: `ai${i}`, name: `ИИ ${i + 1}`, faction: f, ai: true })) });
  let mem = {}, turnKey = "";
  let steps = 0, battles = 0;
  while (!st.over && st.day <= maxDays && steps < 200000) {
    steps++;
    const key = `${st.day}:${st.turn}`;
    if (key !== turnKey) { mem = {}; turnKey = key; }
    const p = st.turn;
    const a = nextAiAction(st, p, mem);
    const r = act(st, p, a);
    if (r.error) {
      // Ошибка ИИ не должна зацикливать: заканчиваем ход.
      const e = act(st, p, { type: "end" });
      assert.ok(!e.error, `end после ошибки «${r.error}»: ${e.error}`);
    } else if (r.events.some((e) => e.type === "battleEnd")) battles++;
    assert.equal(st.battle, null, "бой ИИ против ИИ должен закончиться сразу");
  }
  return { st, steps, battles };
}

for (const [seed, size, f] of [[1, "S", ["dawn", "ash"]], [7, "M", ["wild", "dawn", "ash"]], [42, "M", ["ash", "wild", "dawn", "wild"]], [99, "L", ["dawn", "wild"]]]) {
  test(`симуляция seed=${seed} ${size} ${f.join("/")}`, () => {
    const { st, steps, battles } = simulate(seed, size, f);
    console.log(`seed ${seed}: день ${st.day}, шагов ${steps}, боёв ${battles}, конец=${st.over}, победитель=${st.winner}, героев ${st.heroes.length}`);
    assert.ok(battles > 0, "должны быть бои");
    for (const h of st.heroes) assert.ok(h.army.some(Boolean), "герой без армии");
  });
}
