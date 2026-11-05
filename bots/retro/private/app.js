// Ретро-ПК: эмулятор x86 (v86) в мини-приложении WYX. Образы дисков выбирает
// пользователь; они читаются с устройства и на сервер не уходят. Сохранения
// машины и запомненный диск лежат в памяти браузера (OPFS) этого устройства.

import { V86 } from "./v86/libv86.mjs";

const WA = window.WYX?.WebApp;
WA?.ready();
const $ = (id) => document.getElementById(id);
const MB = 1024 * 1024;

let toastTimer = null;
function toast(text, ms = 2800) {
  const t = $("toast");
  t.textContent = text;
  t.classList.remove("hidden");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.add("hidden"), ms);
}

const fmtSize = (n) => n >= 1024 * MB ? `${(n / 1024 / MB).toFixed(1)} ГБ` : `${Math.max(1, Math.round(n / MB))} МБ`;
const store = {
  get: (k) => { try { return JSON.parse(localStorage.getItem(`retro:${k}`) || "null"); } catch { return null; } },
  set: (k, v) => { try { localStorage.setItem(`retro:${k}`, JSON.stringify(v)); } catch { /* приватный режим */ } },
  del: (k) => { try { localStorage.removeItem(`retro:${k}`); } catch { /* приватный режим */ } },
};

// ================= память устройства (OPFS) =================

async function opfsDir() {
  try { return await navigator.storage.getDirectory(); } catch { return null; }
}
async function opfsRead(name) {
  const d = await opfsDir();
  if (!d) return null;
  try { return await (await d.getFileHandle(name)).getFile(); } catch { return null; }
}
/** Записать Blob/ArrayBuffer; для больших файлов — кусками, с прогрессом. */
async function opfsWrite(name, data, onProgress) {
  const d = await opfsDir();
  if (!d) throw new Error("Память устройства недоступна");
  const h = await d.getFileHandle(name, { create: true });
  const w = await h.createWritable();
  try {
    if (data instanceof Blob) {
      const reader = data.stream().getReader();
      let done = 0;
      for (;;) {
        const { done: end, value } = await reader.read();
        if (end) break;
        await w.write(value);
        done += value.length;
        onProgress?.(done / data.size);
      }
    } else await w.write(data);
    await w.close();
  } catch (e) {
    await w.abort().catch(() => {});
    await d.removeEntry(name).catch(() => {});
    throw e;
  }
}
async function opfsRemove(name) {
  const d = await opfsDir();
  if (d) await d.removeEntry(name).catch(() => {});
}

async function storageInfo() {
  try {
    const e = await navigator.storage.estimate();
    $("storageInfo").textContent = e.usage > MB ? `На устройстве занято ${fmtSize(e.usage)} из ${fmtSize(e.quota)}` : "";
  } catch { /* нет оценки */ }
}

// ================= выбор образов =================

const drives = { hda: null, cd: null, fd: null };
const noOpfs = !navigator.storage?.getDirectory;
/** Готовая машина с сервера, если включили её, а не свои образы. */
let preset = null;

/** Ключ сохранения — по диску: другое железо с этим сохранением не запустится. */
const stateKey = (m = preset) => m ? `state:srv:${m.id}:${m.hda?.size || 0}:${m.cdrom?.size || 0}`
  : drives.hda ? `state:${drives.hda.name}:${drives.hda.size}` : drives.fd ? `state:fd:${drives.fd.name}:${drives.fd.size}` : null;
const stateFileName = (key) => `${key.replace(/[^\w.-]+/g, "_")}.bin`;

function renderSetup() {
  for (const [k, def] of [["hda", "Образ .img — система с установленными играми"], ["cd", "Образ .iso"], ["fd", "Образ .img, 1,44 МБ"]]) {
    const f = drives[k];
    $(`${k}Name`).textContent = f ? `${f.name} · ${fmtSize(f.size)}${f.fromDevice ? " · с устройства" : ""}` : def;
    $(`${k}Clear`).classList.toggle("hidden", !f);
  }
  $("rememberRow").classList.toggle("hidden", noOpfs || !drives.hda || drives.hda.fromDevice);
  $("boot").disabled = !drives.hda && !drives.cd && !drives.fd;
  renderMachines();
  const key = stateKey(null);
  const meta = key && store.get(key);
  $("resume").classList.toggle("hidden", !meta);
  if (meta) $("resume").textContent = `⏯ Продолжить с сохранения · ${new Date(meta.at).toLocaleString("ru", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}`;
}

