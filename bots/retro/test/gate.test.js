import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gzipSync } from "node:zlib";

const BOT = "test-bot-token";
const dir = mkdtempSync(join(tmpdir(), "retro-"));
writeFileSync(join(dir, "allow.txt"), "# владелец\n@Owner\nid-friend\n");
mkdirSync(join(dir, "machines", "game"), { recursive: true });
writeFileSync(join(dir, "machines", "game", "machine.json"), JSON.stringify({ title: "Игра", ram: 128, hda: "disk.img", cdrom: "../../allow.txt", start: "start.bin.gz" }));
writeFileSync(join(dir, "machines", "game", "disk.img"), Buffer.from(Array.from({ length: 4096 }, (_, i) => i & 255)));
writeFileSync(join(dir, "machines", "game", "start.bin.gz"), gzipSync(Buffer.alloc(100000, 7)));
process.env.HYAX_BOT_TOKEN = BOT;
process.env.DATA_DIR = dir;

const { server, issuePass, checkPass } = await import("../server/index.js");
const { signInitData } = await import("../server/auth.js");
let base;

before(() => new Promise((ok) => server.listen(0, () => { base = `http://localhost:${server.address().port}`; ok(); })));
after(() => server.close());

const session = (initData) => fetch(`${base}/api/session`, {
  method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ initData }),
});

test("страница открыта, эмулятор без пропуска — нет", async () => {
  assert.equal((await fetch(`${base}/`)).status, 200);
  assert.equal((await fetch(`${base}/gate.js`)).status, 200);
  assert.equal((await fetch(`${base}/app.js`)).status, 404);
  assert.equal((await fetch(`${base}/v86/v86.wasm`)).status, 404);
  assert.equal((await fetch(`${base}/s/forged.sig/app.js`)).status, 403);
});

test("без WYX и с поддельной подписью пропуска нет", async () => {
  assert.equal((await session("")).status, 401);
  const forged = signInitData({ id: "x", username: "Owner" }, "other-token");
  assert.equal((await session(forged)).status, 401);
});

test("чужому — отказ с его именем", async () => {
  const r = await session(signInitData({ id: "stranger", username: "guest" }, BOT));
  assert.equal(r.status, 403);
  assert.equal((await r.json()).username, "guest");
});

test("из списка — по имени (без учёта регистра) и по id; пропуск открывает эмулятор", async () => {
  for (const user of [{ id: "u1", username: "owner" }, { id: "id-friend", username: "f" }]) {
    const r = await session(signInitData(user, BOT));
    assert.equal(r.status, 200);
    const { pass } = await r.json();
    const app = await fetch(`${base}/s/${pass}/app.js`);
    assert.equal(app.status, 200);
    assert.match(app.headers.get("content-type"), /javascript/);
    const wasm = await fetch(`${base}/s/${pass}/v86/v86.wasm`);
    assert.equal(wasm.headers.get("content-type"), "application/wasm");
    assert.equal((await fetch(`${base}/s/${pass}/..%2fserver%2findex.js`)).status, 404);
  }
});

test("пропуск: подделка, срок и вычеркнутый из списка", () => {
  const pass = issuePass({ id: "u1", username: "owner" });
  assert.ok(checkPass(pass));
  const [data, s] = pass.split(".");
  const other = Buffer.from(JSON.stringify({ u: "u2", n: "owner", e: 9e9 })).toString("base64url");
  assert.equal(checkPass(`${other}.${s}`), null);
  assert.equal(checkPass(pass, Date.now() / 1000 + 3 * 86400), null);
  assert.equal(checkPass(issuePass({ id: "u3", username: "gone" })), null);
  assert.ok(data);
});

test("готовые машины: список и диск кусками — только по пропуску", async () => {
  const pass = issuePass({ id: "u1", username: "owner" });
  const list = await (await fetch(`${base}/s/${pass}/machines.json`)).json();
  // cdrom с путём наружу отброшен, остался только диск
  assert.equal(list.length, 1);
  const { hda, start, ...m } = list[0];
  assert.deepEqual(m, { id: "game", title: "Игра", ram: 128 });
  assert.equal(hda.size, 4096);
  assert.ok(hda.v > 0 && start.size < 1000);
  // Снимок — сжатым целиком, fetch разжимает сам
  const st = await fetch(`${base}/s/${pass}/m/game/start`);
  assert.equal(st.headers.get("content-encoding"), "gzip");
  assert.equal((await st.arrayBuffer()).byteLength, 100000);
  const r = await fetch(`${base}/s/${pass}/m/game/hda`, { headers: { Range: "bytes=256-511" } });
  assert.equal(r.status, 206);
  assert.equal(r.headers.get("content-range"), "bytes 256-511/4096");
  const buf = new Uint8Array(await r.arrayBuffer());
  assert.equal(buf.length, 256);
  assert.equal(buf[0], 0);
  assert.equal(buf[255], 255);
  assert.equal((await fetch(`${base}/s/${pass}/m/game/hda`, { headers: { Range: "bytes=5000-6000" } })).status, 416);
  assert.equal((await fetch(`${base}/s/${pass}/m/game/cdrom`)).status, 404);
  assert.equal((await fetch(`${base}/s/${pass}/m/..%2f..%2fallow.txt/hda`)).status, 404);
  assert.equal((await fetch(`${base}/s/forged.x/m/game/hda`)).status, 403);
});
