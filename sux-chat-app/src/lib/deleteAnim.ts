/**
 * Анимации удаления сообщения. Вариант выбирается случайно, без повтора
 * подряд:
 *   • eat      — «съели»: укусы с зубчиками по краю, крошки, остаток тает;
 *   • break    — «сломали»: трещина посередине, половинки падают в стороны;
 *   • shred    — шредер: пузырь уходит в щель и выходит снизу полосками;
 *   • redact   — замазывание: буквы по одной закрашиваются ████;
 *   • ant      — муравей 🐜 прибегает с ближнего края и утаскивает пузырь;
 *   • burn     — сжигание: огненная кромка ползёт снизу вверх, искры и дым;
 *   • dissolve — растворение: пузырь рассыпается в пыль и тает.
 * Работают прямо с DOM строки сообщения (#msg-<id>): маски, клоны, частицы —
 * всё убирается само. Длится DELETE_ANIM_MS, потом ChatWindow плавно
 * схлопывает строку. resetDeleteAnimation возвращает пузырь как был (отмена
 * удаления посреди анимации). Для проверки вариант можно задать явно:
 * window.__hyaxDeleteAnim = "burn" (и т. п.).
 */
export const DELETE_ANIM_MS = 900;

type Variant = "eat" | "break" | "shred" | "redact" | "ant" | "burn" | "dissolve";
const VARIANTS: Variant[] = ["eat", "break", "shred", "redact", "ant", "burn", "dissolve"];
let lastVariant: Variant | null = null;

const reduced = () => {
  try { return window.matchMedia("(prefers-reduced-motion: reduce)").matches; } catch { return false; }
};

// Поколение анимации строки: отложенные шаги старой анимации после отмены
// ничего не делают.
const gen = new WeakMap<HTMLElement, number>();
function later(row: HTMLElement, fn: () => void, ms: number) {
  const g = gen.get(row);
  window.setTimeout(() => { if (gen.get(row) === g) fn(); }, ms);
}
function frames(row: HTMLElement, dur: number, fn: (t: number, now: number) => void, done?: () => void) {
  const g = gen.get(row), t0 = performance.now();
  const tick = (now: number) => {
    if (gen.get(row) !== g) return;
    const t = Math.min(1, (now - t0) / dur);
    fn(t, now);
    if (t < 1) requestAnimationFrame(tick); else done?.();
  };
  requestAnimationFrame(tick);
}

function ensureRelative(el: HTMLElement) {
  if (getComputedStyle(el).position === "static") el.style.position = "relative";
}

function bubbleColor(el: HTMLElement): string {
  const c = getComputedStyle(el).backgroundColor;
  return c && c !== "rgba(0, 0, 0, 0)" && c !== "transparent" ? c : getComputedStyle(el).color || "#888";
}

const css = (el: HTMLElement | SVGElement, props: Record<string, string>) => { Object.assign(el.style, props); };

/** Где пузырь внутри строки. */
function geom(row: HTMLElement, bubble: HTMLElement) {
  const rr = row.getBoundingClientRect(), br = bubble.getBoundingClientRect();
  return { x: br.left - rr.left, y: br.top - rr.top, w: br.width, h: br.height, rowW: rr.width };
}

/** Элемент эффекта в строке (клон, частица) — помечен, чтобы убрать при отмене. */
function fx<T extends HTMLElement | SVGElement>(row: HTMLElement, el: T): T {
  el.setAttribute("data-del-fx", "");
  row.appendChild(el);
  return el;
}

/** Клон пузыря поверх оригинала: с ним делаем что угодно, оригинал прячем. */
function cloneOver(row: HTMLElement, bubble: HTMLElement, extra: Record<string, string> = {}) {
  const g = geom(row, bubble);
  const c = bubble.cloneNode(true) as HTMLElement;
  c.removeAttribute("data-bubble");
  c.removeAttribute("id");
  c.querySelectorAll("[id]").forEach((n) => n.removeAttribute("id"));
  css(c, {
    position: "absolute", left: `${g.x}px`, top: `${g.y}px`, width: `${g.w}px`, height: `${g.h}px`,
    margin: "0", boxSizing: "border-box", pointerEvents: "none", zIndex: "5", ...extra,
  });
  fx(row, c);
  return { c, ...g };
}