function bindPick(k) {
  $(`${k}File`).addEventListener("change", async (e) => {
    const f = e.target.files[0];
    e.target.value = "";
    if (!f) return;
    drives[k] = f;
    renderSetup();
    if (k === "hda" && $("remember").checked) rememberDisk(f);
  });
  $(`${k}Clear`).onclick = async () => {
    if (k === "hda" && drives.hda?.fromDevice) {
      if (!confirm("Удалить запомненный диск с устройства? Сохранения машины для него тоже станут бесполезны.")) return;
      await opfsRemove("hda.img");
      store.del("hda");
      storageInfo();
    }
    drives[k] = null;
    renderSetup();
  };
}
["hda", "cd", "fd"].forEach(bindPick);

/** Скопировать образ диска в память устройства, чтобы не выбирать каждый раз. */
async function rememberDisk(f) {
  const bar = $("copyProgress");
  bar.classList.remove("hidden");
  const show = (p) => { bar.querySelector("i").style.width = `${Math.round(p * 100)}%`; bar.querySelector("span").textContent = `Запоминаю диск… ${Math.round(p * 100)}%`; };
  show(0);
  try {
    try { await navigator.storage.persist(); } catch { /* браузер может отказать — не страшно */ }
    await opfsWrite("hda.img", f, show);
    store.set("hda", { name: f.name, size: f.size });
    toast("Диск запомнен — в следующий раз он уже будет выбран");
  } catch (e) {
    toast(`Не удалось запомнить диск: ${e.message || e}. Его можно выбирать каждый раз.`, 4500);
  }
  bar.classList.add("hidden");
  storageInfo();
}

async function loadRemembered() {
  const meta = store.get("hda");
  if (!meta) return;
  const f = await opfsRead("hda.img");
  if (!f || f.size !== meta.size) { store.del("hda"); return; }
  // Имя — как у исходного файла: по нему ищутся сохранения.
  drives.hda = Object.assign(new File([f], meta.name), { fromDevice: true });
  renderSetup();
}

// ================= готовые машины =================

let machines = [];
const fmtDate = (t) => new Date(t).toLocaleString("ru", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

function renderMachines() {
  const box = $("machines");
  box.classList.toggle("hidden", !machines.length);
  $("ownLabel").classList.toggle("hidden", !machines.length);
  box.replaceChildren(...machines.map((m) => {
    const meta = store.get(stateKey(m));
    const row = document.createElement("div");
    row.className = "drive";
    row.innerHTML = '<div class="ic">🎮</div><div class="grow"><b></b><div class="muted small"></div></div><div class="btns"></div>';
    row.querySelector("b").textContent = m.title;
    row.querySelector(".small").textContent = meta ? `сохранено ${fmtDate(meta.at)}` : `${fmtSize((m.hda?.size || 0) + (m.cdrom?.size || 0))} · с сервера`;
    const btn = (text, cls, fn) => {
      const b = document.createElement("button");
      b.className = `btn small ${cls}`;
      b.textContent = text;
      b.onclick = fn;
      row.querySelector(".btns").append(b);
    };
    if (meta) btn("⏯ Продолжить", "primary", () => resumeFrom(m));
    btn(meta ? "▶ Заново" : "▶ Включить", meta ? "" : "primary", () => {
      if (meta && !confirm("Включить заново? Сохранение останется — к нему можно вернуться кнопкой «Продолжить».")) return;
      preset = m;
      if (!m.start) return boot(null, m.ram);
      startFrom(m);
    });
    return row;
  }));
}

/** Снимок уже включённой машины: Windows не грузится заново. Скачивается один раз, потом лежит на устройстве. */
async function startFrom(m) {
  if (!$("startProgress").classList.contains("hidden")) return; // уже грузится
  const name = `start-${m.id}.bin`, ver = `${m.start.size}:${m.start.v}`;
  let state = store.get(`start:${m.id}`) === ver && await opfsRead(name);
  if (state) return boot(await state.arrayBuffer(), m.ram);
  const bar = $("startProgress");
  const show = (text, p) => { bar.querySelector("i").style.width = `${Math.round(p * 100)}%`; bar.querySelector("span").textContent = text; };
  bar.classList.remove("hidden");
  show("Загружаю машину…", 0);
  try {
    const r = await fetch(new URL(`m/${m.id}/start`, import.meta.url));
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    // Сжатый размер известен, разжатый — нет: полоса идёт по сжатому с запасом.
    const reader = r.body.getReader(), parts = [];
    let got = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      parts.push(value);
      got += value.length;
      show(`Загружаю машину… ${fmtSize(got)}`, Math.min(0.95, got / (m.start.size * 3)));
    }
    const buf = new Uint8Array(got);
    let at = 0;
    for (const p of parts) { buf.set(p, at); at += p.length; }
    bar.classList.add("hidden");
    try {
      await opfsWrite(name, buf.buffer);
      store.set(`start:${m.id}`, ver);
    } catch { /* места нет — в другой раз скачается снова */ }
    boot(buf.buffer, m.ram);
  } catch (e) {
    bar.classList.add("hidden");
    toast(`Не удалось загрузить машину: ${e.message || e}. Включаю с нуля.`, 4000);
    boot(null, m.ram);
  }
}

