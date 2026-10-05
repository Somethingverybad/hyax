import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Capacitor } from "@capacitor/core";
import StickerView from "./StickerView";

/**
 * «Глюк-стикер»: стикер высыпается по экрану — по одному, резко, с
 * нарастающим темпом (секунда, полсекунды, …) и вибрацией на каждом, в
 * случайных местах и размерах (один — почти во весь экран). Когда набралось
 * штук двадцать — все вместе плавно растворяются. Поверх всего, тапы
 * пропускает насквозь.
 */
type Item = { id: number; x: number; y: number; size: number; rot: number };
const COUNT = 20;
const DELAYS = [0, 1000, 520, 360, 270, 210, 170, 140, 120, 105, 95, 85];

const haptic = () => {
  if (Capacitor.isNativePlatform()) {
    import("@capacitor/haptics").then(({ Haptics, ImpactStyle }) => Haptics.impact({ style: ImpactStyle.Light })).catch(() => {});
  } else {
    try { navigator.vibrate?.(12); } catch { /* нет вибрации */ }
  }
};

const StickerBurst = ({ url, onDone }: { url: string; onDone: () => void }) => {
  const [items, setItems] = useState<Item[]>([]);
  const [fading, setFading] = useState(false);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);

  useEffect(() => {
    const vw = window.innerWidth, vh = window.innerHeight;
    const giantAt = 8 + Math.floor(Math.random() * 8); // один огромный — где-то в середине
    let t = 0;
    for (let i = 0; i < COUNT; i++) {
      t += DELAYS[Math.min(i, DELAYS.length - 1)];
      timers.current.push(setTimeout(() => {
        const size = i === giantAt ? Math.round(Math.min(vw, vh) * 0.95) : Math.round(90 + Math.random() * 150);
        const item: Item = {
          id: i,
          x: Math.round(Math.random() * Math.max(0, vw - size)),
          y: Math.round(Math.random() * Math.max(0, vh - size)),
          size,
          rot: Math.round(-25 + Math.random() * 50),
        };
        setItems((prev) => [...prev, item]);
        haptic();
      }, t));
    }
    timers.current.push(setTimeout(() => setFading(true), t + 700));
    timers.current.push(setTimeout(onDone, t + 700 + 1000));
    return () => { timers.current.forEach(clearTimeout); timers.current = []; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [url]);

  return createPortal(
    <div
      className="fixed inset-0 z-[95] pointer-events-none overflow-hidden"
      style={{ opacity: fading ? 0 : 1, transition: fading ? "opacity 900ms ease-in" : "none" }}
      aria-hidden
    >
      {items.map((it) => (
        <div key={it.id} className="absolute" style={{ left: it.x, top: it.y, width: it.size, height: it.size, transform: `rotate(${it.rot}deg)` }}>
          <StickerView url={url} className="w-full h-full object-contain drop-shadow-lg" />
        </div>
      ))}
    </div>,
    document.body,
  );
};

export default StickerBurst;
