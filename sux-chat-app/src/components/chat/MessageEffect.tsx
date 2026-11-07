import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Capacitor } from "@capacitor/core";
import { mediaUrl } from "@/api/client";
import { isMp4, isTgs, isWebm } from "./StickerView";
import { animVideo } from "@/lib/animMedia";
import { notoCode, notoSvgUrl } from "@/lib/notoEmoji";
import { reducedMotion } from "@/lib/navAnim";
import type { EffectPlay } from "@/lib/effects";
import { tgsSource } from "@/lib/tgsPlayer";
import { useCachedImage } from "@/lib/imageCache";
import { applog } from "@/lib/applog";
import { FormattedText } from "@/lib/format";

/**
 * Эффект получения сообщения (lib/effects) поверх всего экрана, тапы
 * пропускает насквозь:
 *   • burst — «Глюк»: копии высыпаются по одной, резко, с нарастающим темпом
 *     и вибрацией, в случайных местах и размерах (одна — почти во весь экран);
 *     набралось штук двадцать — все вместе тают;
 *   • rain — «Ливень»: копии разного размера падают сверху с отскоком и
 *     ложатся друг на друга кучей внизу экрана; упали все — куча тает;
 *   • scream — «Скример»: одна копия рывком выскакивает во весь экран на
 *     тёмной вспышке, трясётся с серией сильных вибраций и пропадает;
 *   • rage — «Ярость»: копия в центре трясётся всё сильнее, пузырь снизу
 *     доверху заливается красным (у стикера — красное свечение), по краям
 *     экрана пульсирует красное, вибрация нарастает.
 * Двигаем только transform и opacity. Системное «Уменьшить движение» — без эффекта.
 *
 * Текст — копией настоящего пузыря: целиком, с разметкой (FormattedText), в
 * несколько строк. Его размер меряем один раз скрытой копией, а копии в
 * анимации — тот же пузырь, уменьшенный transform-ом, чтобы влез целиком.
 * Раньше это была строка до 24 знаков без разметки — длинное обрезалось.
 *
 * Анимированный стикер играет один раз — на все копии: .tgs — одной анимацией
 * (tgsSource), видео — одним <video>; копии — <canvas>, в которые каждый кадр
 * рисуется картинка источника. Раньше каждая из двадцати копий была своим
 * стикером: у тяжёлого .tgs это двадцать анимаций и столько же застывших
 * кадров, у видео — двадцать декодеров, и эффект шёл рывками.
 *
 * Эффект начинается, когда то, что он показывает, готово: картинка стикера —
 * из кэша картинок (стикер только что был в панели), анимация или видео —
 * первый кадр источника, эмодзи — его картинка; ждём не дольше MEDIA_WAIT.
 * Раньше копии грузили картинку из сети заново, и на медленной сети
 * «Скример» (1,6 с) успевал закончиться невидимым (баг-репорт c0eed388).
 */
type Piece = { id: number; x: number; y: number; w: number; h: number; rot: number; k?: number };

/** Ширина пузыря-копии до уменьшения: дальше переносится на строки. */
const BUBBLE_MAX_W = 280;
/** Пузырь сообщения для копий: как в ленте, с разметкой. */
const Bubble = ({ text, entities, rage }: { text: string; entities?: EffectPlay["entities"]; rage?: boolean }) => (
  <div className="msg-bubble msg-own relative isolate overflow-hidden px-3 py-2 shadow-lg whitespace-pre-wrap"
    style={{ fontSize: 16, lineHeight: 1.35, width: "max-content", maxWidth: BUBBLE_MAX_W }} data-fx-bubble>
    {rage && <div data-fx-fill className="absolute inset-0 -z-10" style={{ background: "linear-gradient(0deg, #b90000, #ff2b2b)", clipPath: "inset(100% 0 0 0)" }} />}
    <FormattedText text={text} entities={entities} seed="fx" />
  </div>
);

const haptic = () => {
  if (Capacitor.isNativePlatform()) {
    import("@capacitor/haptics").then(({ Haptics, ImpactStyle }) => Haptics.impact({ style: ImpactStyle.Light })).catch(() => {});
  } else {
    try { navigator.vibrate?.(12); } catch { /* нет вибрации */ }
  }
};