async function loadMachines() {
  try {
    const r = await fetch(new URL("machines.json", import.meta.url));
    if (r.ok) machines = await r.json();
  } catch { /* нет связи — только свои образы */ }
  renderMachines();
}

// ================= диск с сервера =================
// Читается кусками по 256 КБ (Range). Скачанный кусок остаётся в IndexedDB —
// в следующий раз диск читается с устройства, без ожидания сети. Записанное
// машиной живёт в памяти блоками по 256 байт и уходит в 💾 — в том же виде, что
// у дисков v86, так что прежние сохранения подходят.

const CHUNK = 256 * 1024, BLOCK = 256;
const MEM_CHUNKS = 160; // ~40 МБ кусков в памяти, остальное — из IndexedDB

let idb = null;
function chunkDb() {
  idb ||= new Promise((ok) => {
    try {
      const r = indexedDB.open("retro-disk", 1);
      r.onupgradeneeded = () => r.result.createObjectStore("chunks");
      r.onsuccess = () => ok(r.result);
      r.onerror = () => ok(null);
    } catch { ok(null); }
  });
  return idb;
}
async function chunkGet(key) {
  const db = await chunkDb();
  if (!db) return null;
  return new Promise((ok) => {
    try {
      const r = db.transaction("chunks").objectStore("chunks").get(key);
      r.onsuccess = () => ok(r.result || null);
      r.onerror = () => ok(null);
    } catch { ok(null); }
  });
}
async function chunkPut(key, data) {
  const db = await chunkDb();
  try { db?.transaction("chunks", "readwrite").objectStore("chunks").put(data, key); } catch { /* места нет — скачаем снова */ }
}

class NetDisk {
  constructor(url, size, key) {
    this.url = url;
    this.byteLength = size;
    this.key = key;
    this.mem = new Map();     // кусок → данные, по давности обращения
    this.pending = new Map(); // кусок → обещание загрузки
    this.written = new Map(); // блок → данные, записанные машиной
    this.last = -2;
    this.onload = this.onprogress = undefined;
  }
  load() { this.onload?.(Object.create(null)); }

  chunk(i) {
    const c = this.mem.get(i);
    if (c) { this.mem.delete(i); this.mem.set(i, c); return c; }
    let p = this.pending.get(i);
    if (!p) {
      p = this.fetchChunk(i).then((data) => {
        this.mem.set(i, data);
        if (this.mem.size > MEM_CHUNKS) this.mem.delete(this.mem.keys().next().value);
        return data;
      }).finally(() => this.pending.delete(i));
      this.pending.set(i, p);
    }
    return p;
  }

  async fetchChunk(i) {
    const key = `${this.key}:${i}`;
    const saved = await chunkGet(key);
    if (saved) return saved;
    const start = i * CHUNK, end = Math.min(start + CHUNK, this.byteLength) - 1;
    for (let attempt = 0; ; attempt++) {
      try {
        const r = await fetch(this.url, { headers: { Range: `bytes=${start}-${end}` } });
        if (r.status !== 206) throw new Error(`HTTP ${r.status}`);
        const data = new Uint8Array(await r.arrayBuffer());
        chunkPut(key, data);
        return data;
      } catch (e) {
        // Мобильная сеть моргнула — машина подождёт, но не сломается.
        if (attempt === 2) toast("Связь с сервером плохая — диск читается медленно", 4000);
        await new Promise((ok) => setTimeout(ok, Math.min(1000 * 2 ** attempt, 15000)));
      }
    }
  }

