// Образ CD из файлов (private/iso.js): разбираем обратно и сверяем имена и содержимое.
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildIso } from "../private/iso.js";

const S = 2048;
const dec = new TextDecoder();
const ucs2 = (b) => { let s = ""; for (let i = 0; i + 1 < b.length; i += 2) s += String.fromCharCode((b[i] << 8) | b[i + 1]); return s; };

/** Записи каталога по (lba, size) — имя, lba, size, папка ли. */
function readDir(u8, lba, size, joliet) {
  const out = [];
  for (let o = lba * S, end = o + size; o < end;) {
    const len = u8[o];
    if (!len) { o = (Math.floor(o / S) + 1) * S; continue; }
    const v = new DataView(u8.buffer, o);
    const idLen = u8[o + 32];
    const id = u8.slice(o + 33, o + 33 + idLen);
    if (!(idLen === 1 && (id[0] === 0 || id[0] === 1))) {
      out.push({ name: joliet ? ucs2(id) : dec.decode(id), lba: v.getUint32(2, true), size: v.getUint32(10, true), dir: !!(u8[o + 25] & 2) });
    }
    o += len;
  }
  return out;
}
const rootOf = (u8, sector) => { const v = new DataView(u8.buffer, sector * S + 156); return { lba: v.getUint32(2, true), size: v.getUint32(10, true) }; };

test("образ: Joliet с длинными и русскими именами, папки, содержимое", async () => {
  const big = new Uint8Array(5000).map((_, i) => i % 251);
  const long = "Очень длинное имя установщика программы для проверки обрезки до шестидесяти четырёх знаков.exe";
  const iso = await buildIso([
    { path: "setup.exe", file: new Blob([big]) },
    { path: "Драйверы/ASIO4ALL установка.exe", file: new Blob(["asio"]) },
    { path: "Драйверы/звук/readme.txt", file: new Blob(["привет"]) },
    { path: long, file: new Blob(["x"]) },
    { path: "пусто.txt", file: new Blob([]) },
  ], "Файлы");
  const u8 = new Uint8Array(iso);
  assert.equal(iso.byteLength % S, 0);
  assert.equal(dec.decode(u8.slice(16 * S + 1, 16 * S + 6)), "CD001");
  assert.equal(u8[16 * S], 1);
  assert.equal(u8[17 * S], 2);
  assert.deepEqual([...u8.slice(17 * S + 88, 17 * S + 91)], [0x25, 0x2f, 0x45]);
  assert.equal(u8[18 * S], 255);
  // Joliet.
  const jr = rootOf(u8, 17);
  const top = readDir(u8, jr.lba, jr.size, true);
  const names = top.map((x) => x.name).sort();
  assert.ok(names.includes("setup.exe;1"));
  assert.ok(names.includes("пусто.txt;1"));
  assert.ok(names.includes("Драйверы"));
  const cut = names.find((n) => n.startsWith("Очень"));
  assert.ok(cut && cut.replace(/;1$/, "").length <= 64 && cut.endsWith(".exe;1"), cut);
  const setup = top.find((x) => x.name === "setup.exe;1");
  assert.equal(setup.size, 5000);
  assert.deepEqual(u8.slice(setup.lba * S, setup.lba * S + 5000), big);
  const drv = readDir(u8, top.find((x) => x.name === "Драйверы").lba, top.find((x) => x.name === "Драйверы").size, true);
  assert.deepEqual(drv.map((x) => x.name).sort(), ["ASIO4ALL установка.exe;1", "звук"]);
  const snd = drv.find((x) => x.name === "звук");
  const rd = readDir(u8, snd.lba, snd.size, true)[0];
  assert.equal(new TextDecoder().decode(u8.slice(rd.lba * S, rd.lba * S + rd.size)), "привет");
  // ISO 9660 (8.3) — те же файлы под короткими именами.
  const pr = rootOf(u8, 16);
  const short = readDir(u8, pr.lba, pr.size, false).map((x) => x.name);
  assert.ok(short.includes("SETUP.EXE;1"));
  assert.ok(short.every((n) => /^[A-Z0-9_~]{1,8}(\.[A-Z0-9_]{0,3};1)?$/.test(n)), short.join(" "));
});

test("образ: одинаковые короткие имена не сталкиваются", async () => {
  const iso = await buildIso([
    { path: "Программа1.exe", file: new Blob(["1"]) },
    { path: "Программа2.exe", file: new Blob(["2"]) },
    { path: "программа3.EXE", file: new Blob(["3"]) },
  ]);
  const u8 = new Uint8Array(iso);
  const pr = rootOf(u8, 16);
  const short = readDir(u8, pr.lba, pr.size, false).map((x) => x.name);
  assert.equal(new Set(short).size, 3, short.join(" "));
});
