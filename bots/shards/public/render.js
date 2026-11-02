// Отрисовка: карта приключений и поле боя на canvas. Только рисуют и
// переводят касания в клетки — решения принимает app.js.

import { TERRAIN, UNITS, FACTIONS, MINES, RES_ICON } from "./shared/data.js";
import { BW, BH } from "./shared/hex.js";

const DPR = () => Math.min(window.devicePixelRatio || 1, 2);

// Эмодзи рисуются в canvas медленно — держим готовые картинки.
const glyphs = new Map();
export function glyph(ch, px) {
  const k = `${ch}|${px}`;
  let c = glyphs.get(k);
  if (c) return c;
  c = document.createElement("canvas");
  c.width = c.height = Math.ceil(px * 1.3);
  const g = c.getContext("2d");
  g.font = `${px}px "Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji",sans-serif`;
  g.textAlign = "center";
  g.textBaseline = "middle";
  g.fillText(ch, c.width / 2, c.height / 2 + px * 0.06);
  glyphs.set(k, c);
  return c;
}

const drawGlyph = (ctx, ch, x, y, px) => {
  if (!(px >= 2)) return; // холст ещё без размеров
  const im = glyph(ch, Math.round(px * DPR()));
  const s = im.width / DPR();
  ctx.drawImage(im, x - s / 2, y - s / 2, s, s);
};

/** Псевдослучайное по клетке — чтобы узор местности не прыгал между кадрами. */
const hash = (x, y) => {
  let h = (x * 374761393 + y * 668265263) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
};

function shade(hex, k) {
  const n = parseInt(hex.slice(1), 16);
  const f = (v) => Math.max(0, Math.min(255, Math.round(v * k)));
  return `rgb(${f(n >> 16)},${f((n >> 8) & 255)},${f(n & 255)})`;
}

const PRESS_SLOP = 8;

/** Общий разбор касаний: тап, перетаскивание, щипок. */
function attachPointer(canvas, { onTap, onPan, onZoom }) {
  const pts = new Map();
  let moved = false, startDist = 0, lastMid = null;
  canvas.addEventListener("pointerdown", (e) => {
    canvas.setPointerCapture(e.pointerId);
    pts.set(e.pointerId, { x: e.clientX, y: e.clientY, sx: e.clientX, sy: e.clientY });
    if (pts.size === 1) moved = false;
    if (pts.size === 2) {
      const [a, b] = [...pts.values()];
      startDist = Math.hypot(a.x - b.x, a.y - b.y);
      lastMid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      moved = true;
    }
  });
  canvas.addEventListener("pointermove", (e) => {
    const p = pts.get(e.pointerId);
    if (!p) return;
    const dx = e.clientX - p.x, dy = e.clientY - p.y;
    p.x = e.clientX; p.y = e.clientY;
    if (pts.size === 1) {
      if (!moved && Math.hypot(p.x - p.sx, p.y - p.sy) > PRESS_SLOP) moved = true;
      if (moved && onPan) onPan(dx, dy);
    } else if (pts.size === 2 && onZoom) {
      const [a, b] = [...pts.values()];
      const d = Math.hypot(a.x - b.x, a.y - b.y);
      const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      if (startDist) onZoom(d / startDist, mid);
      if (onPan && lastMid) onPan(mid.x - lastMid.x, mid.y - lastMid.y);
      startDist = d; lastMid = mid;
    }
  });
  const up = (e) => {
    const p = pts.get(e.pointerId);
    pts.delete(e.pointerId);
    if (p && !moved && pts.size === 0 && onTap) {
      const r = canvas.getBoundingClientRect();
      onTap(e.clientX - r.left, e.clientY - r.top);
    }
    if (pts.size < 2) { startDist = 0; lastMid = null; }
  };
  canvas.addEventListener("pointerup", up);
  canvas.addEventListener("pointercancel", (e) => { pts.delete(e.pointerId); moved = true; });
  canvas.addEventListener("wheel", (e) => {
    e.preventDefault();
    const r = canvas.getBoundingClientRect();
    onZoom?.(e.deltaY < 0 ? 1.12 : 1 / 1.12, { x: e.clientX, y: e.clientY - 0 }, r);
  }, { passive: false });
}

