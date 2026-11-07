// Машины: QEMU/KVM с Windows 98. У каждого игрока свой диск-наложение (qcow2 поверх
// общего образа), машины одной комнаты объединены мультикаст-сетью QEMU — это
// локальная сеть без прав root. Экран — VNC на unix-сокете, ввод — через QMP
// (input-send-event): PS/2-мышь относительная, поэтому положение курсора
// считаем сами и ведём его шагами ≤100 px (ускорение указателя в образе выключено,
// шаг идёт 1:1; больше 127 за одно событие PS/2 не передаёт).

import { spawn, execFile } from "node:child_process";
import { createConnection } from "node:net";
import { mkdir, stat, rm, readFile } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";

const execFileP = promisify(execFile);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export const SCREEN = { w: 1280, h: 1024 }; // разрешение рабочего стола в образе
// Шаг курсора за одно событие. Windows 98 удваивает сдвиг больше порога, если ускорение
// включено; в образе оно выключено, но шаг держим умеренным (MOUSE_STEP), пауза — чтобы
// каждое событие ушло отдельным пакетом PS/2.
const STEP = Number(process.env.MOUSE_STEP || 50);
const PAUSE = Number(process.env.MOUSE_PAUSE || 25); // мс между событиями: быстрее — Windows склеивает два пакета в один и удваивает

// ---------- QMP ----------
class Qmp {
  constructor(path) { this.path = path; this.buf = ""; this.waiters = []; this.events = []; }
  connect() {
    return new Promise((resolve, reject) => {
      const s = createConnection(this.path);
      this.sock = s;
      let greeted = false;
      s.setEncoding("utf8");
      s.on("data", (d) => {
        this.buf += d;
        let i;
        while ((i = this.buf.indexOf("\n")) >= 0) {
          const line = this.buf.slice(0, i); this.buf = this.buf.slice(i + 1);
          if (!line.trim()) continue;
          let m; try { m = JSON.parse(line); } catch { continue; }
          if (m.QMP && !greeted) { greeted = true; this.cmd("qmp_capabilities").then(() => resolve(), reject); continue; }
          if (m.event) { this.events.push(m); continue; }
          const w = this.waiters.shift();
          if (w) ("error" in m ? w.reject(new Error(m.error.desc)) : w.resolve(m.return));
        }
      });
      s.on("error", reject);
      s.on("close", () => { for (const w of this.waiters.splice(0)) w.reject(new Error("qmp closed")); });
    });
  }
  cmd(execute, args) {
    return new Promise((resolve, reject) => {
      this.waiters.push({ resolve, reject });
      this.sock.write(JSON.stringify(args ? { execute, arguments: args } : { execute }) + "\n");
    });
  }
  close() { this.sock?.destroy(); }
}

// ---------- машина ----------
export class Vm {
  /**
   * @param {object} o
   * @param {string} o.id        — кому принадлежит (id пользователя)
   * @param {string} o.dataDir   — DATA_DIR: base/, disks/, run/
   * @param {string} o.base      — путь к общему raw-образу
   * @param {string} [o.cdrom]   — ISO в приводе
   * @param {number} o.mcast     — порт мультикаст-сети комнаты (230.0.0.1:port)
   * @param {number} o.ram       — МБ
   * @param {(line:string)=>void} [o.log]
   */
  constructor(o) {
    Object.assign(this, { ram: 128, log: () => {} }, o);
    this.disk = join(this.dataDir, "disks", `${this.id}.qcow2`);
    this.vnc = join(this.dataDir, "run", `vnc-${this.id}.sock`);
    this.qmpPath = join(this.dataDir, "run", `qmp-${this.id}.sock`);
    this.cursor = { x: 0, y: 0, synced: false };
    this.size = { ...SCREEN }; // уточняется по кадру: Windows может сменить разрешение
    this.queue = Promise.resolve(); // ввод — строго по очереди
    this.mac = "52:54:00:" + [2, 1, 0].map((i) => ((Number(this.id) >> (8 * i)) & 255).toString(16).padStart(2, "0")).join(":");
  }

  async ensureDisk() {
    await mkdir(join(this.dataDir, "disks"), { recursive: true });
    await mkdir(join(this.dataDir, "run"), { recursive: true });
    try { await stat(this.disk); return false; } catch { /* нет — создаём */ }
    await execFileP("qemu-img", ["create", "-q", "-f", "qcow2", "-b", this.base, "-F", "raw", this.disk]);
    return true;
  }

  /** Есть ли снимок «idle» (машина усыплена, можно продолжить мгновенно). */
  async hasSnapshot(name = "idle") {
    try {
      const { stdout } = await execFileP("qemu-img", ["snapshot", "-l", this.disk]);
      return stdout.split("\n").some((l) => l.trim().split(/\s+/)[1] === name);
    } catch { return false; }
  }