const pxRatio = () => Math.min(2, window.devicePixelRatio || 1);

/** Кадр источника — в копию, вписанным по центру. */
const drawInto = (c: HTMLCanvasElement, src: HTMLCanvasElement | HTMLVideoElement) => {
  const ctx = c.getContext("2d");
  if (!ctx) return;
  const sw = src instanceof HTMLVideoElement ? src.videoWidth : src.width;
  const sh = src instanceof HTMLVideoElement ? src.videoHeight : src.height;
  if (!sw || !sh) return;
  const k = Math.min(c.width / sw, c.height / sh);
  const w = sw * k, h = sh * k;
  ctx.clearRect(0, 0, c.width, c.height);
  ctx.drawImage(src, (c.width - w) / 2, (c.height - h) / 2, w, h);
};

/** Один источник анимированного стикера на все копии (см. выше). */
function useStickerMirror(mode: "tgs" | "video" | "img" | "none", src: string | null, video: string | null) {
  const canvases = useRef(new Set<HTMLCanvasElement>());
  // Источник не завёлся — копии картинкой (у видео в адресе первый кадр).
  const [failed, setFailed] = useState(false);
  // Первый кадр источника готов — можно начинать эффект.
  const [ready, setReady] = useState(false);
  const readyRef = useRef(false);
  useEffect(() => {
    if ((mode !== "tgs" && mode !== "video") || !src) return;
    let alive = true;
    let raf = 0;
    let source: HTMLCanvasElement | HTMLVideoElement | null = null;
    let ready = () => false;
    let destroy = () => {};
    if (mode === "tgs") {
      void tgsSource(src, 320).then((s) => {
        if (!alive) { s.destroy(); return; }
        source = s.canvas;
        ready = () => true;
        destroy = s.destroy;
      }).catch(() => { if (alive) setFailed(true); });
    } else if (video) {
      const v = document.createElement("video");
      v.muted = true; v.loop = true; v.playsInline = true; v.preload = "auto";
      v.setAttribute("playsinline", "");
      v.style.cssText = "position:fixed;left:-10000px;top:0;width:2px;height:2px;pointer-events:none";
      v.src = video;
      document.body.appendChild(v);
      // Автозапуск запрещён (энергосбережение iOS) — первый кадр всё равно нарисуется.
      void v.play().catch(() => {});
      v.addEventListener("error", () => { if (alive) setFailed(true); });
      source = v;
      ready = () => v.readyState >= 2 && v.videoWidth > 0;
      destroy = () => { v.pause(); v.removeAttribute("src"); v.load(); v.remove(); };
    }
    const tick = () => {
      if (source && ready()) {
        if (!readyRef.current) { readyRef.current = true; setReady(true); }
        for (const c of canvases.current) {
          if (!c.isConnected) { canvases.current.delete(c); continue; }
          drawInto(c, source);
        }
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => { alive = false; cancelAnimationFrame(raf); destroy(); canvases.current.clear(); };
  }, [mode, src, video]);
  const register = useCallback((c: HTMLCanvasElement | null) => { if (c) canvases.current.add(c); }, []);
  return { register, failed, ready };
}

/** Эмодзи картинкой Noto; картинки нет (зеркало недоступно) — системным символом. */
const EmojiPiece = ({ e }: { e: string }) => {
  const [failed, setFailed] = useState(false);
  const code = notoCode(e);
  if (code && !failed) return <img src={notoSvgUrl(code)} alt="" draggable={false} onError={() => setFailed(true)} className="w-full h-full object-contain drop-shadow-lg" />;
  return <span className="w-full h-full flex items-center justify-center leading-none drop-shadow-lg" style={{ fontSize: "80cqh" }}>{e}</span>;
};

/** «Скример»: удар вибрации и серия сильных толчков, пока трясётся. */
const screamHaptics = (at: (ms: number, fn: () => void) => void) => {
  if (Capacitor.isNativePlatform()) {
    import("@capacitor/haptics").then(({ Haptics, ImpactStyle }) => {
      void Haptics.vibrate({ duration: 500 }).catch(() => {});
      for (let i = 0; i < 9; i++) at(60 + i * 115, () => { void Haptics.impact({ style: ImpactStyle.Heavy }).catch(() => {}); });
    }).catch(() => {});
  } else {
    try { navigator.vibrate?.([90, 40, 90, 40, 90, 40, 220]); } catch { /* нет вибрации */ }
  }
};

/** Дольше этого готовности картинки не ждём — начинаем как есть. */
const MEDIA_WAIT = 2500;
const BURST_COUNT = 20;
const BURST_DELAYS = [0, 1000, 520, 360, 270, 210, 170, 140, 120, 105, 95, 85];
const RAIN_COUNT = 24;
const SCREAM_MS = 1600;
const RAGE_MS = 2300;

/** «Ярость»: удары всё чаще и сильнее, в конце — длинная вибрация. */
const rageHaptics = (at: (ms: number, fn: () => void) => void) => {
  const times: number[] = [];
  for (let t = 150, gap = 260; t < RAGE_MS - 350; t += gap, gap = Math.max(70, gap * 0.82)) times.push(t);
  if (Capacitor.isNativePlatform()) {
    import("@capacitor/haptics").then(({ Haptics, ImpactStyle }) => {
      times.forEach((t, i) => at(t, () => {
        const f = i / times.length;
        void Haptics.impact({ style: f < 0.35 ? ImpactStyle.Light : f < 0.7 ? ImpactStyle.Medium : ImpactStyle.Heavy }).catch(() => {});
      }));
      at(RAGE_MS - 350, () => { void Haptics.vibrate({ duration: 350 }).catch(() => {}); });
    }).catch(() => {});
  } else {
    try { navigator.vibrate?.([30, 160, 40, 120, 50, 90, 60, 70, 80, 50, 100, 40, 350]); } catch { /* нет вибрации */ }
  }
};

const MessageEffect = ({ play, onDone }: { play: EffectPlay; onDone: () => void }) => {
  const [pieces, setPieces] = useState<Piece[]>([]);
  const [fading, setFading] = useState(false);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  const isText = !play.sticker && !play.emoji?.length;
  const src = play.sticker ? mediaUrl(play.sticker) : null;
  const video = src ? (isWebm(src) ? src : animVideo(src) || (isMp4(src) ? src : null)) : null;
  const mode = !src ? "none" : isTgs(src) ? "tgs" : video ? "video" : "img";
  const mirror = useStickerMirror(mode, src, video);
  // Картинка стикера — из кэша картинок (у видео — его первый кадр, если видео не завелось).
  const imgSrc = useCachedImage(mode === "img" || mirror.failed ? src : null);
  // Картинка эмодзи (Noto) — заранее, чтобы копии не появлялись пустыми.
  const [emojiReady, setEmojiReady] = useState(!play.emoji?.length);
  useEffect(() => {
    const e = play.emoji?.[0];
    const code = e ? notoCode(e) : null;
    if (!code) { setEmojiReady(true); return; }
    const im = new Image();
    im.onload = im.onerror = () => setEmojiReady(true);
    im.src = notoSvgUrl(code);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const mediaReady = mode === "none" ? emojiReady : mode === "img" || mirror.failed ? !!imgSrc : mirror.ready;
  const [waited, setWaited] = useState(false);
  useEffect(() => { const t = setTimeout(() => setWaited(true), MEDIA_WAIT); return () => clearTimeout(t); }, []);
  const go = mediaReady || waited;
  const bornAt = useRef(performance.now());
  // Размер пузыря-копии до уменьшения — по скрытой копии (isText).
  const measureRef = useRef<HTMLDivElement>(null);
  const base = useRef({ w: 160, h: 40 });

  useEffect(() => {
    if (!go) return;
    if (reducedMotion()) {
      applog.info(`effect ${play.kind}: пропущен — в системе включено «Уменьшить движение»`);
      onDone();
      return;
    }
    applog.info(`effect ${play.kind} (${mode}${mediaReady ? "" : ", не дождались картинки"}) через ${Math.round(performance.now() - bornAt.current)} мс`);
    const vw = window.innerWidth, vh = window.innerHeight;
    const at = (ms: number, fn: () => void) => { timers.current.push(setTimeout(fn, ms)); };
    if (isText && measureRef.current) {
      const r = measureRef.current.getBoundingClientRect();
      if (r.width > 0 && r.height > 0) base.current = { w: r.width, h: r.height };
    }
    const { w: bw, h: bh } = base.current;
    // Пузырь целиком не шире 92 % и не выше 70 % экрана.
    const fitK = (k: number) => Math.min(k, (vw * 0.92) / bw, (vh * 0.7) / bh);
    // Размер копии: текст — пузырь, уменьшенный (k) до «размера» копии; остальное — квадрат.
    const shape = (size: number) => {
      if (!isText) return { w: size, h: size };
      const k = fitK(size / Math.max(bw, 120));
      return { w: bw * k, h: bh * k, k };
    };
    const center = (big: number) => {
      const { w, h, k } = isText ? (() => { const k = fitK(big); return { w: bw * k, h: bh * k, k }; })()
        : { w: Math.round(Math.min(vw, vh) * 0.9 * Math.min(1, big / 2.5)), h: Math.round(Math.min(vw, vh) * 0.9 * Math.min(1, big / 2.5)), k: undefined };
      return { id: 0, x: Math.round((vw - w) / 2), y: Math.round((vh - h) / 2), w, h, k, rot: 0 };
    };
    let t = 0;
    if (play.kind === "scream") {
      setPieces([center(2.5)]);
      screamHaptics(at);
      at(SCREAM_MS + 100, onDone);
      return () => { timers.current.forEach(clearTimeout); timers.current = []; };
    }
    if (play.kind === "rage") {
      setPieces([center(1.9)]);
      rageHaptics(at);
      at(RAGE_MS + 100, onDone);
      return () => { timers.current.forEach(clearTimeout); timers.current = []; };
    }
    if (play.kind === "rain") {
      // Куча: высота по колонкам; копия ложится на самую высокую из тех, что
      // под ней, наполовину в неё утопая, и сама её поднимает. Выше 45 %
      // экрана куча не растёт.
      const cols = 16, colW = vw / cols;
      const heights = new Array(cols).fill(0);
      for (let i = 0; i < RAIN_COUNT; i++) {
        t += i === 0 ? 0 : Math.max(70, 190 - i * 6);
        at(t, () => {
          const { w, h, k } = shape(Math.round(40 + Math.random() * 80));
          const x = Math.round(Math.random() * Math.max(0, vw - w));
          const c0 = Math.max(0, Math.floor(x / colW)), c1 = Math.min(cols - 1, Math.floor((x + w) / colW));
          let base = 0;
          for (let c = c0; c <= c1; c++) base = Math.max(base, heights[c]);
          const y = Math.max(vh * 0.55, vh - base - h * 0.85);
          for (let c = c0; c <= c1; c++) heights[c] = Math.max(heights[c], vh - y - h * 0.5);
          setPieces((prev) => [...prev, { id: i, x, y, w, h, k, rot: Math.round(-35 + Math.random() * 70) }]);
          if (i % 3 === 0) at(620, haptic);
        });
      }
      t += 900 + 1300;
    } else {
      const giantAt = 8 + Math.floor(Math.random() * 8); // одна огромная — где-то в середине
      for (let i = 0; i < BURST_COUNT; i++) {
        t += BURST_DELAYS[Math.min(i, BURST_DELAYS.length - 1)];
        at(t, () => {
          const size = i === giantAt ? Math.round(Math.min(vw, vh) * 0.95) : Math.round(90 + Math.random() * 150);
          const { w, h, k } = shape(size);
          setPieces((prev) => [...prev, {
            id: i, w, h, k,
            x: Math.round(Math.random() * Math.max(0, vw - w)),
            y: Math.round(Math.random() * Math.max(0, vh - h)),
            rot: Math.round(-25 + Math.random() * 50),
          }]);
          haptic();
        });
      }
      t += 700;
    }
    at(t, () => setFading(true));
    at(t + 1000, onDone);
    return () => { timers.current.forEach(clearTimeout); timers.current = []; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [go]);

  // «Ливень»: падение с ускорением, отскок и доворот; «Скример»: рывок и
  // тряска — Web Animations на копии.
  const animate = (p: Piece) => (el: HTMLDivElement | null) => {
    if (!el || el.dataset.played) return;
    el.dataset.played = "1";
    const at = (dx: number, dy: number, s: number, r: number) => `translate(${p.x + dx}px, ${p.y + dy}px) scale(${s}) rotate(${r}deg)`;
    if (play.kind === "rain") {
      const land = (dy: number) => `translate(${p.x}px, ${p.y - dy}px) rotate(${p.rot}deg)`;
      el.animate([
        { transform: `translate(${p.x}px, ${-p.h - 20}px) rotate(0deg)`, easing: "cubic-bezier(0.5, 0, 1, 0.55)" },
        { transform: land(0), offset: 0.78, easing: "cubic-bezier(0.2, 0.7, 0.4, 1)" },
        { transform: land(Math.min(18, p.h * 0.15)), offset: 0.9, easing: "cubic-bezier(0.6, 0, 0.8, 0.4)" },
        { transform: land(0) },
      ], { duration: 820, fill: "forwards" });
    } else if (play.kind === "scream") {
      const shake: Keyframe[] = [];
      for (let k = 0; k < 22; k++) {
        const a = 1 - k / 26;  // к концу трясёт слабее
        shake.push({
          transform: at((Math.random() * 2 - 1) * 16 * a, (Math.random() * 2 - 1) * 12 * a, 1 + (k % 2 ? 0.03 : -0.02) * a, (Math.random() * 2 - 1) * 8 * a),
          offset: 0.11 + (0.72 * k) / 22,
        });
      }
      el.animate([
        { transform: at(0, 0, 0.05, 0), opacity: 0, offset: 0 },
        { transform: at(0, 0, 1.2, -6), opacity: 1, offset: 0.05, easing: "cubic-bezier(0.2, 0.8, 0.3, 1)" },
        { transform: at(0, 0, 0.96, 4), offset: 0.09 },
        ...shake,
        { transform: at(0, 0, 1, 0), opacity: 1, offset: 0.86 },
        { transform: at(0, 0, 1.12, 0), opacity: 0, offset: 1 },
      ], { duration: SCREAM_MS, fill: "forwards" });
    } else if (play.kind === "rage") {
      // Появилась — и трясётся всё сильнее и чаще; в конце рывок и пропадает.
      const frames: Keyframe[] = [
        { transform: at(0, 0, 0.6, 0), opacity: 0, offset: 0 },
        { transform: at(0, 0, 1.06, 0), opacity: 1, offset: 0.06, easing: "cubic-bezier(0.2, 0.8, 0.3, 1)" },
        { transform: at(0, 0, 1, 0), offset: 0.1 },
      ];
      const n = 34;
      for (let k = 0; k < n; k++) {
        const a = 0.15 + 0.85 * (k / n) ** 1.4; // нарастает
        frames.push({
          transform: at((Math.random() * 2 - 1) * 14 * a, (Math.random() * 2 - 1) * 9 * a, 1 + 0.06 * a * (k % 2 ? 1 : -0.4), (Math.random() * 2 - 1) * 7 * a),
          offset: 0.1 + (0.76 * (k + 1)) / n,
        });
      }
      frames.push({ transform: at(0, 0, 1.18, 0), opacity: 1, offset: 0.9 }, { transform: at(0, 0, 1.3, 0), opacity: 0, offset: 1 });
      el.animate(frames, { duration: RAGE_MS, fill: "forwards" });
      // Пузырь заливается красным снизу вверх, текст белеет; у стикера и
      // эмодзи — красное свечение и красный оттенок.
      const fill = el.querySelector<HTMLElement>("[data-fx-fill]");
      const bubble = el.querySelector<HTMLElement>("[data-fx-bubble]");
      if (fill && bubble) {
        fill.animate([{ clipPath: "inset(100% 0 0 0)" }, { clipPath: "inset(0% 0 0 0)", offset: 0.75 }, { clipPath: "inset(0% 0 0 0)" }],
          { duration: RAGE_MS, easing: "ease-in", fill: "forwards" });
        bubble.animate([{ color: getComputedStyle(bubble).color }, { color: "#fff", offset: 0.45 }, { color: "#fff" }], { duration: RAGE_MS, fill: "forwards" });
      } else {
        el.animate([
          { filter: "none" },
          { filter: "drop-shadow(0 0 22px rgba(255,20,20,0.95)) sepia(1) saturate(7) hue-rotate(-45deg)", offset: 0.75 },
          { filter: "drop-shadow(0 0 28px rgba(255,20,20,1)) sepia(1) saturate(8) hue-rotate(-45deg)" },
        ], { duration: RAGE_MS, easing: "ease-in", fill: "forwards" });
      }
    }
  };
  // «Ярость»: красное по краям экрана пульсирует всё сильнее.
  const vignette = (el: HTMLDivElement | null) => {
    if (!el || el.dataset.played) return;
    el.dataset.played = "1";
    el.animate([
      { opacity: 0 }, { opacity: 0.35, offset: 0.2 }, { opacity: 0.15, offset: 0.3 }, { opacity: 0.6, offset: 0.5 },
      { opacity: 0.3, offset: 0.6 }, { opacity: 0.85, offset: 0.8 }, { opacity: 0.5, offset: 0.88 }, { opacity: 0 },
    ], { duration: RAGE_MS, fill: "forwards" });
  };
  // Тёмная вспышка «Скримера» — резко темнеет и отпускает.
  const flash = (el: HTMLDivElement | null) => {
    if (!el || el.dataset.played) return;
    el.dataset.played = "1";
    el.animate([
      { opacity: 0 }, { opacity: 0.6, offset: 0.05 }, { opacity: 0.4, offset: 0.3 }, { opacity: 0 },
    ], { duration: SCREAM_MS, fill: "forwards" });
  };

  const body = (p: Piece) => {
    if (src) {
      if ((mode === "tgs" || mode === "video") && !mirror.failed) {
        const k = pxRatio();
        return <canvas ref={mirror.register} width={Math.round(p.w * k)} height={Math.round(p.h * k)} className="w-full h-full" />;
      }
      return <img src={imgSrc || src} alt="" draggable={false} className="w-full h-full object-contain drop-shadow-lg" />;
    }
    if (play.emoji?.length) return <EmojiPiece e={play.emoji[p.id % play.emoji.length]} />;
    // Пузырь в натуральную величину, уменьшенный до размера копии.
    return (
      <div style={{ width: base.current.w, height: base.current.h, transform: `scale(${p.k ?? 1})`, transformOrigin: "0 0" }}>
        <Bubble text={play.text || ""} entities={play.entities} rage={play.kind === "rage"} />
      </div>
    );
  };

  return createPortal(
    <div
      className="fixed inset-0 z-[95] pointer-events-none overflow-hidden"
      style={{ opacity: fading ? 0 : 1, transition: fading ? "opacity 900ms ease-in" : "none" }}
      aria-hidden
    >
      {play.kind === "scream" && <div ref={flash} className="absolute inset-0 bg-black" style={{ opacity: 0 }} />}
      {play.kind === "rage" && <div ref={vignette} className="absolute inset-0" style={{ opacity: 0, boxShadow: "inset 0 0 140px 30px rgba(255,0,0,0.75)" }} />}
      {/* Мерка пузыря: невидимая копия в натуральную величину. */}
      {isText && (
        <div ref={measureRef} className="absolute left-0 top-0" style={{ visibility: "hidden" }}>
          <Bubble text={play.text || ""} entities={play.entities} />
        </div>
      )}
      {pieces.map((p) => (
        <div key={p.id} ref={animate(p)} className="absolute left-0 top-0" style={{
          width: p.w, height: p.h, containerType: "size",
          transform: play.kind === "rain" ? `translate(${p.x}px, ${-p.h - 20}px)`
            : play.kind === "scream" ? `translate(${p.x}px, ${p.y}px) scale(0.05)`
            : play.kind === "rage" ? `translate(${p.x}px, ${p.y}px) scale(0.6)`
            : `translate(${p.x}px, ${p.y}px) rotate(${p.rot}deg)`,
          opacity: play.kind === "scream" || play.kind === "rage" ? 0 : undefined,
        }}>
          {body(p)}
        </div>
      ))}
    </div>,
    document.body,
  );
};

export default MessageEffect;