  get(offset, len, cb) {
    const first = Math.floor(offset / CHUNK), last = Math.floor((offset + len - 1) / CHUNK);
    // Чтение подряд — подкачиваем следующие куски заранее, пока машина занята этим.
    if (first === this.last || first === this.last + 1) {
      for (let i = last + 1; i <= last + 2 && i * CHUNK < this.byteLength; i++) this.chunk(i);
    }
    this.last = last;
    const parts = [];
    for (let i = first; i <= last; i++) parts.push(this.chunk(i));
    if (parts.every((p) => p instanceof Uint8Array)) cb(this.assemble(offset, len, parts));
    else Promise.all(parts).then((chunks) => cb(this.assemble(offset, len, chunks)));
  }
  get_and_cache(offset, len, cb) { this.get(offset, len, cb); }
  /** Без ожидания: v86 так читает таблицу разделов — она уже в памяти после get_and_cache. */
  get_from_cache(offset, len) {
    const chunks = [];
    for (let i = Math.floor(offset / CHUNK); i * CHUNK < offset + len; i++) {
      const c = this.mem.get(i);
      if (!c) return undefined;
      chunks.push(c);
    }
    return this.assemble(offset, len, chunks);
  }
  assemble(offset, len, chunks) {
    const out = new Uint8Array(len), first = Math.floor(offset / CHUNK);
    chunks.forEach((c, n) => {
      const base = (first + n) * CHUNK;
      const from = Math.max(offset, base), to = Math.min(offset + len, base + c.length);
      out.set(c.subarray(from - base, to - base), from - offset);
    });
    if (this.written.size) {
      for (let b = offset / BLOCK, n = 0; n < len / BLOCK; b++, n++) {
        const w = this.written.get(b);
        if (w) out.set(w, n * BLOCK);
      }
    }
    return out;
  }

  set(offset, data, cb) {
    for (let b = offset / BLOCK, n = 0; n < data.length / BLOCK; b++, n++) this.written.set(b, data.slice(n * BLOCK, (n + 1) * BLOCK));
    cb();
  }
  get_buffer(cb) { cb(); }
  get_state() { return [[...this.written]]; }
  set_state(s) { this.written = new Map(s[0]); }
}

/** Диск машины: целиком не качается, кусок читается, когда он понадобился. */
const remote = (m, d) => m[d] && new NetDisk(new URL(`m/${m.id}/${d}`, import.meta.url).href, m[d].size, `${m.id}:${d}:${m[d].size}:${m[d].v || 0}`);

// ================= машина =================

let emu = null;
let ram = 128;
let statsTimer = null;
let fitTimer = null;

$("ram").value = String(store.get("ram") || 128);
$("ram").onchange = () => store.set("ram", Number($("ram").value));

$("boot").onclick = () => { preset = null; boot(null); };
$("resume").onclick = () => resumeFrom(null);
async function resumeFrom(m) {
  const key = stateKey(m);
  const meta = store.get(key);
  const f = meta && await opfsRead(stateFileName(key));
  if (!f) { store.del(key); renderSetup(); return toast("Сохранение не найдено на устройстве"); }
  preset = m;
  boot(await f.arrayBuffer(), meta.ram);
}
$("stateFile").addEventListener("change", async (e) => {
  const f = e.target.files[0];
  e.target.value = "";
  if (!f) return;
  if (!drives.hda && !drives.fd && !drives.cd) return toast("Сначала выберите те же образы дисков, с которыми делалось сохранение", 4000);
  preset = null;
  boot(await f.arrayBuffer(), Number($("ram").value));
});

function boot(state, stateRam) {
  ram = stateRam || Number($("ram").value);
  const img = (f) => f ? { buffer: f } : undefined;
  $("setup").classList.add("hidden");
  $("machine").classList.remove("hidden");
  $("status").textContent = state ? "Восстанавливаю машину…" : "Включаю…";
  WA?.BackButton.show();
  emu = new V86({
    // От адреса модуля, а не страницы: файлы лежат за пропуском (s/<пропуск>/).
    wasm_path: new URL("v86/v86.wasm", import.meta.url).href,
    bios: { url: new URL("v86/seabios.bin", import.meta.url).href },
    vga_bios: { url: new URL("v86/vgabios.bin", import.meta.url).href },
    memory_size: ram * MB,
    vga_memory_size: 8 * MB,
    screen: { container: $("screen") },
    hda: preset ? remote(preset, "hda") : img(drives.hda),
    cdrom: preset ? remote(preset, "cdrom") : img(drives.cd),
    fda: preset ? undefined : img(drives.fd),
    initial_state: state ? { buffer: state } : undefined,
    acpi: false,
    autostart: true,
  });
  emu.add_listener("emulator-started", () => { fit(); showHint(); keepSoundChoice(); });
  emu.add_listener("screen-set-size", () => requestAnimationFrame(fit));
  emu.add_listener("download-error", () => toast(preset ? "Не удалось загрузить диск с сервера — проверьте связь" : "Не удалось загрузить BIOS — проверьте связь", 4000));
  let last = 0, lastT = performance.now();
  statsTimer = setInterval(() => {
    renderSound();
    if (!emu?.is_running()) { $("status").textContent = "Пауза"; return; }
    const n = emu.get_instruction_counter(), t = performance.now();
    const mips = (n - last) / (t - lastT) / 1000;
    last = n; lastT = t;
    // Простаивающая система (ждёт нажатия) почти не исполняет команд — это не тормоза.
    if (mips >= 0 && mips < 1e5) $("status").textContent = `${ram} МБ · ${mips >= 1 ? `${mips.toFixed(0)} млн оп/с` : "ждёт ввода"}`;
  }, 1000);
  fitTimer = setInterval(fit, 500);
  updateMouseBtn();
}