  async start() {
    if (this.proc) return;
    await this.ensureDisk();
    await rm(this.vnc, { force: true }); await rm(this.qmpPath, { force: true });
    const resume = await this.hasSnapshot();
    const args = [
      "-enable-kvm", "-m", String(this.ram), "-M", "pc,acpi=off,hpet=off", "-cpu", "pentium2",
      "-drive", `file=${this.disk},format=qcow2,if=ide,index=0`,
      ...(this.cdrom ? ["-cdrom", this.cdrom] : []),
      "-audiodev", "none,id=a0", "-device", "sb16,audiodev=a0",
      "-vga", "std", "-rtc", "base=localtime",
      "-netdev", `socket,id=n0,mcast=230.0.0.1:${this.mcast}`, "-device", `ne2k_pci,netdev=n0,mac=${this.mac}`,
      "-display", "none", "-vnc", `unix:${this.vnc}`,
      "-qmp", `unix:${this.qmpPath},server,nowait`,
      ...(resume ? ["-loadvm", "idle"] : []),
    ];
    this.log(`qemu ${resume ? "(продолжаю со снимка)" : "(холодный старт)"} сеть 230.0.0.1:${this.mcast}`);
    this.proc = spawn("qemu-system-i386", args, { stdio: ["ignore", "pipe", "pipe"] });
    this.proc.stderr.on("data", (d) => this.log(`qemu: ${String(d).trim()}`));
    this.exited = new Promise((r) => this.proc.on("exit", (code) => { this.log(`qemu вышел (${code})`); this.proc = null; this.qmp = null; r(code); }));
    for (let i = 0; i < 100; i++) {
      await sleep(100);
      try { await stat(this.qmpPath); break; } catch { if (!this.proc) throw new Error("qemu не запустился"); }
    }
    this.qmp = new Qmp(this.qmpPath);
    await this.qmp.connect();
    this.cursor.synced = false;
    if (resume) { try { await this.qmp.cmd("delvm", { tag: "idle" }); } catch { /* старые QEMU: нет delvm */ } }
  }

  /** Windows уже выключена изнутри («It's now safe to turn off»)? Тогда снимок бессмыслен:
   *  такие экраны — текстовый режим или одноцветная заливка, цветов совсем мало. */
  async looksShutDown() {
    const file = join(this.dataDir, "run", `size-${this.id}.ppm`);
    try {
      await this.qmp.cmd("screendump", { filename: file });
      const buf = await readFile(file);
      const m = /^P6\s+(\d+)\s+(\d+)\s+255\s/.exec(buf.subarray(0, 40).toString("latin1"));
      if (!m) return false;
      const off = m[0].length, colors = new Set();
      for (let i = off; i < buf.length && colors.size < 6; i += 3 * 97) colors.add((buf[i] << 16) | (buf[i + 1] << 8) | buf[i + 2]);
      return colors.size < 6;
    } catch { return false; }
  }

  /** Усыпить: снимок в диск и выход. Следующий start() продолжит с этого места. */
  async sleepAndQuit() {
    if (!this.proc) return;
    if (await this.looksShutDown()) { this.log("Windows выключена изнутри — без снимка"); return this.quit(true); }
    try {
      await this.qmp.cmd("stop");
      await this.qmp.cmd("human-monitor-command", { "command-line": "savevm idle" });
      this.log("снимок idle сохранён");
    } catch (e) { this.log(`снимок не удался: ${e.message}`); }
    await this.quit();
  }

  async quit(dropSnapshot = false) {
    if (!this.proc) return;
    try { await this.qmp.cmd("quit"); } catch { /* уже закрыт */ }
    const t = setTimeout(() => this.proc?.kill("SIGKILL"), 5000);
    await this.exited; clearTimeout(t);
    if (dropSnapshot) { try { await execFileP("qemu-img", ["snapshot", "-d", "idle", this.disk]); } catch { /* снимка не было */ } }
  }

  /** Текущий размер экрана машины — по заголовку кадра (screendump → PPM). */
  async probeSize() {
    const file = join(this.dataDir, "run", `size-${this.id}.ppm`);
    try {
      await this.qmp.cmd("screendump", { filename: file });
      const head = (await readFile(file)).subarray(0, 40).toString("latin1");
      const m = /^P6\s+(\d+)\s+(\d+)/.exec(head);
      if (m) this.size = { w: Number(m[1]), h: Number(m[2]) };
    } catch { /* оставим прежний */ }
    return this.size;
  }

