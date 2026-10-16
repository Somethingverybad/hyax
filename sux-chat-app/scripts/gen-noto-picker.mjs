// Данные для выбора эмодзи (components/chat/EmojiPanel.tsx): только те эмодзи,
// у которых есть анимация Noto на нашем сервере (src/lib/notoEmojiList.ts), —
// с разделами и ключевыми словами для поиска (ru/en/ko) из emojibase-data (MIT).
// Запуск: node scripts/gen-noto-picker.mjs → src/lib/notoPickerData.ts
import fs from "node:fs";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);

const listSrc = fs.readFileSync(new URL("../src/lib/notoEmojiList.ts", import.meta.url), "utf8");
const codes = [...listSrc.matchAll(/"([^"]*)"/g)].map((m) => m[1]).join(" ").split(/\s+/).filter(Boolean);
const norm = (hex) => hex.toLowerCase().replace(/-/g, "_").split("_").filter((p) => p !== "fe0f").join("_");

const langs = ["ru", "en", "ko"];
const data = Object.fromEntries(langs.map((l) => [l, require(`emojibase-data/${l}/compact.json`)]));
const groupsMeta = require("emojibase-data/meta/groups.json").groups;
const byLang = Object.fromEntries(langs.map((l) => [l, new Map()]));
for (const l of langs) {
  for (const e of data[l]) {
    byLang[l].set(norm(e.hexcode), e);
    for (const s of e.skins || []) byLang[l].set(norm(s.hexcode), { ...s, tags: e.tags, base: e });
  }
}
const kw = (e) => (e ? [e.label, ...(e.tags || [])].join(" ").toLowerCase().replace(/\s+/g, " ").trim() : "");

const groups = new Map();
let missing = 0;
for (const code of codes) {
  const ru = byLang.ru.get(norm(code));
  const g = ru ? (ru.group ?? ru.base?.group ?? 8) : 8;
  if (!ru) missing++;
  const order = ru ? (ru.order ?? ru.base?.order ?? 99999) : 99999;
  const item = [code, kw(ru), kw(byLang.en.get(norm(code))), kw(byLang.ko.get(norm(code)))];
  if (!groups.has(g)) groups.set(g, []);
  groups.get(g).push({ order, item });
}
const out = [...groups.entries()].filter(([g]) => g !== 2).sort((a, b) => a[0] - b[0]).map(([g, rows]) => ({
  group: groupsMeta[g] || "other",
  items: rows.sort((a, b) => a.order - b.order).map((r) => r.item),
}));
const body = `// Сгенерировано scripts/gen-noto-picker.mjs — не править руками.\n` +
  `// Эмодзи Noto с анимацией на нашем сервере: [код, ключевые слова ru, en, ko] по разделам.\n` +
  `export const NOTO_PICKER: { group: string; items: [string, string, string, string][] }[] = ${JSON.stringify(out)};\n`;
fs.writeFileSync(new URL("../src/lib/notoPickerData.ts", import.meta.url), body);
console.log(`эмодзи: ${codes.length}, разделов: ${out.length}, без данных emojibase: ${missing}, размер: ${(body.length / 1024).toFixed(0)} КБ`);
console.log(out.map((g) => `${g.group}:${g.items.length}`).join(" "));