/** Частицы: крошки падают, искры и пыль поднимаются (dx — снос вбок). */
function particles(row: HTMLElement, x: number, y: number, color: string, n = 4, up = false, dx0 = 0) {
  for (let i = 0; i < n; i++) {
    const p = document.createElement("span");
    const size = 2 + Math.random() * (up ? 3 : 4);
    css(p, {
      position: "absolute", left: `${x}px`, top: `${y}px`, width: `${size}px`, height: `${size}px`,
      background: color, borderRadius: `${Math.random() < 0.5 ? 1 : size / 2}px`, pointerEvents: "none", zIndex: "6",
    });
    fx(row, p);
    const dx = dx0 + (Math.random() - 0.5) * (up ? 30 : 46);
    const dy = up ? -(16 + Math.random() * 34) : 30 + Math.random() * 40;
    p.animate(
      [{ transform: "translate(0, 0) rotate(0deg)", opacity: 1 }, { transform: `translate(${dx}px, ${dy}px) rotate(${(Math.random() - 0.5) * 360}deg)`, opacity: 0 }],
      { duration: 460 + Math.random() * 260, easing: up ? "ease-out" : "cubic-bezier(.45, 0, .9, .5)", fill: "forwards" },
    ).onfinish = () => p.remove();
  }
}

/** Эмодзи-частица (огонёк): вспыхивает, поднимается и гаснет. */
function emojiPuff(row: HTMLElement, x: number, y: number, ch: string, size: number, rise: number, ms: number) {
  const e = document.createElement("span");
  e.textContent = ch;
  css(e, { position: "absolute", left: `${x - size / 2}px`, top: `${y - size * 0.8}px`, fontSize: `${size}px`, lineHeight: "1", pointerEvents: "none", zIndex: "7" });
  fx(row, e);
  e.animate(
    [{ transform: "translateY(0) scale(.5)", opacity: 0 }, { transform: "translateY(-3px) scale(1)", opacity: 1, offset: 0.3 }, { transform: `translateY(${-rise}px) scale(.7)`, opacity: 0 }],
    { duration: ms, easing: "ease-out", fill: "forwards" },
  ).onfinish = () => e.remove();
}

type Hole = [cx: number, cy: number, r: number];
const MASK_PROPS = ["mask-image", "-webkit-mask-image", "mask-size", "-webkit-mask-size", "mask-position", "-webkit-mask-position",
  "mask-repeat", "-webkit-mask-repeat", "mask-composite", "-webkit-mask-composite"];

/** Дырки в пузыре — маской из CSS-градиентов: сверху сплошной слой, из
 *  которого вычитаются круги (каждый — отдельный маленький слой). Градиенты
 *  рисуются в тот же кадр; маска-картинка SVG в WebKit (iOS) подгружается
 *  асинхронно, и пока грузится, пузырь пропадал целиком — мигал. */
function setHoles(el: HTMLElement, holes: Hole[]) {
  const img = ["linear-gradient(#000, #000)"], size = ["100% 100%"], pos = ["0 0"], std = ["subtract"], wk = ["source-out"];
  for (const [cx, cy, r] of holes) {
    const d = r * 2 + 2;
    img.push(`radial-gradient(circle closest-side, #000 calc(100% - 1px), transparent)`);
    size.push(`${d.toFixed(1)}px ${d.toFixed(1)}px`);
    pos.push(`${(cx - r - 1).toFixed(1)}px ${(cy - r - 1).toFixed(1)}px`);
    std.push("add");
    wk.push("source-over");
  }
  const set = (k: string, v: string[]) => { el.style.setProperty(`-webkit-${k}`, v.join(", ")); el.style.setProperty(k, v.join(", ")); };
  set("mask-image", img);
  set("mask-size", size);
  set("mask-position", pos);
  set("mask-repeat", img.map(() => "no-repeat"));
  el.style.setProperty("-webkit-mask-composite", wk.join(", "));
  el.style.setProperty("mask-composite", std.join(", "));
}

// ── «Съели» ───────────────────────────────────────────────────────────────

/** Укус: круг и крупные зубчики по краю — читается как след зубов. */
function bite(cx: number, cy: number, r: number): Hole[] {
  const teeth = 7, tr = r * 0.34, turn = Math.random() * Math.PI;
  const out: Hole[] = [[cx, cy, r * 0.92]];
  for (let i = 0; i < teeth; i++) {
    const a = turn + (i / teeth) * Math.PI * 2;
    out.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r, tr]);
  }
  return out;
}

