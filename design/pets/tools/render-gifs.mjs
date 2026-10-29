// GIF каждой позы пака на «пузыре» — превью для глаз (позы, пол, окрас).
//
//   node design/pets/tools/render-gifs.mjs <папка пака> <папка для GIF> [пол m|f] [окрас]
//
// Кадры снимает Chromium (playwright-core: PLAYWRIGHT_CORE), GIF собирает ffmpeg.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, "../../..");
const pw = process.env.PLAYWRIGHT_CORE || "/Users/andrejcerenev/.npm/_npx/e41f203b7505f1fb/node_modules/playwright-core/index.mjs";
const { chromium } = await import(pw);
const [dir, outDir, sex = "m", coat = ""] = process.argv.slice(2);
const man = JSON.parse(fs.readFileSync(`${dir}/manifest.json`, "utf8"));
const lottie = fs.readFileSync(path.join(repo, "sux-chat-app/node_modules/lottie-web/build/player/lottie.min.js"), "utf8");
const look = fs.readFileSync(path.join(here, "look.js"), "utf8");
const [cw, ch] = man.canvas, [, ay] = man.anchor, k = 1.2;
fs.mkdirSync(outDir, { recursive: true });
const b = await chromium.launch();
const page = await b.newPage({ viewport: { width: Math.round(cw * k), height: Math.round(ch * k) }, deviceScaleFactor: 2 });
await page.setContent(`<html><body style="margin:0;background:#EFEBE4"><div style="position:relative;width:${cw * k}px;height:${ch * k}px">
<div style="position:absolute;left:${14 * k}px;right:${14 * k}px;top:${ay * k}px;bottom:0;background:#2F6B57;border-radius:${16 * k}px ${16 * k}px 0 0"></div>
<div id=box style="position:absolute;inset:0"></div></div></body></html>`);
await page.addScriptTag({ content: lottie });
await page.addScriptTag({ content: look });
for (const [name, meta] of Object.entries(man.poses)) {
  const data = JSON.parse(fs.readFileSync(`${dir}/${(meta.files && meta.files[sex]) || meta.file}`, "utf8"));
  const n = await page.evaluate(({ data, man, sex, coat }) => {
    const box = document.getElementById("box"); box.innerHTML = "";
    window.anim?.destroy();
    window.anim = lottie.loadAnimation({ container: box, renderer: "svg", loop: false, autoplay: false, animationData: PetLook.shapePet(data, man, { sex, coat: coat || null, acc: null }) });
    return Math.round(data.op - data.ip);
  }, { data, man, sex, coat });
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "petgif-"));
  let i = 0;
  for (let f = 0; f < n; f += 2) {
    await page.evaluate((f) => window.anim.goToAndStop(f, true), f);
    await page.screenshot({ path: path.join(tmp, `${String(i++).padStart(3, "0")}.png`) });
  }
  execFileSync("ffmpeg", ["-loglevel", "error", "-y", "-framerate", "15", "-i", path.join(tmp, "%03d.png"), "-vf",
    "split[a][b];[a]palettegen=reserve_transparent=0[p];[b][p]paletteuse=dither=sierra2_4a", "-loop", "0", path.join(outDir, `${name}.gif`)]);
  fs.rmSync(tmp, { recursive: true, force: true });
  console.log(name, i);
}
await b.close();
