import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Capacitor } from "@capacitor/core";
import StickerView from "./StickerView";
import { notoCode, notoSvgUrl } from "@/lib/notoEmoji";
import { reducedMotion } from "@/lib/navAnim";
import type { EffectPlay } from "@/lib/effects";

/**
 * Эффект получения сообщения (lib/effects) поверх всего экрана, тапы
 * пропускает насквозь:
 *   • burst — «Глюк»: копии высыпаются по одной, резко, с нарастающим темпом
 *     и вибрацией, в случайных местах и размерах (одна — почти во весь экран);
 *     набралось штук двадцать — все вместе тают;
 *   • rain — «Ливень»: копии разного размера падают сверху с отскоком и
 *     ложатся друг на друга кучей внизу экрана; упали все — куча тает.
 * Двигаем только transform и opacity. Системное «Уменьшить движение» — без эффекта.
 */
type Piece = { id: number; x: number; y: number; w: number; h: number; rot: number; font?: number };

const haptic = () => {
  if (Capacitor.isNativePlatform()) {
    import("@capacitor/haptics").then(({ Haptics, ImpactStyle }) => Haptics.impact({ style: ImpactStyle.Light })).catch(() => {});
  } else {
    try { navigator.vibrate?.(12); } catch { /* нет вибрации */ }
  }
};

/** Ширина пузырька с текстом заданного кегля. */
let measureCtx: CanvasRenderingContext2D | null = null;
const chipWidth = (text: string, font: number) => {
  try {
    measureCtx = measureCtx || document.createElement("canvas").getContext("2d");
    if (measureCtx) { measureCtx.font = `${font}px system-ui, sans-serif`; return measureCtx.measureText(text).width + font * 1.6; }
  } catch { /* без холста — на глаз */ }
  return text.length * font * 0.6 + font * 1.6;
};

/** Одна копия: стикер, эмодзи (картинкой Noto) или текст пузырьком. */
const Body = ({ play, index, font }: { play: EffectPlay; index: number; font?: number }) => {
  if (play.sticker) return <StickerView url={play.sticker} className="w-full h-full object-contain drop-shadow-lg" />;
  if (play.emoji?.length) return <EmojiPiece e={play.emoji[index % play.emoji.length]} />;
  return (
    <span className="msg-bubble msg-own w-full h-full flex items-center justify-center whitespace-nowrap overflow-hidden px-[0.8em] shadow-lg"
      style={{ fontSize: font }}>{play.text}</span>
  );
};

/** Эмодзи картинкой Noto; картинки нет (зеркало недоступно) — системным символом. */
const EmojiPiece = ({ e }: { e: string }) => {
  const [failed, setFailed] = useState(false);
  const code = notoCode(e);
  if (code && !failed) return <img src={notoSvgUrl(code)} alt="" draggable={false} onError={() => setFailed(true)} className="w-full h-full object-contain drop-shadow-lg" />;
  return <span className="w-full h-full flex items-center justify-center leading-none drop-shadow-lg" style={{ fontSize: "80cqh" }}>{e}</span>;
};

const BURST_COUNT = 20;
const BURST_DELAYS = [0, 1000, 520, 360, 270, 210, 170, 140, 120, 105, 95, 85];
const RAIN_COUNT = 24;

const MessageEffect = ({ play, onDone }: { play: EffectPlay; onDone: () => void }) => {
  const [pieces, setPieces] = useState<Piece[]>([]);
  const [fading, setFading] = useState(false);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  const isText = !play.sticker && !play.emoji?.length;

  useEffect(() => {
    if (reducedMotion()) { onDone(); return; }
    const vw = window.innerWidth, vh = window.innerHeight;
    const at = (ms: number, fn: () => void) => { timers.current.push(setTimeout(fn, ms)); };
    // Размер копии: текст — пузырёк по кеглю, остальное — квадрат.
    const shape = (size: number) => {
      if (!isText) return { w: size, h: size };
      const font = Math.round(size / 4.2);
      return { w: Math.min(vw * 0.85, chipWidth(play.text || "", font)), h: Math.round(font * 2), font };
    };
    let t = 0;
    if (play.kind === "rain") {
      // Куча: высота по колонкам; копия ложится на самую высокую из тех, что
      // под ней, наполовину в неё утопая, и сама её поднимает. Выше 45 %
      // экрана куча не растёт.
      const cols = 16, colW = vw / cols;
      const heights = new Array(cols).fill(0);
      for (let i = 0; i < RAIN_COUNT; i++) {
        t += i === 0 ? 0 : Math.max(70, 190 - i * 6);
        at(t, () => {
          const { w, h, font } = shape(Math.round(40 + Math.random() * 80));
          const x = Math.round(Math.random() * Math.max(0, vw - w));
          const c0 = Math.max(0, Math.floor(x / colW)), c1 = Math.min(cols - 1, Math.floor((x + w) / colW));
          let base = 0;
          for (let c = c0; c <= c1; c++) base = Math.max(base, heights[c]);
          const y = Math.max(vh * 0.55, vh - base - h * 0.85);
          for (let c = c0; c <= c1; c++) heights[c] = Math.max(heights[c], vh - y - h * 0.5);
          setPieces((prev) => [...prev, { id: i, x, y, w, h, font, rot: Math.round(-35 + Math.random() * 70) }]);
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
          const { w, h, font } = shape(size);
          setPieces((prev) => [...prev, {
            id: i, w, h, font,
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
  }, []);

  // «Ливень»: падение с ускорением, отскок и доворот — Web Animations на копии.
  const fall = (p: Piece) => (el: HTMLDivElement | null) => {
    if (!el || play.kind !== "rain" || el.dataset.fell) return;
    el.dataset.fell = "1";
    const from = `translate(${p.x}px, ${-p.h - 20}px) rotate(0deg)`;
    const land = (dy: number) => `translate(${p.x}px, ${p.y - dy}px) rotate(${p.rot}deg)`;
    el.animate([
      { transform: from, easing: "cubic-bezier(0.5, 0, 1, 0.55)" },
      { transform: land(0), offset: 0.78, easing: "cubic-bezier(0.2, 0.7, 0.4, 1)" },
      { transform: land(Math.min(18, p.h * 0.15)), offset: 0.9, easing: "cubic-bezier(0.6, 0, 0.8, 0.4)" },
      { transform: land(0) },
    ], { duration: 820, fill: "forwards" });
  };

  return createPortal(
    <div
      className="fixed inset-0 z-[95] pointer-events-none overflow-hidden"
      style={{ opacity: fading ? 0 : 1, transition: fading ? "opacity 900ms ease-in" : "none" }}
      aria-hidden
    >
      {pieces.map((p) => (
        <div key={p.id} ref={fall(p)} className="absolute left-0 top-0" style={{
          width: p.w, height: p.h, containerType: "size",
          transform: play.kind === "rain" ? `translate(${p.x}px, ${-p.h - 20}px)` : `translate(${p.x}px, ${p.y}px) rotate(${p.rot}deg)`,
        }}>
          <Body play={play} index={p.id} font={p.font} />
        </div>
      ))}
    </div>,
    document.body,
  );
};

export default MessageEffect;
