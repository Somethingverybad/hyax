// Проверка протокола без браузера: node test/client.mjs [http://127.0.0.1:8099] [id] [room] [команды…]
// Подключается как игрок (DEV=1 на сервере), ждёт ready и первые байты VNC,
// затем шлёт команды ввода вида move:640,512 click:left tap:ret text:hello rel:10,0 park sleep:2
const base = process.argv[2] || "http://127.0.0.1:8099";
const id = process.argv[3] || "1001";
const room = process.argv[4] || "";
const cmds = process.argv.slice(5);

const initData = await (await fetch(`${base}/dev/init?id=${id}&name=dev${id}`)).text();
const ws = new WebSocket(base.replace(/^http/, "ws") + "/ws");
ws.binaryType = "arraybuffer";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let ready = null, rfb = "";
ws.onopen = () => ws.send(JSON.stringify({ t: "hello", initData, room }));
ws.onmessage = (e) => {
  if (typeof e.data === "string") { const m = JSON.parse(e.data); console.log("←", e.data.slice(0, 200)); if (m.t === "ready") ready = m; if (m.t === "error") process.exit(2); }
  else if (!rfb) { rfb = Buffer.from(e.data).toString("latin1").slice(0, 12); console.log("← VNC:", JSON.stringify(rfb)); }
};
ws.onclose = (e) => { console.log("закрыт", e.code); process.exit(ready ? 0 : 3); };
for (let i = 0; i < 600 && !ready; i++) await sleep(100);
if (!ready) { console.log("нет ready"); process.exit(1); }
for (let i = 0; i < 50 && !rfb; i++) await sleep(100);
if (!rfb.startsWith("RFB")) { console.log("нет VNC"); process.exit(4); }
for (const c of cmds) {
  const i = c.indexOf(":"); const t = i < 0 ? c : c.slice(0, i), a = i < 0 ? "" : c.slice(i + 1); const n = a.split(",").map(Number);
  if (t === "sleep") { await sleep(n[0] * 1000); continue; }
  const m = { move: { t: "move", x: n[0], y: n[1] }, rel: { t: "rel", dx: n[0], dy: n[1] }, click: { t: "click", b: a || "left" }, dbl: { t: "click", b: a || "left", n: 2 },
    tap: { t: "tap", k: a }, text: { t: "text", s: a }, park: { t: "park" }, down: { t: "btn", b: a, down: true }, up: { t: "btn", b: a, down: false } }[t];
  if (!m) { console.log("?", c); continue; }
  console.log("→", JSON.stringify(m)); ws.send(JSON.stringify(m)); await sleep(300);
}
await sleep(500);
ws.close();