function fitCanvas(canvas) {
  const r = canvas.getBoundingClientRect();
  const d = DPR();
  const w = Math.round(r.width * d), h = Math.round(r.height * d);
  if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
  return { w: r.width, h: r.height, d };
}

// ================= карта =================

export class MapView {
  constructor(canvas, { onTap }) {
    this.c = canvas;
    this.ctx = canvas.getContext("2d");
    this.tile = 44;
    this.cam = { x: 0, y: 0 };
    this.st = null;
    this.me = -1;
    this.sel = null;     // id выбранного героя
    this.path = null;    // [{x, y, cost}] предпросмотр пути
    this.anim = null;    // {hero, pts, t0}
    this.dirty = true;
    attachPointer(canvas, {
      onTap: (x, y) => {
        const tx = Math.floor((x + this.cam.x) / this.tile), ty = Math.floor((y + this.cam.y) / this.tile);
        if (this.st && tx >= 0 && ty >= 0 && tx < this.st.w && ty < this.st.h) onTap(tx, ty);
      },
      onPan: (dx, dy) => { this.cam.x -= dx; this.cam.y -= dy; this.clamp(); this.dirty = true; },
      onZoom: (k, mid) => {
        const r = canvas.getBoundingClientRect();
        const mx = mid.x - r.left, my = mid.y - r.top;
        const old = this.tile;
        this.tile = Math.max(26, Math.min(80, this.tile * k));
        const f = this.tile / old;
        this.cam.x = (this.cam.x + mx) * f - mx;
        this.cam.y = (this.cam.y + my) * f - my;
        this.clamp();
        this.dirty = true;
      },
    });
    const loop = (t) => {
      if (this.dirty || this.anim || this.sel) this.draw(t);
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
    new ResizeObserver(() => { this.dirty = true; }).observe(canvas);
  }

  setState(st, me) { this.st = st; this.me = me; this.dirty = true; }

  clamp() {
    if (!this.st) return;
    const r = this.c.getBoundingClientRect();
    const W = this.st.w * this.tile, H = this.st.h * this.tile, pad = this.tile;
    // Карта больше экрана — держим край карты у края экрана; меньше — по центру.
    const fit = (cam, map, view) => map + 2 * pad <= view ? (map - view) / 2 : Math.max(-pad, Math.min(map - view + pad, cam));
    this.cam.x = fit(this.cam.x, W, r.width);
    this.cam.y = fit(this.cam.y, H, r.height);
  }

  center(x, y) {
    const r = this.c.getBoundingClientRect();
    this.cam.x = (x + 0.5) * this.tile - r.width / 2;
    this.cam.y = (y + 0.5) * this.tile - r.height / 2;
    this.clamp();
    this.dirty = true;
  }

  /** Анимация шага героя по клеткам [[x, y], …]. */
  animate(heroId, pts) {
    if (pts.length < 2) return Promise.resolve();
    return new Promise((done) => { this.anim = { hero: heroId, pts, t0: performance.now(), done }; });
  }

  heroPos(h, now) {
    const a = this.anim;
    if (!a || a.hero !== h.id) return [h.x, h.y];
    const per = 90;
    const t = (now - a.t0) / per;
    const i = Math.floor(t);
    if (i >= a.pts.length - 1) {
      this.anim = null;
      a.done();
      return [h.x, h.y];
    }
    const [x0, y0] = a.pts[i], [x1, y1] = a.pts[i + 1];
    const f = t - i;
    return [x0 + (x1 - x0) * f, y0 + (y1 - y0) * f];
  }

  draw(now = performance.now()) {
    this.dirty = false;
    const st = this.st;
    const { w, h, d } = fitCanvas(this.c);
    const ctx = this.ctx;
    ctx.setTransform(d, 0, 0, d, 0, 0);
    ctx.fillStyle = "#0b0d12";
    ctx.fillRect(0, 0, w, h);
    if (!st) return;
    const T = this.tile;
    const seen = this.me >= 0 ? st.players[this.me].seen : null;
    const x0 = Math.max(0, Math.floor(this.cam.x / T)), y0 = Math.max(0, Math.floor(this.cam.y / T));
    const x1 = Math.min(st.w - 1, Math.ceil((this.cam.x + w) / T)), y1 = Math.min(st.h - 1, Math.ceil((this.cam.y + h) / T));
    const vis = (x, y) => !seen || seen[y * st.w + x] === "1";
    ctx.save();
    ctx.translate(-this.cam.x, -this.cam.y);

    // Местность.
    for (let y = y0; y <= y1; y++)
      for (let x = x0; x <= x1; x++) {
        const px = x * T, py = y * T;
        if (!vis(x, y)) continue;
        const t = st.terrain[y * st.w + x];
        const info = TERRAIN[t];
        const r = hash(x, y);
        ctx.fillStyle = shade(info.color, 0.92 + r * 0.16);
        ctx.fillRect(px, py, T + 0.5, T + 0.5);
        if (t === "g" && r > 0.55) { ctx.fillStyle = "rgba(20,60,10,.25)"; ctx.fillRect(px + T * r * 0.7, py + T * (1 - r) * 0.7, 3, 3); }
        if (t === "~") { ctx.strokeStyle = "rgba(255,255,255,.18)"; ctx.beginPath(); ctx.moveTo(px + T * 0.2, py + T * (0.4 + r * 0.3)); ctx.quadraticCurveTo(px + T * 0.5, py + T * (0.3 + r * 0.3), px + T * 0.8, py + T * (0.4 + r * 0.3)); ctx.stroke(); }
        if (t === "d") { ctx.fillStyle = "rgba(60,40,10,.18)"; ctx.fillRect(px + T * 0.15, py + T * 0.45, T * 0.7, T * 0.1); }
      }
    for (let y = y0; y <= y1; y++)
      for (let x = x0; x <= x1; x++) {
        if (!vis(x, y)) continue;
        const t = st.terrain[y * st.w + x];
        const r = hash(x, y);
        if (t === "T") {
          drawGlyph(ctx, "🌲", x * T + T * (0.32 + r * 0.1), y * T + T * 0.38, T * 0.5);
          drawGlyph(ctx, r > 0.5 ? "🌳" : "🌲", x * T + T * 0.66, y * T + T * (0.62 - r * 0.1), T * 0.52);
        } else if (t === "M") drawGlyph(ctx, r > 0.7 ? "🏔️" : "⛰️", x * T + T / 2, y * T + T * 0.52, T * 0.8);
      }

    // Путь.
    if (this.path && this.sel) {
      const hero = st.heroes.find((x) => x.id === this.sel);
      const mp = hero ? hero.mp : 0;
      for (const p of this.path) {
        ctx.fillStyle = p.cost <= mp ? "#7cf27c" : "#f2b04a";
        ctx.beginPath();
        ctx.arc(p.x * T + T / 2, p.y * T + T / 2, Math.max(3, T * 0.09), 0, Math.PI * 2);
        ctx.fill();
      }
      const last = this.path[this.path.length - 1];
      ctx.strokeStyle = last.cost <= mp ? "#7cf27c" : "#f2b04a";
      ctx.lineWidth = 2;
      ctx.strokeRect(last.x * T + 3, last.y * T + 3, T - 6, T - 6);
    }

    // Объекты.
    for (const o of st.objects) {
      if (o.x < x0 - 1 || o.x > x1 + 1 || o.y < y0 - 1 || o.y > y1 + 1 || !vis(o.x, o.y)) continue;
      const cx = o.x * T + T / 2, cy = o.y * T + T / 2;
      const ownerColor = o.owner !== null && o.owner !== undefined ? st.players[o.owner]?.color : null;
      if (o.kind === "town") {
        ctx.fillStyle = ownerColor || "#9aa0a6";
        ctx.globalAlpha = 0.35;
        ctx.beginPath(); ctx.arc(cx, cy, T * 0.62, 0, Math.PI * 2); ctx.fill();
        ctx.globalAlpha = 1;
        drawGlyph(ctx, FACTIONS[o.faction].town, cx, cy - T * 0.05, T * 0.95);
        flag(ctx, cx + T * 0.3, cy - T * 0.45, T, ownerColor || "#9aa0a6");
      } else if (o.kind === "mine") {
        drawGlyph(ctx, MINES[o.res].icon, cx, cy, T * 0.62);
        drawGlyph(ctx, RES_ICON[o.res], cx + T * 0.28, cy + T * 0.26, T * 0.3);
        if (ownerColor) flag(ctx, cx - T * 0.3, cy - T * 0.42, T * 0.7, ownerColor);
      } else if (o.kind === "res") drawGlyph(ctx, RES_ICON[o.res], cx, cy, T * 0.55);
      else if (o.kind === "chest") drawGlyph(ctx, "🧰", cx, cy, T * 0.55);
      else if (o.kind === "shrine") drawGlyph(ctx, "⛩️", cx, cy, T * 0.6);
      else if (o.kind === "well") drawGlyph(ctx, "⛲", cx, cy, T * 0.6);
      else if (o.kind === "monster") {
        ctx.fillStyle = "rgba(0,0,0,.25)";
        ctx.beginPath(); ctx.ellipse(cx, cy + T * 0.3, T * 0.32, T * 0.1, 0, 0, Math.PI * 2); ctx.fill();
        drawGlyph(ctx, UNITS[o.u].icon, cx, cy, T * 0.66);
      }
    }

    // Герои. В городе — поменьше и в углу клетки, чтобы город было видно.
    const towns = new Set(st.objects.filter((o) => o.kind === "town").map((o) => `${o.x},${o.y}`));
    for (const hr of st.heroes) {
      if (!vis(hr.x, hr.y)) continue;
      const [hx, hy] = this.heroPos(hr, now);
      const inTown = towns.has(`${hr.x},${hr.y}`) && hx === hr.x && hy === hr.y;
      const k = inTown ? 0.62 : 1;
      const cx = hx * T + T / 2 + (inTown ? T * 0.34 : 0), cy = hy * T + T / 2 + (inTown ? T * 0.34 : 0);
      const col = st.players[hr.owner].color;
      if (hr.id === this.sel) {
        const pulse = 0.5 + 0.5 * Math.sin(now / 250);
        ctx.strokeStyle = `rgba(255,230,120,${0.5 + pulse * 0.5})`;
        ctx.lineWidth = 3;
        ctx.beginPath(); ctx.arc(cx, cy, T * 0.46 * k, 0, Math.PI * 2); ctx.stroke();
      }
      ctx.fillStyle = col;
      ctx.beginPath(); ctx.arc(cx, cy, T * 0.36 * k, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = "rgba(0,0,0,.5)"; ctx.lineWidth = 1.5; ctx.stroke();
      drawGlyph(ctx, FACTIONS[hr.faction].heroIcon, cx, cy, T * 0.5 * k);
      if (!inTown) flag(ctx, cx + T * 0.26, cy - T * 0.5, T * 0.8, col);
    }

    // Туман: тёмные клетки с мягким краем.
    if (seen) {
      for (let y = y0; y <= y1; y++)
        for (let x = x0; x <= x1; x++) {
          if (vis(x, y)) continue;
          ctx.fillStyle = "#07080c";
          ctx.fillRect(x * T - 0.5, y * T - 0.5, T + 1, T + 1);
          ctx.fillStyle = "rgba(255,255,255,.02)";
          if (hash(x, y) > 0.7) ctx.fillRect(x * T + T * 0.3, y * T + T * 0.6, 2, 2);
        }
    }
    ctx.restore();
  }
}

function flag(ctx, x, y, T, color) {
  ctx.strokeStyle = "#2b2b2b";
  ctx.lineWidth = 1.5;
  ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x, y + T * 0.32); ctx.stroke();
  ctx.fillStyle = color;
  ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + T * 0.2, y + T * 0.06); ctx.lineTo(x, y + T * 0.13); ctx.fill();
}