async function powerOff() {
  if (!emu) return;
  if (!confirm("Выключить машину? Несохранённое пропадёт — сначала нажмите 💾, если хотите продолжить потом.")) return;
  shutdown();
}
function shutdown() {
  cdFromFiles = false;
  $("filesSheet").classList.add("hidden");
  clearInterval(statsTimer);
  clearInterval(fitTimer);
  try { emu?.destroy(); } catch { /* уже остановлен */ }
  emu = null;
  $("screen").innerHTML = '<div class="text"></div><canvas></canvas>';
  $("machine").classList.add("hidden");
  $("setup").classList.remove("hidden");
  WA?.BackButton.hide();
  renderSetup();
  storageInfo();
}
$("powerOff").onclick = powerOff;
WA?.BackButton.onClick(powerOff);

$("saveBtn").onclick = async () => {
  if (!emu) return;
  const key = stateKey();
  $("saveBtn").disabled = true;
  toast("Сохраняю машину…", 60000);
  try {
    const buf = await emu.save_state();
    let where = "на устройстве";
    try {
      await opfsWrite(stateFileName(key), buf);
      store.set(key, { at: Date.now(), ram, size: buf.byteLength });
    } catch {
      // Памяти устройства нет (или мало) — отдаём файлом.
      const a = document.createElement("a");
      a.href = URL.createObjectURL(new Blob([buf]));
      a.download = `${(preset?.id || drives.hda?.name || "machine").replace(/\.\w+$/, "")}.v86state`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 10000);
      where = "в файл (память устройства недоступна)";
    }
    toast(`Сохранено ${where}: ${fmtSize(buf.byteLength)}`);
    WA?.HapticFeedback.notificationOccurred("success");
  } catch (e) {
    toast(`Не удалось сохранить: ${e.message || e}`, 4000);
  }
  $("saveBtn").disabled = false;
  storageInfo();
};

// ================= звук =================
// v86 заводит звук (динамик и Sound Blaster 16) при включении машины, а браузер —
// особенно на iPhone — пускает его, только если его запустили прямо по касанию.
// Машину же часто включают после загрузки диска или снимка, уже не в касании, —
// и звук молчал. Будим его первым касанием или клавишей; 🔊/🔇 — выключить и
// включить (выбор запоминается). Чтобы звук не глушил переключатель «Без звука»
// на iPhone — сеанс звука «воспроизведение», где движок это умеет.
let soundOff = store.get("soundOff") === true;
const audioCtx = () => emu?.speaker_adapter?.audio_context || null;
try { if (navigator.audioSession) navigator.audioSession.type = "playback"; } catch { /* нет такого API */ }
function renderSound() {
  const c = audioCtx();
  const on = !!c && c.state === "running" && !soundOff;
  $("soundBtn").textContent = on ? "🔊" : "🔇";
  $("soundBtn").classList.toggle("on", on);
}
function wakeSound() {
  const c = audioCtx();
  if (!c || soundOff || c.state === "running") return;
  void c.resume().then(renderSound, () => {});
  // iPhone: короткий беззвучный звук внутри касания окончательно «открывает» звук.
  try {
    const s = c.createBufferSource();
    s.buffer = c.createBuffer(1, 1, 22050);
    s.connect(c.destination);
    s.start(0);
  } catch { /* не вышло — не страшно */ }
}
/** v86 сам включает звук при старте и после паузы — выключенный пусть молчит. */
function keepSoundChoice() {
  if (soundOff) void audioCtx()?.suspend();
  setTimeout(renderSound, 200);
}
for (const ev of ["touchend", "pointerup", "keydown"]) document.addEventListener(ev, wakeSound, true);
$("soundBtn").onclick = () => {
  soundOff = !soundOff;
  store.set("soundOff", soundOff);
  if (soundOff) void audioCtx()?.suspend(); else wakeSound();
  toast(soundOff ? "Звук выключен" : "Звук включён", 1500);
  setTimeout(renderSound, 200);
};

// ================= файлы в машину =================
// Файлы с устройства — CD-диском в привод работающей машины (private/iso.js):
// так в Windows 95/98 попадают установщики, драйверы, игры без сети и без
// пересборки образа диска. Вставляется на лету (emu.set_cdrom).

