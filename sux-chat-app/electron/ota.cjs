// Обновление веб-части по воздуху для компьютера — то же, что на телефонах
// (src/lib/ota.ts), но в main-процессе: схема app:// отдаёт файлы не из
// встроенного dist/, а из скачанного бандла.
//
// Манифест и архив — те же, что для телефонов (scripts/ota-publish.py):
// hyax-public/ota/manifest.json → zip с dist. Скачали и сверили sha256 —
// распаковываем в <userData>/ota/<сборка>-<sha8>/ и ставим «ждёт запуска».
// Применяем при следующем запуске — или на лету (applyNow), когда интерфейс
// решит, что момент безопасный (окно свёрнуто или давно без касаний, нет
// звонка, записи, музыки — src/lib/ota.ts), или по кнопке «Обновить сейчас».
//
// Откат: новый бандл должен сказать «жив» (ota-ready — после первой отрисовки
// интерфейса) за 20 с; не сказал или программа упала до этого — при следующем
// запуске (или сразу, по таймеру) возвращаемся к прежнему, а версию запоминаем
// как сломанную. Новый установщик (другая встроенная сборка) сбрасывает всё
// на встроенный бандл.
const { app, net } = require('electron');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const zlib = require('zlib');

const BASE = 'https://storage.yandexcloud.net/hyax-public/ota/';
const CHECK_FIRST_MS = 15 * 1000;
const CHECK_EVERY_MS = 30 * 60 * 1000;
const READY_TIMEOUT_MS = 20 * 1000;

let DIST = '';
let ROOT = '';
let log = () => {};
let builtin = { version: '', build: 0 };
let state = null;
let readyTimer = null;

const stateFile = () => path.join(ROOT, 'state.json');
const readJson = (f) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return null; } };
const save = () => { try { fs.mkdirSync(ROOT, { recursive: true }); fs.writeFileSync(stateFile(), JSON.stringify(state, null, 1)); } catch (e) { log('ota: не сохранил состояние', e); } };
const okDir = (b) => !!(b && b.dir && fs.existsSync(path.join(b.dir, 'index.html')));

/** Каталог, из которого app:// отдаёт файлы сейчас. */
function root() {
  return okDir(state && state.current) ? state.current.dir : DIST;
}

/** Встроенная версия и сборка — из dist/build.json (пишет vite, см. vite.config.ts). */
function builtinInfo() {
  const b = readJson(path.join(DIST, 'build.json')) || {};
  return { version: String(b.version || app.getVersion()), build: Number(b.build) || 0 };
}

/** Убрать распакованные бандлы, которые уже не нужны. */
function prune() {
  const keep = new Set([state.current, state.previous, state.pending].filter(Boolean).map((b) => b.dir));
  try {
    for (const name of fs.readdirSync(ROOT)) {
      const full = path.join(ROOT, name);
      if (name !== 'state.json' && !keep.has(full)) fs.rmSync(full, { recursive: true, force: true });
    }
  } catch {}
}

/** При старте: новый установщик — сброс; прошлый запуск не подтвердил бандл —
 *  откат; скачан новый — переключиться на него. */
function init(opts) {
  DIST = opts.dist;
  log = opts.log || log;
  ROOT = path.join(app.getPath('userData'), 'ota');
  builtin = builtinInfo();
  state = readJson(stateFile()) || {};
  if (state.builtin !== builtin.build) {
    if (state.current) log('ota: новый установщик — встроенный бандл', builtin);
    state = { builtin: builtin.build, current: null, previous: null, pending: null, trial: false, failed: [] };
  }
  state.failed = Array.isArray(state.failed) ? state.failed : [];
  if (state.trial && state.current) {
    log('ota: бандл не подтвердил запуск — откат', state.current.version);
    fail();
  } else if (state.pending && okDir(state.pending)) {
    state.previous = state.current;
    state.current = state.pending.builtin ? null : state.pending;
    state.pending = null;
    state.trial = !!state.current;
    log('ota: переключился на', state.current ? state.current.version : 'встроенный');
  } else {
    state.pending = null;
  }
  save();
  prune();
}

/** Текущий бандл сломан: вернуться к прежнему и больше его не ставить. */
function fail() {
  if (state.current) state.failed = [...state.failed.filter((v) => v !== state.current.version), state.current.version].slice(-10);
  state.current = okDir(state.previous) ? state.previous : null;
  state.previous = null;
  state.trial = false;
  save();
}

/** Окно загрузило интерфейс — ждём «жив»; не дождались — откат и перезагрузка. */
function watch(win) {
  if (!state.trial) return;
  clearTimeout(readyTimer);
  readyTimer = setTimeout(() => {
    if (!state.trial) return;
    log('ota: нет подтверждения за 20 с — откат', state.current && state.current.version);
    fail();
    if (win && !win.isDestroyed()) win.reload();
  }, READY_TIMEOUT_MS);
}