function eat(row: HTMLElement, bubble: HTMLElement) {
  const w = Math.max(1, bubble.offsetWidth), h = Math.max(1, bubble.offsetHeight);
  const { x: ox, y: oy } = geom(row, bubble);
  const color = bubbleColor(bubble);
  // Укус — под высоту пузыря: узкий однострочный не исчезает за два укуса.
  const r = Math.min(34, Math.max(10, Math.min(h * 0.55, w * 0.12)));
  // Откусываем с краёв, по очереди с разных сторон.
  const pts: [number, number][] = [[w, h * 0.32], [0, h * 0.7], [w * 0.58, 0], [w * 0.34, h], [w * 0.95, h * 0.92], [w * 0.06, h * 0.1]];
  const holes: Hole[] = [];
  const step = 125;
  pts.forEach(([x, y], i) => {
    later(row, () => {
      holes.push(...bite(x, y, r * (i >= 4 ? 1.15 : 1)));
      setHoles(bubble, holes);
      bubble.animate(
        [{ transform: "none" }, { transform: `translate(${i % 2 ? 2 : -2}px, 1px) rotate(${i % 2 ? 1 : -1}deg)` }, { transform: "none" }],
        { duration: 110, easing: "ease-out" },
      );
      particles(row, ox + Math.min(w - 2, Math.max(2, x)), oy + Math.min(h - 2, Math.max(2, y)), color, 4);
    }, i * step);
  });
  // Остаток тает.
  later(row, () => {
    bubble.animate([{ opacity: 1, transform: "none" }, { opacity: 0, transform: "scale(.85)" }], { duration: Math.max(120, DELETE_ANIM_MS - pts.length * step), easing: "ease-in", fill: "forwards" });
  }, pts.length * step);
}

// ── «Сломали» ─────────────────────────────────────────────────────────────

function breakApart(row: HTMLElement, bubble: HTMLElement) {
  // Трещина: неровная ломаная около середины, у каждого удаления своя.
  const ys = [0, 15, 31, 47, 63, 79, 100];
  const xs = ys.map((_, i) => 50 + (i % 2 ? 1 : -1) * (3 + Math.random() * 4));
  const crack = ys.map((y, i) => `${xs[i].toFixed(1)}% ${y}%`);
  const halves = [
    { clip: `polygon(0 0, ${crack.join(", ")}, 0 100%)`, origin: "10% 90%", dx: -52, dy: 78, rot: -24, sign: -1 },
    { clip: `polygon(${crack.join(", ")}, 100% 100%, 100% 0)`, origin: "90% 90%", dx: 56, dy: 86, rot: 22, sign: 1 },
  ];
  const g = geom(row, bubble);
  const color = bubbleColor(bubble);
  const pieces = halves.map((hv) => ({ c: cloneOver(row, bubble, { clipPath: hv.clip, transformOrigin: hv.origin }).c, hv }));
  bubble.style.visibility = "hidden";
  for (const { c, hv } of pieces) {
    c.animate(
      [
        { transform: "none", opacity: 1, easing: "ease-out" },
        // Треснуло: дрожь на месте…
        { transform: `translate(${hv.sign * 1.5}px, 0) rotate(${hv.sign * 0.8}deg)`, opacity: 1, offset: 0.12, easing: "ease-out" },
        // …половинки расходятся, трещина открывается…
        { transform: `translate(${hv.sign * 10}px, 3px) rotate(${hv.sign * 4}deg)`, opacity: 1, offset: 0.36, easing: "cubic-bezier(.55, 0, .9, .45)" },
        // …и падают в разные стороны.
        { transform: `translate(${hv.sign * 14}px, 10px) rotate(${hv.sign * 7}deg)`, opacity: 1, offset: 0.5, easing: "cubic-bezier(.55, 0, .9, .45)" },
        { transform: `translate(${hv.dx}px, ${hv.dy}px) rotate(${hv.rot}deg)`, opacity: 0 },
      ],
      { duration: DELETE_ANIM_MS, fill: "forwards" },
    ).onfinish = () => c.remove();
  }
  // Крошки из трещины.
  later(row, () => {
    particles(row, g.x + g.w / 2, g.y + g.h * 0.3, color, 3);
    particles(row, g.x + g.w / 2, g.y + g.h * 0.75, color, 3);
  }, DELETE_ANIM_MS * 0.2);
}

