import type { AnimationItem } from "lottie-web";
import type { DotLottie } from "@lottiefiles/dotlottie-web";

/**
 * Анимированные стикеры и эмодзи .tgs (Lottie в gzip) — не больше, чем
 * выдержит память.
 *
 * Движок — ThorVG (@lottiefiles/dotlottie-web, WebAssembly), как rlottie у
 * Telegram. lottie-web строит из JSON дерево объектов в куче JS — ~70 байт
 * на байт JSON: стикер пака «Kolobki» (~3000 фигур) стоил 35–100 МБ, весь
 * пак из 50 разом — 2,6 ГБ кучи и 4 кадра в секунду. Открыл пак — окно
 * компьютера падало (баг-репорт b3103cc9), WebView iPhone убивала система
 * (59841892). ThorVG на тех же 50 — ~11 МБ на стикер и 44 кадра в секунду.
 * lottie-web остался для перекрашиваемых эмодзи (им нужен svg: цвет текста
 * задаёт CSS) и про запас — если WebAssembly не завёлся.
 *
 * Память WebAssembly назад системе не отдаётся, поэтому и с ThorVG:
 *  • анимация живёт, только пока стикер на экране (общий IntersectionObserver);
 *    ушёл с экрана — уничтожается, остаётся застывший кадр;
 *  • живые вместе весят не больше бюджета (длина JSON; на телефоне меньше);
 *    не влезли — ждут в очереди с застывшим кадром, а играющие уступают место
 *    после каждого круга — анимируются все, по очереди;
 *  • застывший кадр ждущим рисуется заранее, по одному за раз, и кэшируется;
 *    тексты .tgs — тоже, но не больше TGS_CACHE_MAX.
 */
export const loadLottie = () => import("lottie-web").then((m) => m.default);

let thorPromise: Promise<typeof DotLottie> | null = null;
/** ThorVG и его wasm — со своего сайта, а не с CDN пакета (jsdelivr из России
 *  открывается не всегда). Грузится при первом .tgs. */
const loadThor = () => (thorPromise = thorPromise || Promise.all([
  import("@lottiefiles/dotlottie-web"),
  import("@lottiefiles/dotlottie-web/dotlottie-player.wasm?url"),
]).then(([m, wasm]) => {
  m.DotLottie.setWasmUrl(wasm.default);
  return m.DotLottie;
}));
/** null — ещё не пробовали; false — WebAssembly не завёлся, рисуем lottie-web. */
let thorOk: boolean | null = typeof WebAssembly === "object" ? null : false;

const TGS_CACHE_MAX = 40;
const tgsCache = new Map<string, Promise<string>>();

/** Текст JSON анимации (gzip распакован). */
const loadTgsText = (url: string) => {
  let p = tgsCache.get(url);
  if (p) {
    // Свежий — в конец: выбрасываем самые давние.
    tgsCache.delete(url);
    tgsCache.set(url, p);
    return p;
  }
  p = Promise.all([fetch(url).then((r) => r.arrayBuffer()), import("pako")])
    .then(([buf, { inflate }]) => new TextDecoder().decode(inflate(new Uint8Array(buf))));
  p.catch(() => tgsCache.delete(url));
  tgsCache.set(url, p);
  while (tgsCache.size > TGS_CACHE_MAX) tgsCache.delete(tgsCache.keys().next().value as string);
  return p;
};
/** Разобранная анимация — для lottie-web. */
export const loadTgs = (url: string): Promise<object> => loadTgsText(url).then((t) => JSON.parse(t));

const PHONE = typeof matchMedia === "function" && matchMedia("(pointer: coarse)").matches;
/** Сумма длин JSON живых анимаций (~15 байт памяти ThorVG на байт): ~150 МБ на
 *  телефоне, ~300 МБ на компьютере. Обычный стикер Telegram — 100–300 КБ JSON. */
const LIVE_BUDGET = PHONE ? 10_000_000 : 20_000_000;
const LIVE_MAX = PHONE ? 16 : 40;
/** lottie-web на тот же JSON тратит памяти впятеро больше. */
const LOTTIE_WEIGHT = 5;
/** Плотнее 2× стикер не рисуем: на экране 3× разницы не видно, а кадр вдвое дороже. */
const dpr = () => Math.min(2, window.devicePixelRatio || 1);

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