  // ---------- ввод ----------
  run(fn) { return (this.queue = this.queue.then(fn, fn)); }
  ev(events) { return this.qmp.cmd("input-send-event", { events }); }
  async rel(dx, dy) {
    await this.ev([{ type: "rel", data: { axis: "x", value: dx } }, { type: "rel", data: { axis: "y", value: dy } }]);
    this.cursor.x = Math.max(0, Math.min(this.size.w - 1, this.cursor.x + dx));
    this.cursor.y = Math.max(0, Math.min(this.size.h - 1, this.cursor.y + dy));
  }
  /** Курсор в левый верхний угол: Windows упирается в край, положение становится известным. */
  async park() {
    for (let i = 0; i < 12; i++) { await this.ev([{ type: "rel", data: { axis: "x", value: -127 } }, { type: "rel", data: { axis: "y", value: -127 } }]); await sleep(PAUSE); }
    this.cursor = { x: 0, y: 0, synced: true };
  }
  /** Подвести курсор в точку экрана шагами (каждое событие — один пакет PS/2). */
  async moveTo(x, y) {
    x = Math.max(0, Math.min(this.size.w - 1, Math.round(x))); y = Math.max(0, Math.min(this.size.h - 1, Math.round(y)));
    if (!this.cursor.synced) await this.park();
    let guard = 0;
    while ((this.cursor.x !== x || this.cursor.y !== y) && guard++ < 200) {
      const dx = Math.max(-STEP, Math.min(STEP, x - this.cursor.x)), dy = Math.max(-STEP, Math.min(STEP, y - this.cursor.y));
      await this.rel(dx, dy);
      await sleep(PAUSE);
    }
  }
  /** Сдвиг (режим «тачпад»). Большие рывки режем на куски. */
  async moveBy(dx, dy) {
    dx = Math.round(dx); dy = Math.round(dy);
    while (dx || dy) {
      const sx = Math.max(-STEP, Math.min(STEP, dx)), sy = Math.max(-STEP, Math.min(STEP, dy));
      await this.rel(sx, sy); dx -= sx; dy -= sy;
      if (dx || dy) await sleep(PAUSE);
    }
  }
  button(name, down) { return this.ev([{ type: "btn", data: { button: name, down } }]); }
  async click(name = "left", times = 1) {
    for (let i = 0; i < times; i++) {
      await this.button(name, true); await sleep(40); await this.button(name, false);
      if (i < times - 1) await sleep(80);
    }
  }
  key(qcode, down) { return this.ev([{ type: "key", data: { down, key: { type: "qcode", data: qcode } } }]); }
  /** Нажать сочетание: "ctrl-alt-delete", "shift-a", "ret". */
  async tap(combo) {
    const ks = combo.split("-").filter(Boolean);
    for (const k of ks) { await this.key(k, true); await sleep(15); }
    for (const k of ks.reverse()) { await this.key(k, false); await sleep(15); }
  }
  async type(text) {
    for (const ch of text) {
      const q = charToQcode(ch);
      if (q) { await this.tap(q); await sleep(20); }
    }
  }
}

const CHARS = {
  " ": "spc", ".": "dot", ",": "comma", ";": "semicolon", ":": "shift-semicolon", "'": "apostrophe", '"': "shift-apostrophe",
  "\\": "backslash", "|": "shift-backslash", "/": "slash", "?": "shift-slash", "-": "minus", "_": "shift-minus", "=": "equal", "+": "shift-equal",
  "[": "bracket_left", "{": "shift-bracket_left", "]": "bracket_right", "}": "shift-bracket_right", "`": "grave_accent", "~": "shift-grave_accent",
  "!": "shift-1", "@": "shift-2", "#": "shift-3", "$": "shift-4", "%": "shift-5", "^": "shift-6", "&": "shift-7", "*": "shift-8", "(": "shift-9", ")": "shift-0",
  "<": "shift-comma", ">": "shift-dot", "\n": "ret", "\t": "tab", "\b": "backspace",
};
export function charToQcode(ch) {
  if (CHARS[ch]) return CHARS[ch];
  if (/^[a-z0-9]$/.test(ch)) return ch;
  if (/^[A-Z]$/.test(ch)) return "shift-" + ch.toLowerCase();
  return null; // кириллица и прочее: в английской Windows 98 набрать нечем
}

// Имена клавиш с экранной панели клиента → qcode QEMU.
export const KEYS = {
  esc: "esc", tab: "tab", enter: "ret", space: "spc", bksp: "backspace", del: "delete",
  left: "left", up: "up", down: "down", right: "right", home: "home", end: "end", pgup: "pgup", pgdn: "pgdn", ins: "insert",
  f1: "f1", f2: "f2", f3: "f3", f4: "f4", f5: "f5", f6: "f6", f7: "f7", f8: "f8", f9: "f9", f10: "f10", f11: "f11", f12: "f12",
  ctrl: "ctrl", alt: "alt", shift: "shift", win: "meta_l", cad: "ctrl-alt-delete",
};