// ================= бой =================

const SQ3 = Math.sqrt(3);

export class BattleView {
  constructor(canvas, { onTap }) {
    this.c = canvas;
    this.ctx = canvas.getContext("2d");
    this.b = null;
    this.st = null;
    this.mySide = -1;
    this.hl = null;           // Map "x,y" → шагов (куда может пойти активный)
    this.targets = null;      // Set id отрядов-целей (заклинание)
    this.floats = [];         // всплывающие числа {x, y, text, color, t0}
    this.moves = new Map();   // id → {fx, fy, t0} плавный переход
    this.layout = null;
    attachPointer(canvas, {
      onTap: (x, y) => {
        const hit = this.hexAt(x, y);
        if (hit) onTap(hit[0], hit[1], x, y);
      },
    });
    const loop = (t) => { if (this.b) this.draw(t); requestAnimationFrame(loop); };
    requestAnimationFrame(loop);
  }

  setBattle(b, st, mySide, events = []) {
    const prev = this.b;
    if (prev) {
      for (const s of b.stacks) {
        const o = prev.stacks.find((p) => p.id === s.id);
        if (o && (o.x !== s.x || o.y !== s.y)) this.moves.set(s.id, { fx: o.x, fy: o.y, t0: performance.now() });
      }
    }
    this.b = b; this.st = st; this.mySide = mySide;
    let delay = 0;
    for (const e of events) {
      const target = b.stacks.find((s) => s.id === e.to);
      if (!target) continue;
      if (e.dmg) this.float(target, `−${e.dmg}${e.killed ? ` (☠${e.killed})` : ""}`, "#ff6b6b", delay);
      else if (e.type === "spell") this.float(target, "✨", "#9fd8ff", delay);
      delay += 260;
    }
  }