const ISO_MAX = 700 * MB;
/** В приводе уже диск из файлов (сбрасывается при выключении). */
let cdFromFiles = false;
let cdBusy = false;
const nFiles = (n) => `${n} ${n % 10 === 1 && n % 100 !== 11 ? "файл" : n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 12 || n % 100 > 14) ? "файла" : "файлов"}`;
// Выбор папки — где браузер его умеет (на iPhone нет).
if (!("webkitdirectory" in HTMLInputElement.prototype) || /iPhone|iPad|iPod/.test(navigator.userAgent)) $("putFolderBtn").classList.add("hidden");

async function putFiles(list) {
  if (!emu || !list.length || cdBusy) return;
  const total = list.reduce((n, f) => n + f.size, 0);
  if (total > ISO_MAX) return toast(`На диск влезает до ${fmtSize(ISO_MAX)} — выберите поменьше`, 4000);
  const hadCd = cdFromFiles || !!(preset ? preset.cdrom : drives.cd);
  if (hadCd && !cdFromFiles && !confirm("В приводе уже есть диск. Заменить его диском с этими файлами? Прежний вернётся, если выключить и снова включить машину.")) return;
  cdBusy = true;
  toast("Собираю диск…", 60000);
  try {
    const { buildIso } = await import("./iso.js");
    const iso = await buildIso(list.map((f) => ({ path: f.webkitRelativePath || f.name, file: f })), "WYX");
    await emu.set_cdrom({ buffer: iso });
    cdFromFiles = true;
    $("filesSheet").classList.add("hidden");
    toast(`Диск вставлен: ${nFiles(list.length)}, ${fmtSize(total)}. В Windows — «Мой компьютер» → CD-диск`, 5000);
    WA?.HapticFeedback.notificationOccurred("success");
  } catch (e) {
    toast(`Не удалось собрать диск: ${e.message || e}`, 4000);
  }
  cdBusy = false;
}
$("filesBtn").onclick = () => $("filesSheet").classList.remove("hidden");
$("filesClose").onclick = () => $("filesSheet").classList.add("hidden");
$("filesSheet").onclick = (e) => { if (e.target === $("filesSheet")) $("filesSheet").classList.add("hidden"); };
for (const id of ["putFiles", "putFolder"]) {
  $(id).onchange = (e) => { const l = [...e.target.files]; e.target.value = ""; void putFiles(l); };
}
// На компьютере — просто перетащить файлы на экран машины.
$("stage").addEventListener("dragover", (e) => { if (emu) e.preventDefault(); });
$("stage").addEventListener("drop", (e) => {
  if (!emu) return;
  e.preventDefault();
  void putFiles([...(e.dataTransfer?.files || [])]);
});

$("fullBtn").onclick = () => {
  const el = document.documentElement;
  if (document.fullscreenElement) document.exitFullscreen?.();
  else (el.requestFullscreen || el.webkitRequestFullscreen)?.call(el);
};

// Свернули приложение — машина спит, батарея цела.
document.addEventListener("visibilitychange", () => {
  if (!emu) return;
  if (document.hidden) emu.stop(); else emu.run();
});

// ================= экран =================

/** Где картинка машины лежит на сцене (после масштаба). */
let view = { x: 0, y: 0, w: 1, h: 1 };

function fit() {
  const stage = $("stage"), scr = $("screen");
  const canvas = scr.querySelector("canvas"), text = scr.querySelector(".text");
  const el = getComputedStyle(canvas).display !== "none" ? canvas : text;
  const w = el.offsetWidth, h = el.offsetHeight;
  if (!w || !h) return;
  const k = Math.min(stage.clientWidth / w, stage.clientHeight / h);
  const x = (stage.clientWidth - w * k) / 2, y = (stage.clientHeight - h * k) / 2;
  scr.style.transform = `translate(${x}px, ${y}px) scale(${k})`;
  view = { x, y, w: w * k, h: h * k };
}
window.addEventListener("resize", () => requestAnimationFrame(fit));

function showHint() {
  if (store.get("hinted")) return;
  store.set("hinted", 1);
  const h = $("hint");
  h.textContent = mouseMode === "abs"
    ? "Указатель: нажмите — клик там же, удержите — правая кнопка. Нужен драйвер VBMOUSE в Windows."
    : "Тачпад: водите пальцем — курсор едет, коснитесь — клик, двумя пальцами — правая кнопка. 🖱️ — сменить режим.";
  h.classList.remove("hidden");
  setTimeout(() => h.classList.add("hidden"), 7000);
}