/** Интерфейс отрисовался (renderer, событие hyax:ready). */
function ready() {
  if (!state.trial) return;
  state.trial = false;
  state.previous = null;
  clearTimeout(readyTimer);
  save();
  prune();
  log('ota: работает', state.current && state.current.version);
}

/** Распаковка zip из нашего же скрипта (stored/deflate, без zip64). */
function unzip(buf, dir) {
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65557); i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('не zip');
  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  for (let n = 0; n < count; n++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) throw new Error('битый каталог zip');
    const method = buf.readUInt16LE(p + 10);
    const csize = buf.readUInt32LE(p + 20);
    const nlen = buf.readUInt16LE(p + 28), xlen = buf.readUInt16LE(p + 30), clen = buf.readUInt16LE(p + 32);
    const local = buf.readUInt32LE(p + 42);
    const name = buf.slice(p + 46, p + 46 + nlen).toString('utf8');
    p += 46 + nlen + xlen + clen;
    const target = path.resolve(dir, name);
    if (!target.startsWith(path.resolve(dir) + path.sep)) throw new Error('путь вне каталога: ' + name);
    if (name.endsWith('/')) { fs.mkdirSync(target, { recursive: true }); continue; }
    const start = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28);
    const raw = buf.slice(start, start + csize);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, method === 8 ? zlib.inflateRawSync(raw) : method === 0 ? raw : (() => { throw new Error('сжатие ' + method); })());
  }
}

let checking = false;

/** Есть ли новый бандл — скачать и поставить «ждёт запуска». */
async function check() {
  if (checking) return;
  checking = true;
  try {
    const res = await net.fetch(`${BASE}manifest.json?t=${Date.now()}`, { cache: 'no-store' });
    if (!res.ok) return;
    const m = await res.json();
    if (!m || typeof m.version !== 'string' || typeof m.build !== 'number' || typeof m.url !== 'string'
        || !m.url.startsWith(BASE) || !/^[0-9a-f]{64}$/.test(m.sha256 || '')) return;
    const cur = state.current;
    if ((cur ? cur.version : `${builtin.version}-${builtin.build}`) === m.version) return;
    if (state.failed.includes(m.version)) return;
    if ((m.min_native && m.min_native.desktop || 0) > builtin.build) { log('ota: бандлу нужна сборка', m.min_native.desktop); return; }
    if (m.build <= builtin.build) {
      // Манифест откатили на встроенный (или установщик новее) — вернуться к нему.
      if (cur && cur.build > m.build && !(state.pending && state.pending.builtin)) {
        state.pending = { builtin: true, version: `${builtin.version}-${builtin.build}`, build: builtin.build, dir: DIST };
        save();
        log('ota: при следующем запуске — встроенный бандл');
      }
      return;
    }
    if (state.pending && state.pending.version === m.version) return;
    const zipRes = await net.fetch(m.url);
    if (!zipRes.ok) return;
    const buf = Buffer.from(await zipRes.arrayBuffer());
    if (crypto.createHash('sha256').update(buf).digest('hex') !== m.sha256) { log('ota: не сошлась sha256', m.version); return; }
    const dir = path.join(ROOT, `${m.build}-${m.sha256.slice(0, 8)}`);
    fs.rmSync(dir, { recursive: true, force: true });
    unzip(buf, dir);
    if (!fs.existsSync(path.join(dir, 'index.html'))) { fs.rmSync(dir, { recursive: true, force: true }); return; }
    state.pending = { version: m.version, build: m.build, dir };
    save();
    prune();
    log('ota: скачан', m.version, '— применится при следующем запуске');
  } catch (e) {
    log('ota: проверка не удалась', e);
  } finally {
    checking = false;
  }
}

function startChecks() {
  setTimeout(() => void check(), CHECK_FIRST_MS);
  setInterval(() => void check(), CHECK_EVERY_MS);
}

/** Применить скачанный бандл сейчас, без перезапуска программы: окно
 *  перезагружается и app:// отдаёт уже его; «жив» — как при запуске. Когда
 *  это безопасно (нет звонка, записи, музыки), решает интерфейс (src/lib/ota.ts). */
function applyNow(win) {
  if (!state || !state.pending || !okDir(state.pending)) return false;
  state.previous = state.current;
  state.current = state.pending.builtin ? null : state.pending;
  state.pending = null;
  state.trial = !!state.current;
  save();
  log('ota: применён на лету', state.current ? state.current.version : 'встроенный');
  if (win && !win.isDestroyed()) { win.reload(); watch(win); }
  return true;
}

/** Для профиля и плашки обновления: работает ли бандл по воздуху, ждёт ли
 *  новый и какой встроенный. */
function info() {
  return { ota: !!(state && okDir(state.current)), version: state && state.current ? state.current.version : null,
           pending: !!(state && state.pending && okDir(state.pending)),
           builtinVersion: builtin.version, builtinBuild: builtin.build };
}

module.exports = { init, root, watch, ready, startChecks, info, check, applyNow };