  float(s, text, color, delay = 0) {
    this.floats.push({ x: s.x, y: s.y, text, color, t0: performance.now() + delay });
  }

  /** Размер клетки и отступы. На вытянутом вверх экране поле повёрнуто:
   *  наши (сторона 0) снизу, противник сверху — клетки так крупнее. */
  computeLayout() {
    const r = this.c.getBoundingClientRect();
    const long = (BW + 0.5) * SQ3, short = (BH - 1) * 1.5 + 2;
    const portrait = r.height > r.width * 1.15;
    const size = portrait ? Math.min(r.width / short, r.height / long) : Math.min(r.width / long, r.height / short);
    const fw = (portrait ? short : long) * size, fh = (portrait ? long : short) * size;
    this.layout = { size, portrait, ox: (r.width - fw) / 2, oy: (r.height - fh) / 2 };
    return this.layout;
  }

  center(x, y) {
    const { size, ox, oy, portrait } = this.layout || this.computeLayout();
    const along = SQ3 * size * (x + (y & 1) / 2 + 0.5), across = size + 1.5 * size * y;
    if (!portrait) return [ox + along, oy + across];
    return [ox + across, oy + (BW + 0.5) * SQ3 * size - along];
  }

  hexAt(px, py) {
    const { size } = this.computeLayout();
    let best = null, bd = Infinity;
    for (let y = 0; y < BH; y++)
      for (let x = 0; x < BW; x++) {
        const [cx, cy] = this.center(x, y);
        const d = Math.hypot(px - cx, py - cy);
        if (d < bd) { bd = d; best = [x, y]; }
      }
    return bd < size ? best : null;
  }