// ================= мышь =================
// Свой слой поверх экрана: v86 сам умеет только мышь компьютера, а пальцем
// у него курсор двигается без кликов. Режимы:
//  abs — «указатель»: курсор встаёт под палец (в гостевой ОС нужен драйвер
//        абсолютной мыши VMware, например VBMOUSE);
//  rel — «тачпад»: работает с любым драйвером мыши.

let mouseMode = store.get("mouse") || "rel";
const buttons = [false, false, false];
const send = (name, data) => emu?.bus.send(name, data);
const setBtn = (i, down) => { buttons[i] = down; send("mouse-click", buttons.slice()); };
const clickBtn = (i) => { setBtn(i, true); setTimeout(() => setBtn(i, false), 60); };

function updateMouseBtn() {
  $("mouseBtn").textContent = mouseMode === "abs" ? "👆" : "🖱️";
  $("mouseBtn").title = mouseMode === "abs" ? "Указатель (нажмите — тачпад)" : "Тачпад (нажмите — указатель)";
  $("touch").style.cursor = mouseMode === "rel" ? "none" : "default";
}
$("mouseBtn").onclick = () => {
  mouseMode = mouseMode === "abs" ? "rel" : "abs";
  store.set("mouse", mouseMode);
  updateMouseBtn();
  toast(mouseMode === "abs" ? "Указатель: курсор встаёт под палец (нужен VBMOUSE)" : "Тачпад: водите пальцем, касание — клик");
};

function absTo(e) {
  const r = $("stage").getBoundingClientRect();
  const x = Math.max(0, Math.min(view.w, e.clientX - r.left - view.x));
  const y = Math.max(0, Math.min(view.h, e.clientY - r.top - view.y));
  send("mouse-absolute", [x, y, view.w, view.h]);
}

const touchLayer = $("touch");
const fingers = new Map();
let gesture = null; // {start, x, y, moved, drag, long, two, timer}
let lastTapAt = 0;

touchLayer.addEventListener("contextmenu", (e) => e.preventDefault());
touchLayer.addEventListener("wheel", (e) => { e.preventDefault(); send("mouse-wheel", [e.deltaY > 0 ? -1 : 1, 0]); }, { passive: false });

touchLayer.addEventListener("pointerdown", (e) => {
  touchLayer.setPointerCapture(e.pointerId);
  $("kbd").blur();
  if (e.pointerType === "mouse") {
    if (mouseMode === "abs") absTo(e);
    setBtn(e.button === 2 ? 2 : e.button === 1 ? 1 : 0, true);
    return;
  }
  fingers.set(e.pointerId, { x: e.clientX, y: e.clientY });
  if (fingers.size === 2 && gesture) { gesture.two = true; clearTimeout(gesture.timer); return; }
  if (fingers.size > 1) return;
  gesture = { start: performance.now(), x: e.clientX, y: e.clientY, moved: 0, drag: false, long: false, two: false };
  if (mouseMode === "abs") {
    absTo(e);
    // Удержание — правая кнопка, пока палец на экране (как «осмотреть» в играх).
    gesture.timer = setTimeout(() => { if (gesture && gesture.moved < 10) { gesture.long = true; setBtn(2, true); WA?.HapticFeedback.impactOccurred("light"); } }, 500);
  } else if (performance.now() - lastTapAt < 300) {
    // Касание и сразу ведение — перетаскивание с зажатой левой.
    gesture.drag = true;
    setBtn(0, true);
  }
});

touchLayer.addEventListener("pointermove", (e) => {
  if (e.pointerType === "mouse") {
    if (mouseMode === "abs") absTo(e);
    else send("mouse-delta", [e.movementX, -e.movementY]);
    return;
  }
  const f = fingers.get(e.pointerId);
  if (!f || !gesture) return;
  const dx = e.clientX - f.x, dy = e.clientY - f.y;
  f.x = e.clientX; f.y = e.clientY;
  gesture.moved = Math.max(gesture.moved, Math.hypot(e.clientX - gesture.x, e.clientY - gesture.y));
  if (gesture.two) return;
  if (mouseMode === "abs") {
    absTo(e);
    if (gesture.moved >= 10 && !gesture.drag && !gesture.long) {
      clearTimeout(gesture.timer);
      gesture.drag = true;
      setBtn(0, true);
    }
  } else {
    // Курсор идёт за пальцем с учётом масштаба экрана; быстрый жест — дальше.
    const canvas = $("screen").querySelector("canvas");
    const base = canvas.offsetWidth && view.w ? canvas.offsetWidth / view.w : 1;
    const k = base * (0.8 + Math.min(1.2, Math.hypot(dx, dy) / 25));
    send("mouse-delta", [dx * k, -dy * k]);
  }
});

