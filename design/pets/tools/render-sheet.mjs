// Лист поз пака для проверки глазами: каждая поза — несколько кадров на «пузыре».
//
//   node design/pets/tools/render-sheet.mjs <папка пака> <out.png> [пол m|f] [окрас] [позы,через,запятую] [кадров]
//
// Нужен playwright-core: путь к нему — в PLAYWRIGHT_CORE (по умолчанию — из npx-кэша).
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, "../../..");
const pw = process.env.PLAYWRIGHT_CORE || "/Users/andrejcerenev/.npm/_npx/e41f203b7505f1fb/node_modules/playwright-core/index.mjs";
const { chromium } = await import(pw);

const [dir, out, sex = "m", coat = "", only = "", framesArg = "3"] = process.argv.slice(2);
const man = JSON.parse(fs.readFileSync(`${dir}/manifest.json`, "utf8"));
const keys = only ? only.split(",") : Object.keys(man.poses);
// У пола может быть свой файл позы (poses.<поза>.files.f) — как в приложении (lib/pets.ts).
const poseFile = (k) => (man.poses[k].files || {})[sex] || man.poses[k].file;
const poses = Object.fromEntries(keys.map((k) => [k, JSON.parse(fs.readFileSync(`${dir}/${poseFile(k)}`, "utf8"))]));
const lottie = fs.readFileSync(path.join(repo, "sux-chat-app/node_modules/lottie-web/build/player/lottie.min.js"), "utf8");
const look = fs.readFileSync(path.join(here, "look.js"), "utf8");
const k = 0.9, [cw, ch] = man.canvas, frames = Number(framesArg);

const b = await chromium.launch();
const page = await b.newPage({ viewport: { width: Math.round(frames * cw * k + 110), height: 200 }, deviceScaleFactor: 2 });
await page.setContent(`<html><body style="margin:0;background:#EFEBE4;font:15px -apple-system,sans-serif"><div id=g></div></body></html>`);
await page.addScriptTag({ content: lottie });
await page.addScriptTag({ content: look });
await page.evaluate(({ poses, man, k, cw, ch, sex, coat, frames }) => {
  const g = document.getElementById("g");
  for (const [name, data] of Object.entries(poses)) {
    const row = document.createElement("div");
    row.style.cssText = "display:flex;align-items:center;border-bottom:1px solid #d8d2c8";
    const lab = document.createElement("div");
    lab.textContent = name;
    lab.style.cssText = "width:110px;padding-left:8px;font-weight:600";
    row.appendChild(lab);
    for (let i = 0; i < frames; i++) {
      const cell = document.createElement("div");
      cell.style.cssText = `position:relative;width:${cw * k}px;height:${ch * k}px`;
      const bub = document.createElement("div");
      bub.style.cssText = `position:absolute;left:${14 * k}px;right:${14 * k}px;top:${man.anchor[1] * k}px;bottom:0;border-radius:${16 * k}px ${16 * k}px 0 0;background:#2F6B57`;
      const box = document.createElement("div");
      box.style.cssText = "position:absolute;inset:0";
      cell.append(bub, box);
      row.appendChild(cell);
      const shaped = PetLook.shapePet(JSON.parse(JSON.stringify(data)), man, { sex, coat: coat || null, acc: null });
      const a = lottie.loadAnimation({ container: box, renderer: "svg", loop: false, autoplay: false, animationData: shaped });
      a.goToAndStop(Math.round((data.op - 1) * i / frames), true);
    }
    g.appendChild(row);
  }
}, { poses, man, k, cw, ch, sex, coat, frames });
await page.waitForTimeout(700);
await page.screenshot({ path: out, fullPage: true });
await b.close();
