// Образ CD (ISO 9660 + Joliet) из файлов с устройства — «📁 Файлы в машину»:
// собираем в памяти браузера и вставляем в CD-привод работающей машины
// (emu.set_cdrom). Windows 95/98 читает Joliet — видны длинные и русские
// имена и папки; DOS — короткие имена ISO 9660 (8.3). На сервер ничего не уходит.
//
// buildIso([{ path: "папка/файл.exe", file: Blob }], "МЕТКА") → ArrayBuffer.

const SECTOR = 2048;
const enc = new TextEncoder();

function both16(v, o, n) { v.setUint16(o, n, true); v.setUint16(o + 2, n, false); }
function both32(v, o, n) { v.setUint32(o, n, true); v.setUint32(o + 4, n, false); }

/** Дата для записи каталога (7 байт). */
function dirDate(u8, o, d) {
  u8[o] = d.getUTCFullYear() - 1900; u8[o + 1] = d.getUTCMonth() + 1; u8[o + 2] = d.getUTCDate();
  u8[o + 3] = d.getUTCHours(); u8[o + 4] = d.getUTCMinutes(); u8[o + 5] = d.getUTCSeconds(); u8[o + 6] = 0;
}
/** Дата для дескриптора тома (17 байт: «ГГГГММДДЧЧММССсс» + пояс). */
function volDate(u8, o, d) {
  const p = (n, w = 2) => String(n).padStart(w, "0");
  const s = d ? `${p(d.getUTCFullYear(), 4)}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}${p(d.getUTCHours())}${p(d.getUTCMinutes())}${p(d.getUTCSeconds())}00` : "0000000000000000";
  u8.set(enc.encode(s), o); u8[o + 16] = 0;
}
function ascii(u8, o, len, s) { const b = enc.encode(s.slice(0, len)); u8.fill(0x20, o, o + len); u8.set(b, o); }
function ucs2(s) { const b = new Uint8Array(s.length * 2); for (let i = 0; i < s.length; i++) { b[i * 2] = s.charCodeAt(i) >> 8; b[i * 2 + 1] = s.charCodeAt(i) & 0xff; } return b; }
function ucs2Field(u8, o, len, s) { for (let i = 0; i < len; i += 2) { u8[o + i] = 0; u8[o + i + 1] = 0x20; } u8.set(ucs2(s.slice(0, len / 2)), o); }

// ---- Имена ----

const D_CHARS = /[^A-Z0-9_]/g;
/** Короткое имя ISO 9660 уровня 1 (8.3), уникальное в каталоге. */
function isoName(name, isDir, taken) {
  const dot = isDir ? -1 : name.lastIndexOf(".");
  let base = (dot > 0 ? name.slice(0, dot) : name).toUpperCase().replace(D_CHARS, "_") || "_";
  const ext = dot > 0 ? name.slice(dot + 1).toUpperCase().replace(D_CHARS, "_").slice(0, 3) : "";
  const make = (b) => (isDir ? b : `${b}${ext ? "." + ext : "."};1`);
  let id = make(base.slice(0, 8));
  for (let n = 1; taken.has(id); n++) { const t = `~${n}`; id = make(base.slice(0, 8 - t.length) + t); }
  taken.add(id);
  return id;
}
/** Имя Joliet: до 64 знаков, без запрещённых, уникальное (без учёта регистра). */
function jolietName(name, isDir, taken) {
  let n = name.replace(/[*/:;?\\\x00-\x1f]/g, "_") || "_";
  if (n.length > 64) {
    const dot = isDir ? -1 : n.lastIndexOf(".");
    const ext = dot > 0 && n.length - dot <= 10 ? n.slice(dot) : "";
    n = n.slice(0, 64 - ext.length) + ext;
  }
  let id = n;
  for (let k = 1; taken.has(id.toLowerCase()); k++) {
    const dot = isDir ? -1 : n.lastIndexOf(".");
    const sfx = ` (${k})`;
    id = dot > 0 ? n.slice(0, Math.min(dot, 64 - sfx.length - (n.length - dot))) + sfx + n.slice(dot) : n.slice(0, 64 - sfx.length) + sfx;
  }
  taken.add(id.toLowerCase());
  return id;
}

