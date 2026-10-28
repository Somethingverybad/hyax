// Лист превью поз пака питомца: каждая поза — 3 кадра на «пузыре».
// node design/pets/preview.mjs sux-chat-app/public/pets/<вид> out.png [масштаб]  (нужен playwright-core: NODE_PATH или npx)
import { chromium } from "playwright-core";
import fs from "node:fs";
const [dir, out, scale = "1"] = process.argv.slice(2);
const man = JSON.parse(fs.readFileSync(`${dir}/manifest.json`, "utf8"));
const lottie = fs.readFileSync(new URL("../../sux-chat-app/node_modules/lottie-web/build/player/lottie.min.js", import.meta.url), "utf8");
const poses = Object.entries(man.poses).map(([k, p]) => [k, JSON.parse(fs.readFileSync(`${dir}/${p.file}`, "utf8"))]);
const [cw, ch] = man.canvas; const k = Number(scale);
const b = await chromium.launch();
const page = await b.newPage({ viewport: { width: Math.round(3 * cw * k + 140), height: 400 }, deviceScaleFactor: 1 });
await page.setContent(`<html><body style="margin:0;background:#E6E2DC;font:12px sans-serif"><div id=g></div></body></html>`);
await page.addScriptTag({ content: lottie });
await page.evaluate(({ poses, cw, ch, k, anchor }) => {
  const g = document.getElementById("g");
  for (const [name, data] of poses) {
    const row = document.createElement("div"); row.style.cssText = "display:flex;align-items:center;gap:0;border-bottom:1px solid #ccc";
    const lab = document.createElement("div"); lab.textContent = name; lab.style.cssText = "width:70px;padding-left:6px"; row.appendChild(lab);
    for (const f of [0, 1 / 3, 2 / 3]) {
      const cell = document.createElement("div"); cell.style.cssText = `position:relative;width:${cw * k}px;height:${ch * k}px`;
      const bub = document.createElement("div"); bub.style.cssText = `position:absolute;left:${10 * k}px;right:${10 * k}px;top:${anchor[1] * k}px;bottom:0;background:#6E8F82;border-radius:${12 * k}px`;
      const box = document.createElement("div"); box.style.cssText = `position:absolute;inset:0`;
      cell.appendChild(bub); cell.appendChild(box); row.appendChild(cell);
      const a = lottie.loadAnimation({ container: box, renderer: "svg", loop: false, autoplay: false, animationData: data });
      a.goToAndStop(Math.round(f * (data.op - 1)), true);
    }
    g.appendChild(row);
  }
}, { poses, cw, ch, k, anchor: man.anchor });
await page.waitForTimeout(500);
const h = await page.evaluate(() => document.body.scrollHeight);
await page.setViewportSize({ width: Math.round(3 * cw * k + 80), height: h });
await page.screenshot({ path: out, fullPage: true });
await b.close();
console.log("ok", out);
