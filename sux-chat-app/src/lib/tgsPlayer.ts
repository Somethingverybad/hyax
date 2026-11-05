import type { AnimationItem } from "lottie-web";

/**
 * Анимированные стикеры и эмодзи .tgs (Lottie в gzip) — не больше, чем
 * выдержит память. Живая анимация lottie-web стоит ~70 байт кучи на байт
 * JSON: стикер пака «Kolobki» (~3000 фигур) — 35–100 МБ, весь пак из 50
 * разом — 2,6 ГБ и 4 кадра в секунду. Раньше каждый .tgs заводил анимацию
 * сразу при появлении в разметке (и в ленте на 400 сообщений, и в сетке
 * пака), на паузу ставились только невидимые — память не возвращалась:
 * открыл пак — окно компьютера падало (баг-репорт b3103cc9), WebView
 * iPhone убивала система (59841892).
 *
 * Теперь:
 *  • анимация живёт, только пока стикер на экране (общий IntersectionObserver);
 *    ушёл с экрана — уничтожается, остаётся застывший кадр;
 *  • живые вместе весят не больше бюджета (длина JSON; на телефоне меньше);
 *    не влезли — ждут в очереди с застывшим кадром, а играющие по кругу
 *    уступают место после каждого проигрыша — анимируются все, по очереди;
 *  • застывший кадр ждущим рисуется заранее, по одному за раз, и
 *    кэшируется; разобранные .tgs — тоже, но не больше TGS_CACHE_MAX.
 */
export const loadLottie = () => import("lottie-web").then((m) => m.default);

const TGS_CACHE_MAX = 40;
const tgsCache = new Map<string, Promise<object>>();
/** Длина JSON разобранной анимации — её «вес» для бюджета. */
const tgsWeight = new WeakMap<object, number>();

export const loadTgs = (url: string) => {
  let p = tgsCache.get(url);
  if (p) {
    // Свежий — в конец: выбрасываем самые давние.
    tgsCache.delete(url);
    tgsCache.set(url, p);
    return p;
  }
  p = Promise.all([fetch(url).then((r) => r.arrayBuffer()), import("pako")])
    .then(([buf, { inflate }]) => {
      const text = new TextDecoder().decode(inflate(new Uint8Array(buf)));
      const data = JSON.parse(text);
      tgsWeight.set(data, text.length);
      return data;
    });
  p.catch(() => tgsCache.delete(url));
  tgsCache.set(url, p);
  while (tgsCache.size > TGS_CACHE_MAX) tgsCache.delete(tgsCache.keys().next().value as string);
  return p;
};

const PHONE = typeof matchMedia === "function" && matchMedia("(pointer: coarse)").matches;
/** Сумма длин JSON живых анимаций: ~200 МБ кучи на телефоне, ~400 МБ на компьютере.
 *  Обычный стикер Telegram — 100–300 КБ JSON, их влезает с десяток и больше. */
const LIVE_BUDGET = PHONE ? 3_000_000 : 6_000_000;
const LIVE_MAX = PHONE ? 12 : 24;

type Poster = { url: string; w: number };
const POSTER_MAX = 300;
const posters = new Map<string, Poster>();
const posterFor = (src: string, w: number) => {
  const p = posters.get(src);
  // Мельче нужного больше чем на четверть — размыто, нарисуем заново.
  return p && p.w >= w * 0.75 ? p : null;
};
const keepPoster = (src: string, p: Poster) => {
  const old = posters.get(src);
  if (old && old.w > p.w) return;
  posters.delete(src);
  posters.set(src, p);
  while (posters.size > POSTER_MAX) posters.delete(posters.keys().next().value as string);
};

const live = new Set<Player>();
let liveWeight = 0;
const queue: Player[] = [];

/** Выдать места ждущим (строго по очереди), остальным — застывший кадр. */
function pump() {
  while (queue.length) {
    const p = queue[0];
    const fits = live.size === 0 || (live.size < LIVE_MAX && liveWeight + p.weight <= LIVE_BUDGET);
    if (!fits) break;
    queue.shift();
    p.start();
  }
  schedulePosters();
}

let posterTimer: ReturnType<typeof setTimeout> | null = null;
/** Застывший кадр ждущим — по одному за задачу: собрать анимацию тяжёлого
 *  стикера — десятки миллисекунд. */
function schedulePosters() {
  if (posterTimer) return;
  const next = queue.find((p) => p.needsPoster());
  if (!next) return;
  posterTimer = setTimeout(() => {
    posterTimer = null;
    if (next.state === "waiting" && next.needsPoster()) next.drawPoster();
    schedulePosters();
  }, 16);
}

let io: IntersectionObserver | null = null;
const byEl = new Map<Element, Player>();
const observe = (el: Element, p: Player) => {
  io = io || new IntersectionObserver((entries) => {
    for (const e of entries) byEl.get(e.target)?.setVisible(e.isIntersecting);
  }, { rootMargin: "60px" });
  byEl.set(el, p);
  io.observe(el);
};
const unobserve = (el: Element) => { byEl.delete(el); io?.unobserve(el); };

type Renderer = "canvas" | "svg";

class Player {
  state: "idle" | "waiting" | "live" | "done" = "idle";
  weight = 0;
  private anim: AnimationItem | null = null;
  private data: object | null = null;
  private visible = false;
  private disposed = false;
  private loading = false;
  // Застывший кадр пробовали рисовать — второй раз не пытаемся.
  private posterTried = false;