// ---- Дерево ----

function tree(entries) {
  const root = { name: "", dirs: new Map(), files: [], parent: null };
  for (const e of entries) {
    const parts = e.path.split("/").filter(Boolean);
    let d = root;
    for (const part of parts.slice(0, -1)) {
      if (!d.dirs.has(part)) d.dirs.set(part, { name: part, dirs: new Map(), files: [], parent: d });
      d = d.dirs.get(part);
    }
    d.files.push({ name: parts[parts.length - 1] || "file", file: e.file, size: e.file.size, lba: 0 });
  }
  return root;
}

/** Каталоги иерархии по уровням (как в таблице путей); у каждого — его записи. */
function hierarchy(root, joliet) {
  const all = [];
  const walk = (d, level) => { all.push({ d, level }); for (const c of d.dirs.values()) walk(c, level + 1); };
  walk(root, 1);
  // Имена записей — по каталогам.
  const ids = new Map();   // объект (каталог/файл) → имя в этой иерархии
  for (const { d } of all) {
    const taken = new Set();
    for (const c of d.dirs.values()) ids.set(c, joliet ? jolietName(c.name, true, taken) : isoName(c.name, true, taken));
    for (const f of d.files) ids.set(f, joliet ? jolietName(f.name, false, taken) + ";1" : isoName(f.name, false, taken));
  }
  ids.set(root, "");
  // Порядок таблицы путей: уровень, номер родителя, имя.
  const order = [];
  const num = new Map();
  for (let level = 1; ; level++) {
    const row = all.filter((x) => x.level === level).map((x) => x.d);
    if (!row.length) break;
    row.sort((a, b) => (a.parent ? num.get(a.parent) : 0) - (b.parent ? num.get(b.parent) : 0) || (ids.get(a) < ids.get(b) ? -1 : ids.get(a) > ids.get(b) ? 1 : 0));
    for (const d of row) { order.push(d); num.set(d, order.length); }
  }
  const idBytes = (x) => (joliet ? ucs2(ids.get(x)) : enc.encode(ids.get(x)));
  // Записи каталога: «.», «..», затем подкаталоги и файлы по имени.
  const recs = new Map();
  for (const d of order) {
    const kids = [...d.dirs.values(), ...d.files].sort((a, b) => (ids.get(a) < ids.get(b) ? -1 : ids.get(a) > ids.get(b) ? 1 : 0));
    let used = 0, sectors = 1;
    const list = [{ self: d, id: new Uint8Array([0]) }, { self: d.parent || d, id: new Uint8Array([1]) }, ...kids.map((k) => ({ self: k, id: idBytes(k) }))];
    for (const r of list) {
      const len = 33 + r.id.length + (r.id.length % 2 === 0 ? 1 : 0);
      if (used + len > SECTOR) { sectors++; used = 0; }
      used += len;
    }
    recs.set(d, { list, sectors });
  }
  const ptSize = order.reduce((n, d) => { const l = Math.max(1, idBytes(d).length); return n + 8 + l + (l % 2); }, 0);
  return { order, num, ids, recs, idBytes, ptSize };
}