// ── Шредер ────────────────────────────────────────────────────────────────

function shred(row: HTMLElement, bubble: HTMLElement) {
  const g = geom(row, bubble);
  const { w, h } = g;
  const n = Math.max(6, Math.min(16, Math.round(w / 15)));
  // Щель шредера — по нижнему краю пузыря: выше неё пузырь целый, ниже —
  // уже нарезан. Пузырь опускается в щель, полоски расходятся веером.
  const slot = fx(row, document.createElement("span"));
  css(slot, {
    position: "absolute", left: `${g.x - 10}px`, top: `${g.y + h - 2}px`, width: `${w + 20}px`, height: "5px",
    borderRadius: "3px", background: "rgba(20,20,20,.75)", boxShadow: "0 1px 5px rgba(0,0,0,.4)", pointerEvents: "none", zIndex: "7",
  });
  slot.animate([{ opacity: 0, transform: "scaleX(.5)" }, { opacity: 1, transform: "none", offset: 0.12 }, { opacity: 1, offset: 0.8 }, { opacity: 0 }],
    { duration: DELETE_ANIM_MS, fill: "forwards" }).onfinish = () => slot.remove();
  const ease = "cubic-bezier(.45, .05, .55, .95)";
  const intake = 0.78; // доля времени, за которую пузырь уходит в щель целиком
  const whole = cloneOver(row, bubble).c;
  whole.animate(
    [
      { clipPath: "inset(0px 0px 0px 0px)", transform: "translate(0, 0)", easing: ease },
      { clipPath: `inset(0px 0px ${h}px 0px)`, transform: `translate(0, ${h}px)`, offset: intake },
      { clipPath: `inset(0px 0px ${h}px 0px)`, transform: `translate(0, ${h}px)` },
    ],
    { duration: DELETE_ANIM_MS, fill: "forwards" },
  ).onfinish = () => whole.remove();
  for (let i = 0; i < n; i++) {
    const l = (w * i) / n + 0.75, r = w - (w * (i + 1)) / n + 0.75;
    const c = cloneOver(row, bubble, { clipPath: `inset(${h}px ${r}px 0px ${l}px)` }).c;
    const k = i - (n - 1) / 2;
    const spread = k * 1.6, rot = k * 0.6 + (Math.random() - 0.5) * 3;
    const fall = h + 34 + Math.random() * 30;
    c.animate(
      [
        { clipPath: `inset(${h}px ${r}px 0px ${l}px)`, transform: "translate(0, 0) rotate(0deg)", opacity: 1, easing: ease },
        { clipPath: `inset(0px ${r}px 0px ${l}px)`, transform: `translate(${spread}px, ${h}px) rotate(${rot}deg)`, opacity: 1, offset: intake, easing: "ease-in" },
        { clipPath: `inset(0px ${r}px 0px ${l}px)`, transform: `translate(${spread * 2.5}px, ${fall}px) rotate(${rot * 3}deg)`, opacity: 0 },
      ],
      { duration: DELETE_ANIM_MS, fill: "forwards" },
    ).onfinish = () => c.remove();
  }
  bubble.style.visibility = "hidden";
  // Машинка подрагивает, пока жуёт.
  slot.animate([{ translate: "0 0" }, { translate: "0 1px" }], { duration: 60, iterations: Math.round((DELETE_ANIM_MS * intake) / 60), direction: "alternate" });
}

// ── Замазывание ████ ─────────────────────────────────────────────────────