  constructor(private el: HTMLElement, private src: string, private loop: boolean, private renderer: Renderer, private onError: () => void) {
    observe(el, this);
  }

  private width() { return Math.round((this.el.clientWidth || 64) * (window.devicePixelRatio || 1)); }

  setVisible(v: boolean) {
    if (this.disposed || this.visible === v) return;
    this.visible = v;
    if (v) this.want();
    else this.unwant();
  }

  private want() {
    if (this.state !== "idle" || this.loading) return;
    const cached = this.renderer === "canvas" ? posterFor(this.src, this.width()) : null;
    if (cached) this.showPoster(cached.url);
    if (this.data) { this.enqueue(); return; }
    this.loading = true;
    Promise.all([loadLottie(), loadTgs(this.src)]).then(([, data]) => {
      this.loading = false;
      if (this.disposed || !this.visible || this.state !== "idle") return;
      this.data = data;
      this.weight = tgsWeight.get(data) || 200_000;
      this.enqueue();
    }).catch(() => {
      this.loading = false;
      if (!this.disposed) this.onError();
    });
  }

  private enqueue() {
    this.state = "waiting";
    queue.push(this);
    pump();
  }

  private unwant() {
    if (this.state === "waiting") {
      const i = queue.indexOf(this);
      if (i >= 0) queue.splice(i, 1);
      this.state = "idle";
    } else if (this.state === "live") {
      this.stopLive(true);
      this.state = "idle";
      pump();
    }
    // Разобранное держит кэш (если ещё не вытеснено) — не держим сами.
    if (this.state === "idle") this.data = null;
  }

  needsPoster() { return this.renderer === "canvas" && !this.posterTried && !!this.data && !posterFor(this.src, this.width()); }

  /** Первый кадр — временной анимацией: собрать, снять, уничтожить. */
  drawPoster() {
    this.posterTried = true;
    void loadLottie().then((lottie) => {
      if (this.state !== "waiting" || !this.data) return;
      try {
        const a = lottie.loadAnimation({ container: this.el, renderer: "canvas", loop: false, autoplay: false, animationData: this.data });
        // Без шрифтов и картинок (как у .tgs) lottie собирается сразу; иначе холст пуст.
        if (a.isLoaded) { a.goToAndStop(0, true); this.snapshot(); }
        a.destroy();
      } catch { /* не нарисовалось — подождёт без кадра */ }
    });
  }

  start() {
    this.state = "live";
    live.add(this);
    liveWeight += this.weight;
    void loadLottie().then((lottie) => {
      if (this.state !== "live" || !this.data) return;
      const a = lottie.loadAnimation({ container: this.el, renderer: this.renderer, loop: this.loop, autoplay: true, animationData: this.data });
      this.anim = a;
      // Первый кадр нарисован — застывший больше не нужен (иначе просвечивает).
      if (a.isLoaded) this.hidePoster(); else a.addEventListener("DOMLoaded", () => this.hidePoster());
      a.addEventListener(this.loop ? "loopComplete" : "complete", () => setTimeout(() => this.cycled(), 0));
    });
  }

  /** Проиграл круг: другие ждут — уступить место и встать в конец очереди. */
  private cycled() {
    if (this.state !== "live" || this.disposed) return;
    if (!this.loop) {
      this.stopLive(true);
      this.state = "done";
      pump();
      return;
    }
    if (!queue.length) return;
    this.stopLive(true);
    this.state = "idle";
    if (this.visible) this.enqueue(); else pump();
  }

  private stopLive(keepFrame: boolean) {
    if (keepFrame) this.snapshot();
    this.anim?.destroy();
    this.anim = null;
    if (live.delete(this)) liveWeight -= this.weight;
  }

  private snapshot() {
    if (this.renderer !== "canvas") return;
    const c = this.el.querySelector("canvas");
    if (!c || !c.width) return;
    try {
      const p = { url: c.toDataURL("image/png"), w: c.width };
      keepPoster(this.src, p);
      this.showPoster(p.url);
    } catch { /* холст недоступен — без кадра */ }
  }

  private showPoster(url: string) {
    const s = this.el.style;
    s.backgroundImage = `url("${url}")`;
    s.backgroundSize = "contain";
    s.backgroundPosition = "center";
    s.backgroundRepeat = "no-repeat";
  }

  private hidePoster() { this.el.style.backgroundImage = ""; }

  dispose() {
    this.disposed = true;
    unobserve(this.el);
    const i = queue.indexOf(this);
    if (i >= 0) queue.splice(i, 1);
    const wasLive = this.state === "live";
    this.stopLive(false);
    this.state = "idle";
    this.data = null;
    if (wasLive || i >= 0) pump();
  }
}

/** Проигрывать .tgs в элементе под присмотром бюджета; вернуть — снять. */
export function mountTgs(el: HTMLElement, src: string, opts: { loop?: boolean; renderer?: Renderer; onError: () => void }): () => void {
  const p = new Player(el, src, opts.loop ?? true, opts.renderer || "canvas", opts.onError);
  return () => p.dispose();
}

/** Для проверок: сколько живых и сколько ждут. */
export const tgsStats = () => ({ live: live.size, weight: liveWeight, waiting: queue.length, cached: tgsCache.size, posters: posters.size });