/** Собрать образ. entries: [{ path, file: Blob }]. */
export async function buildIso(entries, label = "WYX FILES") {
  const root = tree(entries);
  const files = [];
  const collect = (d) => { files.push(...d.files); for (const c of d.dirs.values()) collect(c); };
  collect(root);
  const H = [hierarchy(root, false), hierarchy(root, true)];
  // Раскладка: 16 пустых, PVD, Joliet SVD, конец, таблицы путей, каталоги, файлы.
  let lba = 19;
  for (const h of H) {
    const pt = Math.ceil(h.ptSize / SECTOR);
    h.lpt = lba; lba += pt; h.mpt = lba; lba += pt;
  }
  for (const h of H) for (const d of h.order) { const r = h.recs.get(d); r.lba = lba; lba += r.sectors; }
  for (const f of files) { f.lba = f.size ? lba : 0; lba += Math.ceil(f.size / SECTOR); }
  const total = lba;
  const buf = new ArrayBuffer(total * SECTOR);
  const u8 = new Uint8Array(buf);
  const v = new DataView(buf);
  const now = new Date();

  const record = (o, h, r, x) => {
    const isDir = !("file" in x);
    const extent = isDir ? h.recs.get(x).lba : x.lba;
    const size = isDir ? h.recs.get(x).sectors * SECTOR : x.size;
    const len = 33 + r.id.length + (r.id.length % 2 === 0 ? 1 : 0);
    u8[o] = len; u8[o + 1] = 0;
    both32(v, o + 2, extent); both32(v, o + 10, size);
    dirDate(u8, o + 18, now);
    u8[o + 25] = isDir ? 2 : 0;
    both16(v, o + 28, 1);
    u8[o + 32] = r.id.length;
    u8.set(r.id, o + 33);
    return len;
  };

  const descriptor = (sector, h, joliet) => {
    const o = sector * SECTOR;
    u8[o] = joliet ? 2 : 1; u8.set(enc.encode("CD001"), o + 1); u8[o + 6] = 1;
    if (joliet) { ucs2Field(u8, o + 8, 32, "WYX"); ucs2Field(u8, o + 40, 32, label); }
    else { ascii(u8, o + 8, 32, "WYX"); ascii(u8, o + 40, 32, label.toUpperCase().replace(D_CHARS, "_")); }
    both32(v, o + 80, total);
    if (joliet) u8.set([0x25, 0x2f, 0x45], o + 88);  // UCS-2 уровень 3
    both16(v, o + 120, 1); both16(v, o + 124, 1); both16(v, o + 128, SECTOR);
    both32(v, o + 132, h.ptSize);
    v.setUint32(o + 140, h.lpt, true); v.setUint32(o + 148, h.mpt, false);
    record(o + 156, h, { id: new Uint8Array([0]) }, root);
    for (const [off, len] of [[190, 128], [318, 128], [446, 128], [574, 128], [702, 37], [739, 37], [776, 37]]) {
      if (joliet) ucs2Field(u8, o + off, len - (len % 2), ""); else ascii(u8, o + off, len, "");
    }
    if (!joliet) ascii(u8, o + 574, 128, "WYX RETRO PC");
    volDate(u8, o + 813, now); volDate(u8, o + 830, now); volDate(u8, o + 847, null); volDate(u8, o + 864, now);
    u8[o + 881] = 1;
  };
  descriptor(16, H[0], false);
  descriptor(17, H[1], true);
  u8[18 * SECTOR] = 255; u8.set(enc.encode("CD001"), 18 * SECTOR + 1); u8[18 * SECTOR + 6] = 1;

  for (const h of H) {
    // Таблицы путей: L — младшим байтом вперёд, M — старшим.
    for (const [base, le] of [[h.lpt, true], [h.mpt, false]]) {
      let o = base * SECTOR;
      for (const d of h.order) {
        const id = d.parent ? h.idBytes(d) : new Uint8Array([0]);
        u8[o] = id.length; u8[o + 1] = 0;
        v.setUint32(o + 2, h.recs.get(d).lba, le);
        v.setUint16(o + 6, d.parent ? h.num.get(d.parent) : 1, le);
        u8.set(id, o + 8);
        o += 8 + id.length + (id.length % 2);
      }
    }
    // Каталоги.
    for (const d of h.order) {
      const r = h.recs.get(d);
      let o = r.lba * SECTOR, used = 0;
      for (const rec of r.list) {
        const len = 33 + rec.id.length + (rec.id.length % 2 === 0 ? 1 : 0);
        if (used + len > SECTOR) { o += SECTOR - used; used = 0; }
        record(o, h, rec, rec.self);
        o += len; used += len;
      }
    }
  }
  // Файлы — по одному, чтобы не держать два больших буфера разом.
  for (const f of files) if (f.size) u8.set(new Uint8Array(await f.file.arrayBuffer()), f.lba * SECTOR);
  return buf;
}