function redact(row: HTMLElement, bubble: HTMLElement): boolean {
  // Только для сообщений с текстом: у картинки замазывать нечего.
  const hasText = Array.from(bubble.querySelectorAll(".text-body")).some((p) => (p.textContent || "").trim());
  if (!hasText) return false;
  const { c } = cloneOver(row, bubble, { overflow: "hidden" });
  // Блок █ шире обычной буквы — если менять сами символы, текст
  // переносится и уезжает. Поэтому кладём блок цвета текста ровно поверх
  // каждой буквы: выглядит как ████, а строки стоят на месте.
  const cr = c.getBoundingClientRect();
  const blocks: HTMLElement[] = [];
  const range = document.createRange();
  const walker = document.createTreeWalker(c, NodeFilter.SHOW_TEXT);
  while (walker.nextNode() && blocks.length < 500) {
    const t = walker.currentNode as Text;
    const color = t.parentElement ? getComputedStyle(t.parentElement).color : "currentColor";
    let i = 0;
    for (const ch of t.nodeValue || "") {
      if (!/\s/.test(ch)) {
        range.setStart(t, i);
        range.setEnd(t, i + ch.length);
        const r = range.getClientRects()[0];
        if (r && r.width > 0) {
          const bl = document.createElement("span");
          css(bl, {
            position: "absolute", left: `${r.left - cr.left}px`, top: `${r.top - cr.top + r.height * 0.1}px`,
            width: `${r.width + 0.5}px`, height: `${r.height * 0.8}px`, background: color, opacity: "0", pointerEvents: "none",
          });
          c.appendChild(bl);
          blocks.push(bl);
        }
      }
      i += ch.length;
    }
  }
  if (!blocks.length) { c.remove(); return false; }
  bubble.style.visibility = "hidden";
  // Закрашиваем по буквам слева направо, как маркером, — за ~60% времени:
  // короткое сообщение по букве за шаг, длинное — по нескольку.
  const steps = Math.min(blocks.length, 22), per = Math.ceil(blocks.length / steps), stepMs = (DELETE_ANIM_MS * 0.6) / steps;
  for (let k = 0; k < steps; k++) {
    later(row, () => { blocks.slice(k * per, (k + 1) * per).forEach((bl) => { bl.style.opacity = "1"; }); }, (k + 1) * stepMs);
  }
  c.animate([{ opacity: 1, transform: "none" }, { opacity: 1, transform: "none", offset: 0.76 }, { opacity: 0, transform: "scale(.96)" }],
    { duration: DELETE_ANIM_MS, easing: "ease-in", fill: "forwards" }).onfinish = () => c.remove();
  return true;
}

// ── Муравей 🐜 ────────────────────────────────────────────────────────────

function ant(row: HTMLElement, bubble: HTMLElement) {
  const o = cloneOver(row, bubble);
  bubble.style.visibility = "hidden";
  // Приходит с ближнего края, хватает пузырь и пятится назад, утаскивая его.
  // Эмодзи муравья смотрит влево: слева идёт к пузырю отражённым.
  const fromLeft = o.x + o.w / 2 < o.rowW / 2;
  const size = 22;
  const a = fx(row, document.createElement("span"));
  a.textContent = "🐜";
  const start = fromLeft ? -size - 8 : o.rowW + 8;
  const grab = fromLeft ? o.x - size + 6 : o.x + o.w - 6;
  const away = fromLeft ? -(o.x + o.w + size + 30) : o.rowW - o.x + size + 30;
  const flip = fromLeft ? "scaleX(-1)" : "scaleX(1)";
  css(a, { position: "absolute", left: "0", top: `${o.y + o.h - size - 2}px`, fontSize: `${size}px`, lineHeight: "1", pointerEvents: "none", zIndex: "7" });
  o.c.style.transformOrigin = fromLeft ? "0% 100%" : "100% 100%";
  const walk = 0.34, hold = 0.46;
  a.animate(
    [
      { transform: `translateX(${start}px) ${flip}`, easing: "ease-out" },
      { transform: `translateX(${grab}px) ${flip}`, offset: walk },
      { transform: `translateX(${grab}px) ${flip}`, offset: hold, easing: "cubic-bezier(.5, 0, .9, .6)" },
      { transform: `translateX(${grab + away}px) ${flip}` },
    ],
    { duration: DELETE_ANIM_MS, fill: "forwards" },
  ).onfinish = () => a.remove();
  // Лапками перебирает: покачивание на ходу.
  a.animate([{ rotate: "-6deg" }, { rotate: "6deg" }], { duration: 90, iterations: Math.ceil(DELETE_ANIM_MS / 90), direction: "alternate" });
  o.c.animate(
    [
      { transform: "none" },
      { transform: "none", offset: walk },
      // Схватил: пузырь дёрнулся и накренился…
      { transform: `rotate(${fromLeft ? -3 : 3}deg) translateY(-2px)`, offset: hold, easing: "cubic-bezier(.5, 0, .9, .6)" },
      // …и поехал за муравьём.
      { transform: `translateX(${away}px) rotate(${fromLeft ? -6 : 6}deg) scale(.7)` },
    ],
    { duration: DELETE_ANIM_MS, fill: "forwards" },
  ).onfinish = () => o.c.remove();
}