function endPointer(e) {
  if (e.pointerType === "mouse") {
    setBtn(e.button === 2 ? 2 : e.button === 1 ? 1 : 0, false);
    return;
  }
  fingers.delete(e.pointerId);
  if (!gesture || fingers.size) return;
  const g = gesture;
  gesture = null;
  clearTimeout(g.timer);
  if (g.two) { if (g.moved < 15) clickBtn(2); return; }
  if (g.long) { setBtn(2, false); return; }
  if (g.drag) { setBtn(0, false); return; }
  if (g.moved < 10 && performance.now() - g.start < 400) {
    clickBtn(0);
    lastTapAt = performance.now();
  }
}
touchLayer.addEventListener("pointerup", endPointer);
touchLayer.addEventListener("pointercancel", endPointer);

// ================= клавиатура =================
// Скан-коды набора 1 (PS/2). Отпускание — код | 0x80; у расширенных клавиш префикс 0xE0.

const SC = {
  esc: [0x01], tab: [0x0f], enter: [0x1c], space: [0x39], bksp: [0x0e],
  left: [0xe0, 0x4b], up: [0xe0, 0x48], down: [0xe0, 0x50], right: [0xe0, 0x4d], del: [0xe0, 0x53],
  f1: [0x3b], f2: [0x3c], f3: [0x3d], f4: [0x3e], f5: [0x3f], f6: [0x40], f7: [0x41], f8: [0x42], f9: [0x43], f10: [0x44], f11: [0x57], f12: [0x58],
};
const MOD = { ctrl: [0x1d], alt: [0x38], shift: [0x2a] };
const release = (code) => code.length === 2 ? [0xe0, code[1] | 0x80] : [code[0] | 0x80];
const mods = new Set();

function tapKey(k) {
  if (!emu) return;
  const held = [...mods];
  const codes = [...held.flatMap((m) => MOD[m]), ...SC[k], ...release(SC[k]), ...held.reverse().flatMap((m) => release(MOD[m]))];
  emu.keyboard_send_scancodes(codes);
  mods.clear();
  for (const b of document.querySelectorAll("[data-mod]")) b.classList.remove("on");
  WA?.HapticFeedback.selectionChanged();
}

for (const b of document.querySelectorAll("[data-k]")) {
  b.addEventListener("click", () => {
    if (b.dataset.k === "cad") emu?.keyboard_send_scancodes([0x1d, 0x38, 0xe0, 0x53, 0xe0, 0xd3, 0xb8, 0x9d]);
    else tapKey(b.dataset.k);
  });
}
for (const b of document.querySelectorAll("[data-mod]")) {
  b.addEventListener("click", () => {
    const m = b.dataset.mod;
    if (mods.has(m)) mods.delete(m); else mods.add(m);
    b.classList.toggle("on", mods.has(m));
  });
}

// Системная клавиатура телефона: скрытое поле, набранное уходит в машину текстом.
const kbd = $("kbd");
const SENTINEL = " ";
kbd.value = SENTINEL;
kbd.addEventListener("beforeinput", (e) => {
  e.preventDefault();
  if (!emu) return;
  if (e.inputType === "insertText" && e.data) emu.keyboard_send_text(e.data);
  else if (e.inputType === "deleteContentBackward") tapKey("bksp");
  else if (e.inputType === "insertLineBreak") tapKey("enter");
});
kbd.addEventListener("keydown", (e) => {
  if (e.key === "Enter") { e.preventDefault(); tapKey("enter"); }
  else if (e.key === "Escape") { e.preventDefault(); tapKey("esc"); kbd.blur(); }
});

$("kbdBtn").onclick = () => {
  const keys = $("keys");
  if (document.activeElement === kbd) { kbd.blur(); return; }
  if (keys.classList.contains("hidden")) { keys.classList.remove("hidden"); requestAnimationFrame(fit); return; }
  // Второе нажатие — системная клавиатура для набора текста.
  kbd.value = SENTINEL;
  kbd.focus();
};
// На компьютере с клавиатурой панель клавиш не нужна по умолчанию.
if (matchMedia("(pointer: fine)").matches) $("keys").classList.add("hidden");

// ================= старт =================

renderSetup();
loadRemembered();
loadMachines();
storageInfo();
if (noOpfs) {
  $("remember").checked = false;
  $("storageInfo").textContent = "Этот браузер не даёт памяти для дисков и сохранений — сохранения будут скачиваться файлом.";
}

// Отладка вне WYX: доступ к машине из консоли и автотестов.
if (!WA?.initData) window.retro = { get emu() { return emu; }, drives, boot, tapKey };