  draw(now) {
    const { w, h, d } = fitCanvas(this.c);
    const ctx = this.ctx;
    ctx.setTransform(d, 0, 0, d, 0, 0);
    const g = ctx.createLinearGradient(0, 0, 0, h);
    g.addColorStop(0, "#3f6b35"); g.addColorStop(1, "#2a4a27");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
    const { size } = this.computeLayout();
    const b = this.b;
    const active = b.stacks.find((s) => s.id === b.active);

    const turn = this.layout.portrait ? 0 : -30;
    const hexPath = (cx, cy, s) => {
      ctx.beginPath();
      for (let i = 0; i < 6; i++) {
        const a = Math.PI / 180 * (60 * i + turn);
        const x = cx + s * Math.cos(a), y = cy + s * Math.sin(a);
        i ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
      }
      ctx.closePath();
    };
    for (let y = 0; y < BH; y++)
      for (let x = 0; x < BW; x++) {
        const [cx, cy] = this.center(x, y);
        hexPath(cx, cy, size * 0.97);
        const k = `${x},${y}`;
        ctx.fillStyle = this.hl?.has(k) ? "rgba(140,230,120,.28)" : (x + y) % 2 ? "rgba(0,0,0,.06)" : "rgba(255,255,255,.03)";
        ctx.fill();
        ctx.strokeStyle = "rgba(0,0,0,.28)";
        ctx.lineWidth = 1;
        ctx.stroke();
      }
    for (const o of b.obstacles) {
      const [cx, cy] = this.center(o.x, o.y);
      drawGlyph(ctx, "🪨", cx, cy, size * 1.2);
    }

    for (const s of b.stacks) {
      if (s.n <= 0) continue;
      let [cx, cy] = this.center(s.x, s.y);
      const mv = this.moves.get(s.id);
      if (mv) {
        const f = Math.min(1, (now - mv.t0) / 280);
        const [fx, fy] = this.center(mv.fx, mv.fy);
        cx = fx + (cx - fx) * f; cy = fy + (cy - fy) * f;
        if (f >= 1) this.moves.delete(s.id);
      }
      const col = s.side === 0 ? sideColor(this.st, b, 0) : sideColor(this.st, b, 1);
      if (active && s.id === active.id) {
        const pulse = 0.5 + 0.5 * Math.sin(now / 200);
        hexPath(cx, cy, size * 0.95);
        ctx.strokeStyle = `rgba(255,225,110,${0.55 + 0.45 * pulse})`;
        ctx.lineWidth = 3;
        ctx.stroke();
      }
      if (this.targets?.has(s.id)) {
        hexPath(cx, cy, size * 0.9);
        ctx.strokeStyle = "#9fd8ff"; ctx.lineWidth = 3; ctx.stroke();
      }
      ctx.fillStyle = "rgba(0,0,0,.25)";
      ctx.beginPath(); ctx.ellipse(cx, cy + size * 0.55, size * 0.55, size * 0.16, 0, 0, Math.PI * 2); ctx.fill();
      ctx.save();
      if (s.side === 1 && !this.layout.portrait) { ctx.translate(cx, cy); ctx.scale(-1, 1); ctx.translate(-cx, -cy); }
      drawGlyph(ctx, UNITS[s.u].icon, cx, cy - size * 0.08, size * 1.15);
      ctx.restore();
      // Табличка с числом.
      const label = String(s.n);
      ctx.font = `bold ${Math.round(size * 0.48)}px system-ui,sans-serif`;
      const tw = ctx.measureText(label).width + size * 0.3;
      const right = s.side === 0 || this.layout.portrait;
      const lx = cx + (right ? size * 0.25 : -size * 0.25 - tw), ly = cy + size * 0.35;
      ctx.fillStyle = col;
      roundRect(ctx, lx, ly, tw, size * 0.56, size * 0.14);
      ctx.fill();
      ctx.fillStyle = "#fff";
      ctx.textAlign = "center"; ctx.textBaseline = "middle";
      ctx.fillText(label, lx + tw / 2, ly + size * 0.3);
      if (s.defending) drawGlyph(ctx, "🛡️", cx - (right ? size * 0.5 : -size * 0.5), cy - size * 0.5, size * 0.42);
      if (s.fx.length) drawGlyph(ctx, s.fx.some((f) => f.k === "slow") ? "⛓️" : "✨", cx + (right ? -size * 0.5 : size * 0.5), cy + size * 0.1, size * 0.36);
    }

    this.floats = this.floats.filter((f) => now - f.t0 < 1300);
    for (const f of this.floats) {
      const t = (now - f.t0) / 1300;
      if (t < 0) continue;
      const [cx, cy] = this.center(f.x, f.y);
      ctx.globalAlpha = 1 - t;
      ctx.font = `bold ${Math.round(size * 0.55)}px system-ui,sans-serif`;
      ctx.textAlign = "center";
      ctx.lineWidth = 3;
      ctx.strokeStyle = "rgba(0,0,0,.7)";
      ctx.strokeText(f.text, cx, cy - size * 0.8 - t * size);
      ctx.fillStyle = f.color;
      ctx.fillText(f.text, cx, cy - size * 0.8 - t * size);
      ctx.globalAlpha = 1;
    }
  }
}

function sideColor(st, b, side) {
  const p = b.sides[side].player;
  return p === null || p === undefined ? "#6b6f76" : st.players[p].color;
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}