// ── Сжигание ──────────────────────────────────────────────────────────────

function burn(row: HTMLElement, bubble: HTMLElement) {
  const g = geom(row, bubble);
  const w = Math.max(1, bubble.offsetWidth), h = Math.max(1, bubble.offsetHeight);
  const ph = Math.random() * 6, N = Math.max(10, Math.round(w / 7));
  // Огненная кромка — волнистая линия поверх пузыря, обрезанная по его
  // скруглённому контуру: тёмная обугленная полоса, оранжевый жар и светлая
  // середина. Ниже линии пузырь уже сгорел (маска).
  const ns = "http://www.w3.org/2000/svg";
  const svg = fx(row, document.createElementNS(ns, "svg"));
  svg.setAttribute("width", String(w));
  svg.setAttribute("height", String(h));
  svg.setAttribute("viewBox", `0 0 ${w} ${h}`);
  css(svg, {
    position: "absolute", left: `${g.x}px`, top: `${g.y}px`, overflow: "visible", pointerEvents: "none", zIndex: "6",
    clipPath: `inset(0 round ${getComputedStyle(bubble).borderRadius || "16px"})`, filter: "drop-shadow(0 0 3px rgba(255, 110, 0, .9))",
  });
  const lines = [
    { stroke: "rgba(45, 20, 5, .6)", width: 10, dy: -5 },
    { stroke: "#ff7a1a", width: 4.5, dy: 0 },
    { stroke: "#ffe48a", width: 1.6, dy: 0 },
  ].map((l) => {
    const p = document.createElementNS(ns, "polyline");
    p.setAttribute("fill", "none");
    p.setAttribute("stroke", l.stroke);
    p.setAttribute("stroke-width", String(l.width));
    p.setAttribute("stroke-linecap", "round");
    p.setAttribute("stroke-linejoin", "round");
    if (l.dy) p.setAttribute("transform", `translate(0 ${l.dy})`);
    svg.appendChild(p);
    return p;
  });
  bubble.animate([{ filter: "none" }, { filter: "sepia(.55) brightness(.8)" }], { duration: DELETE_ANIM_MS, fill: "forwards" });
  let nextPuff = 0;
  frames(row, DELETE_ANIM_MS * 0.96, (t, now) => {
    const e = t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2;
    const base = h * (1.15 - 1.42 * e);
    const pts: string[] = [];
    let ys = 0;
    for (let i = 0; i <= N; i++) {
      const x = (w * i) / N;
      const y = base + Math.sin(x / 10 + ph + t * 9) * 3 + Math.sin(x / 4.3 + ph * 1.7 - t * 14) * 1.7;
      ys += y;
      pts.push(`${x.toFixed(1)},${y.toFixed(1)}`);
    }
    const line = pts.join(" ");
    lines.forEach((p) => p.setAttribute("points", line));
    // Обрезка — clip-path, а не маска-картинка: применяется в тот же кадр.
    bubble.style.clipPath = `polygon(0px 0px, ${w}px 0px, ${pts.slice().reverse().map((q) => q.replace(",", "px ") + "px").join(", ")})`;
    // Искры, дым и огоньки над кромкой, пока она внутри пузыря.
    const mid = ys / (N + 1);
    if (now > nextPuff && mid > 2 && mid < h - 2) {
      nextPuff = now + 55;
      const x = g.x + 6 + Math.random() * Math.max(4, w - 12);
      particles(row, x, g.y + mid, Math.random() < 0.5 ? "#ffb02e" : "#ff5a00", 2, true);
      if (Math.random() < 0.45) particles(row, g.x + Math.random() * w, g.y + mid - 6, "rgba(110, 110, 110, .45)", 1, true);
      if (Math.random() < 0.5) emojiPuff(row, x, g.y + mid, "🔥", 12 + Math.random() * 6, 12 + Math.random() * 10, 380);
    }
  }, () => { svg.remove(); bubble.style.opacity = "0"; });
}

// ── Растворение ───────────────────────────────────────────────────────────