let posterBusy = false;
/** Застывший кадр ждущим — по одному за раз. */
function schedulePosters() {
  if (posterBusy) return;
  const next = queue.find((p) => p.needsPoster());
  if (!next) return;
  posterBusy = true;
  setTimeout(() => {
    void next.drawPoster().finally(() => { posterBusy = false; schedulePosters(); });
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

/** Холст для ThorVG — во всю площадь стикера, как у lottie-web. */
const canvasIn = (el: HTMLElement) => {
  const c = document.createElement("canvas");
  c.style.cssText = "width:100%;height:100%;display:block";
  el.appendChild(c);
  return c;
};

const thorConfig = (canvas: HTMLCanvasElement, data: string, loop: boolean, autoplay: boolean) => ({
  canvas, data, loop, autoplay,
  // Видимость ведём сами (общий наблюдатель выше), свой ему не нужен.
  renderConfig: { freezeOnOffscreen: false, autoResize: false, devicePixelRatio: dpr() },
});

type Renderer = "canvas" | "svg";

class Player {
  state: "idle" | "waiting" | "live" | "done" = "idle";
  weight = 0;
  /** Снять живую анимацию (любым движком). */
  private kill: (() => void) | null = null;
  private text: string | null = null;
  private visible = false;
  private disposed = false;
  private loading = false;
  // Застывший кадр пробовали рисовать — второй раз не пытаемся.
  private posterTried = false;
  private posterJob: Promise<void> | null = null;

  constructor(private el: HTMLElement, private src: string, private loop: boolean, private renderer: Renderer, private onError: () => void) {
    observe(el, this);
  }

  private thor() { return this.renderer === "canvas" && thorOk !== false; }
  private width() { return Math.round((this.el.clientWidth || 64) * dpr()); }

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
    this.loading = true;
    // Не загрузился сам ThorVG — дальше всё через lottie-web.
    const engine = this.thor()
      ? loadThor().then(() => {}, () => { thorOk = false; return loadLottie().then(() => {}); })
      : loadLottie().then(() => {});
    Promise.all([engine, loadTgsText(this.src)]).then(([, text]) => {
      this.loading = false;
      if (this.disposed || !this.visible || this.state !== "idle") return;
      this.text = text;
      this.weight = text.length * (this.thor() ? 1 : LOTTIE_WEIGHT);
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
    // Текст держит кэш (если ещё не вытеснен) — не держим сами.
    if (this.state === "idle") this.text = null;
  }

  needsPoster() { return this.renderer === "canvas" && !this.posterTried && this.text != null && !posterFor(this.src, this.width()); }

  /** Первый кадр — временной анимацией: собрать, снять, уничтожить. */
  drawPoster(): Promise<void> {
    this.posterTried = true;
    if (this.state !== "waiting" || this.text == null) return Promise.resolve();
    const text = this.text;
    const job = this.thor()
      ? loadThor().then((DL) => new Promise<void>((done) => {
          const c = canvasIn(this.el);
          const a = new DL(thorConfig(c, text, false, false));
          let over = false;
          const finish = (ok: boolean) => {
            if (over) return;
            over = true;
            if (ok) { thorOk = true; this.snapshot(); }
            a.destroy();
            c.remove();
            done();
          };
          a.addEventListener("load", () => a.setFrame(0));
          a.addEventListener("render", () => finish(true));
          a.addEventListener("loadError", () => finish(false));
          setTimeout(() => finish(false), 3000);
        }))
      : loadLottie().then((lottie) => {
          const a = lottie.loadAnimation({ container: this.el, renderer: "canvas", loop: false, autoplay: false, animationData: JSON.parse(text) });
          // Без шрифтов и картинок (как у .tgs) lottie собирается сразу; иначе холст пуст.
          if (a.isLoaded) { a.goToAndStop(0, true); this.snapshot(); }
          a.destroy();
        });
    this.posterJob = job.catch(() => {}).finally(() => { this.posterJob = null; });
    return this.posterJob;
  }

  start() {
    this.state = "live";
    live.add(this);
    liveWeight += this.weight;
    // Пока рисуется застывший кадр, его холст ещё в стикере — дождаться.
    const go = () => {
      if (this.state !== "live" || this.text == null) return;
      if (this.thor()) this.startThor(this.text); else this.startLottie(this.text);
    };
    if (this.posterJob) void this.posterJob.then(go); else go();
  }

  private startThor(text: string) {
    void loadThor().then((DL) => {
      if (this.state !== "live" || this.kill) return;
      const c = canvasIn(this.el);
      const a = new DL(thorConfig(c, text, this.loop, true));
      this.kill = () => { a.destroy(); c.remove(); };
      // Первый кадр нарисован — застывший больше не нужен (иначе просвечивает).
      const first = () => { a.removeEventListener("render", first); thorOk = true; this.hidePoster(); };
      a.addEventListener("render", first);
      a.addEventListener(this.loop ? "loop" : "complete", () => setTimeout(() => this.cycled(), 0));
      a.addEventListener("loadError", () => setTimeout(() => this.thorFailed(), 0));
    });
  }

  /** ThorVG не справился: ни разу не работал — значит, движок (дальше
   *  lottie-web), иначе — сам файл. */
  private thorFailed() {
    if (this.state !== "live") return;
    this.kill?.();
    this.kill = null;
    if (thorOk === null) {
      thorOk = false;
      if (this.text != null) this.startLottie(this.text);
    } else {
      this.stopLive(false);
      this.state = "done";
      this.onError();
      pump();
    }
  }

  private startLottie(text: string) {
    void loadLottie().then((lottie) => {
      if (this.state !== "live" || this.kill) return;
      const a: AnimationItem = lottie.loadAnimation({ container: this.el, renderer: this.renderer, loop: this.loop, autoplay: true, animationData: JSON.parse(text) });
      this.kill = () => a.destroy();
      if (a.isLoaded) this.hidePoster(); else a.addEventListener("DOMLoaded", () => this.hidePoster());
      a.addEventListener(this.loop ? "loopComplete" : "complete", () => setTimeout(() => this.cycled(), 0));
    }).catch(() => { if (this.state === "live") { this.stopLive(false); this.state = "done"; this.onError(); pump(); } });
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
    this.kill?.();
    this.kill = null;
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
    this.text = null;
    if (wasLive || i >= 0) pump();
  }
}

/** Проигрывать .tgs в элементе под присмотром бюджета; вернуть — снять. */
export function mountTgs(el: HTMLElement, src: string, opts: { loop?: boolean; renderer?: Renderer; onError: () => void }): () => void {
  const p = new Player(el, src, opts.loop ?? true, opts.renderer || "canvas", opts.onError);
  return () => p.dispose();
}

/** Для проверок: сколько живых и сколько ждут, каким движком. */
export const tgsStats = () => ({ live: live.size, weight: liveWeight, waiting: queue.length, cached: tgsCache.size, posters: posters.size, engine: thorOk === false ? "lottie-web" : thorOk ? "thorvg" : "?" });