function dissolve(row: HTMLElement, bubble: HTMLElement) {
  const w = Math.max(1, bubble.offsetWidth), h = Math.max(1, bubble.offsetHeight);
  const g = geom(row, bubble);
  const color = bubbleColor(bubble);
  // Пузырь покрывается дырочками от одного края к другому: позади фронта
  // дырки крупнеют и сливаются, впереди пузырь ещё целый; пыль его цвета
  // сдувает вбок. Дырок на шаг — не больше 16 (каждая — слой маски), у
  // большого пузыря они просто крупнее.
  const holes: Hole[] = [];
  const steps = 10, per = 16, scale = Math.max(1, Math.sqrt((w * h) / 6000));
  const side = Math.random() < 0.5 ? 1 : -1;
  const at = (f: number) => (side > 0 ? f : 1 - f) * w;
  for (let k = 0; k < steps; k++) {
    later(row, () => {
      const front = 0.25 + (0.85 * (k + 1)) / steps;
      for (let i = 0; i < per; i++) {
        const f = Math.random() * front;
        // Чем дальше за фронтом, тем крупнее дырка.
        const r = (1.5 + (front - f) * 9 * Math.random() + Math.random() * 1.5) * scale;
        holes.push([at(f), Math.random() * h, r]);
      }
      setHoles(bubble, holes);
      for (let j = 0; j < 5; j++) {
        particles(row, g.x + at(Math.max(0, front - Math.random() * 0.25)), g.y + Math.random() * h, color, 1, true, side * 44);
      }
    }, k * (DELETE_ANIM_MS / (steps + 1)));
  }
  bubble.animate([{ opacity: 1, filter: "blur(0px)", transform: "none" }, { opacity: 1, offset: 0.35 }, { opacity: 0, filter: "blur(1.5px)", transform: `translate(${side * 6}px, -5px)` }],
    { duration: DELETE_ANIM_MS, easing: "ease-in", fill: "forwards" });
}

// ── Выбор и отмена ────────────────────────────────────────────────────────

function pickVariant(): Variant {
  const forced = (window as unknown as { __hyaxDeleteAnim?: string }).__hyaxDeleteAnim as Variant | undefined;
  if (forced && VARIANTS.includes(forced)) return forced;
  const pool = VARIANTS.filter((v) => v !== lastVariant);
  const v = pool[Math.floor(Math.random() * pool.length)];
  lastVariant = v;
  return v;
}

/** Запустить анимацию удаления для строки сообщения. */
export function playDeleteAnimation(row: HTMLElement | null) {
  if (!row) return;
  gen.set(row, (gen.get(row) || 0) + 1);
  const bubble = row.querySelector<HTMLElement>("[data-bubble]");
  if (reduced() || !bubble) {
    row.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 200, fill: "forwards" });
    return;
  }
  ensureRelative(row);
  // Всё, что рядом с пузырём (время и реакции под ним в «Мяте», имя
  // автора), гаснет сразу — анимация идёт только с самим пузырём.
  for (const sib of Array.from(bubble.parentElement?.children || [])) {
    if (sib !== bubble && !sib.hasAttribute("data-del-fx")) sib.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 220, easing: "ease-out", fill: "forwards" });
  }
  switch (pickVariant()) {
    case "eat": eat(row, bubble); break;
    case "break": breakApart(row, bubble); break;
    case "shred": shred(row, bubble); break;
    case "redact": if (!redact(row, bubble)) dissolve(row, bubble); break;
    case "ant": ant(row, bubble); break;
    case "burn": burn(row, bubble); break;
    default: dissolve(row, bubble);
  }
}

/** Отмена посреди анимации: убрать эффекты и вернуть пузырь и строку. */
export function resetDeleteAnimation(row: HTMLElement | null) {
  if (!row) return;
  gen.set(row, (gen.get(row) || 0) + 1);
  row.querySelectorAll("[data-del-fx]").forEach((n) => n.remove());
  row.getAnimations({ subtree: true }).forEach((a) => a.cancel());
  const bubble = row.querySelector<HTMLElement>("[data-bubble]");
  if (bubble) {
    MASK_PROPS.forEach((p) => bubble.style.removeProperty(p));
    for (const p of ["visibility", "opacity", "filter", "clip-path"]) bubble.style.removeProperty(p);
  }
  // Схлопывание (ChatWindow): строка целиком или её тело с пузырём.
  let body: HTMLElement | null = bubble;
  while (body && body.parentElement && body.parentElement !== row) body = body.parentElement;
  for (const el of [row, body]) {
    if (el) for (const p of ["max-height", "overflow", "transition", "opacity"]) el.style.removeProperty(p);
  }
}
