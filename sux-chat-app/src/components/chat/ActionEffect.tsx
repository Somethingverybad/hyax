import { useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Capacitor } from "@capacitor/core";
import NotoEmoji from "@/components/NotoEmoji";
import { motionOff } from "@/lib/navAnim";
import { EMOJI_SEQ } from "@/lib/notoEmoji";
import { applog } from "@/lib/applog";

/**
 * Эффект действия («😉 Вася подмигивает вам», chat/ChatAction) у получателя.
 * Шаблон — у действия (ChatAction.fx, выбирается в админке, новому действию —
 * любой из готовых):
 *   • pop   — плашка действия крупно вылетает в центр, плавно покачивается и
 *             улетает; эмодзи — анимированными копиями Noto по экрану;
 *   • throw — эмодзи (у «двух тапков» — каждый) летит из глубины в экран,
 *             растёт, бьётся о стекло, замирает и медленно сползает вниз;
 *             фраза — плашкой сверху (тапок, поцелуй, пинок, тычок);
 *   • hug   — плашку сжимает с боков, как в объятиях, несколько раз;
 *   • wink  — плашка становится глазом-эллипсом и подмигивает.
 * Играет только последнее пришедшее (ChatWindow), тапы пропускает насквозь.
 * «Анимации и эффекты» выключены или «Уменьшить движение» в системе — без эффекта.
 */
export type ActionFx = "pop" | "throw" | "hug" | "wink";
/** Шаблоны для редактора действий (pages/ProfileActions); ключи перевода. */
export const ACTION_FX_OPTIONS: { key: ActionFx; label: string }[] = [
  { key: "pop", label: "Плашка: качается, вокруг копии эмодзи" },
  { key: "throw", label: "Бросок: эмодзи летит в экран и сползает по стеклу" },
  { key: "hug", label: "Объятие: плашку сжимает с боков" },
  { key: "wink", label: "Подмигивание: плашка становится глазом и подмигивает" },
];
export type ActionPlay = { emoji: string; phrase: ReactNode; fx?: string | null };
const fxOf = (v?: string | null): ActionFx => (v === "throw" || v === "hug" || v === "wink" ? v : "pop");

const ACTION_MS = 2800;
const THROW_MS = 3400;
const COPIES = 6;
/** Плашка — непрозрачная при любой теме (у «стекла» bg-surface-* полупрозрачные,
 *  и сквозь плашку просвечивала лента); ширина — по тексту, до 86 % экрана
 *  (привязка к середине экрана иначе ужимала её до половины — фраза в три строки). */
const PILL_STYLE = { background: "hsl(var(--surface-3))", width: "max-content", maxWidth: "86vw" } as const;

const impact = () => {
  if (Capacitor.isNativePlatform()) {
    import("@capacitor/haptics").then(({ Haptics, ImpactStyle }) => Haptics.impact({ style: ImpactStyle.Heavy })).catch(() => {});
  } else {
    try { navigator.vibrate?.(40); } catch { /* нет вибрации */ }
  }
};

type Copy = { id: number; x: number; y: number; size: number; delay: number; rot: number };

const softHaptic = () => {
  if (Capacitor.isNativePlatform()) {
    import("@capacitor/haptics").then(({ Haptics, ImpactStyle }) => {
      void Haptics.impact({ style: ImpactStyle.Light }).catch(() => {});
      setTimeout(() => { void Haptics.impact({ style: ImpactStyle.Medium }).catch(() => {}); }, 160);
    }).catch(() => {});
  } else {
    try { navigator.vibrate?.([20, 120, 30]); } catch { /* нет вибрации */ }
  }
};

const ActionEffect = ({ play, onDone }: { play: ActionPlay; onDone: () => void }) => {
  const fx = fxOf(play.fx);
  const total = fx === "throw" ? THROW_MS : ACTION_MS;
  // «Бросок»: летят все эмодзи действия (у «двух тапков» — оба), не больше трёх.
  const [thrown] = useState(() => (play.emoji.match(EMOJI_SEQ) || [play.emoji]).slice(0, 3));
  const [copies] = useState<Copy[]>(() => {
    const vw = window.innerWidth, vh = window.innerHeight;
    // Копии — вокруг, а не поверх плашки: середину экрана (по высоте) обходим.
    return Array.from({ length: COPIES }, (_, i) => {
      const size = Math.round(Math.min(vw, vh) * (0.14 + Math.random() * 0.1));
      const top = i % 2 === 0;
      const y = top ? vh * (0.08 + Math.random() * 0.24) : vh * (0.62 + Math.random() * 0.24);
      const x = ((i >> 1) + 0.15 + Math.random() * 0.7) * (vw / Math.ceil(COPIES / 2)) - size / 2;
      return { id: i, x: Math.round(Math.max(4, Math.min(vw - size - 4, x))), y: Math.round(y - size / 2), size, delay: 120 + i * 90 + Math.round(Math.random() * 120), rot: Math.round(-18 + Math.random() * 36) };
    });
  });
  const skip = useRef(motionOff());
  useEffect(() => {
    if (skip.current) {
      applog.info("action effect: пропущен — анимации выключены");
      onDone();
      return;
    }
    applog.info(`action effect ${fx} ${play.emoji}`);
    softHaptic();
    const timers = [setTimeout(onDone, total + 100)];
    if (fx === "throw") timers.push(setTimeout(impact, Math.round(THROW_MS * 0.27)));
    return () => timers.forEach(clearTimeout);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Плашка: вылет из маленькой, плавное покачивание, улёт.
  const pill = (el: HTMLDivElement | null) => {
    if (!el || el.dataset.played) return;
    el.dataset.played = "1";
    if (fx === "hug") { hugFrames(el); return; }
    const frames: Keyframe[] = [
      { transform: "translate(-50%, -50%) scale(0.3)", opacity: 0, offset: 0 },
      { transform: "translate(-50%, -50%) scale(1.08)", opacity: 1, offset: 0.12, easing: "cubic-bezier(0.2, 0.8, 0.3, 1)" },
      { transform: "translate(-50%, -50%) scale(1)", offset: 0.18 },
    ];
    // Плавно, синусом: ±5° и пара пикселей, к концу затихает.
    const n = 10;
    for (let k = 1; k <= n; k++) {
      const a = 1 - (k / n) * 0.6;
      const r = Math.sin(k * 1.9) * 5 * a, dx = Math.sin(k * 2.7) * 6 * a, dy = Math.cos(k * 2.3) * 3 * a;
      frames.push({ transform: `translate(calc(-50% + ${dx.toFixed(1)}px), calc(-50% + ${dy.toFixed(1)}px)) rotate(${r.toFixed(1)}deg)`, offset: 0.18 + (0.62 * k) / n, easing: "ease-in-out" });
    }
    frames.push({ transform: "translate(-50%, -50%) scale(1)", opacity: 1, offset: 0.84 }, { transform: "translate(-50%, -60%) scale(1.12)", opacity: 0, offset: 1 });
    el.animate(frames, { duration: ACTION_MS, fill: "forwards" });
  };
  // Копия эмодзи: всплывает, чуть плывёт вверх, тает к концу.
  const pop = (c: Copy) => (el: HTMLDivElement | null) => {
    if (!el || el.dataset.played) return;
    el.dataset.played = "1";
    const total = ACTION_MS - c.delay;
    el.animate([
      { transform: `scale(0) rotate(${c.rot - 20}deg)`, opacity: 0 },
      { transform: `scale(1.15) rotate(${c.rot}deg)`, opacity: 1, offset: 0.14, easing: "cubic-bezier(0.2, 0.8, 0.3, 1.3)" },
      { transform: `translateY(-6px) scale(1) rotate(${c.rot}deg)`, opacity: 1, offset: 0.75 },
      { transform: `translateY(-24px) scale(0.9) rotate(${c.rot}deg)`, opacity: 0 },
    ], { duration: total, delay: c.delay, fill: "both" });
  };

  // «Объятие»: плашку несколько раз сжимает с боков (уже и выше, края
  // скругляются сильнее), потом отпускает и она улетает.
  const hugFrames = (el: HTMLElement) => {
    const c = "translate(-50%, -50%)";
    el.animate([
      { transform: `${c} scale(0.3)`, opacity: 0, borderRadius: "28px", offset: 0 },
      { transform: `${c} scale(1.06)`, opacity: 1, offset: 0.12, easing: "cubic-bezier(0.2, 0.8, 0.3, 1)" },
      { transform: `${c} scale(1)`, borderRadius: "28px", offset: 0.2 },
      { transform: `${c} scale(0.78, 1.14)`, borderRadius: "46% / 32%", offset: 0.3, easing: "ease-in-out" },
      { transform: `${c} scale(1.04, 0.97)`, borderRadius: "30px", offset: 0.4, easing: "ease-in-out" },
      { transform: `${c} scale(0.74, 1.18)`, borderRadius: "48% / 34%", offset: 0.52, easing: "ease-in-out" },
      { transform: `${c} scale(1.03, 0.98)`, borderRadius: "30px", offset: 0.62, easing: "ease-in-out" },
      { transform: `${c} scale(0.86, 1.08)`, borderRadius: "40% / 30%", offset: 0.72, easing: "ease-in-out" },
      { transform: `${c} scale(1)`, opacity: 1, borderRadius: "28px", offset: 0.84 },
      { transform: "translate(-50%, -60%) scale(1.1)", opacity: 0, offset: 1 },
    ], { duration: ACTION_MS, fill: "forwards" });
  };
  // «Подмигивание»: плашка тает в глаз-эллипс с эмодзи посередине; глаз
  // моргает, потом подмигивает (второй раз быстрее), и всё тает.
  const eye = (el: HTMLDivElement | null) => {
    if (!el || el.dataset.played) return;
    el.dataset.played = "1";
    const c = "translate(-50%, -50%)";
    el.animate([
      { transform: `${c} scale(0.5, 0.25)`, opacity: 0, offset: 0 },
      { transform: `${c} scale(0.5, 0.25)`, opacity: 0, offset: 0.14 },
      { transform: `${c} scale(1.05)`, opacity: 1, offset: 0.3, easing: "cubic-bezier(0.2, 0.8, 0.3, 1.2)" },
      { transform: `${c} scale(1)`, offset: 0.38 },
      { transform: `${c} scale(1, 1)`, offset: 0.46 },
      { transform: `${c} scale(1.04, 0.08)`, offset: 0.5, easing: "ease-in" },
      { transform: `${c} scale(1, 1)`, offset: 0.55, easing: "ease-out" },
      { transform: `${c} scale(1, 1)`, offset: 0.64 },
      { transform: `${c} scale(1.06, 0.06)`, offset: 0.67, easing: "ease-in" },
      { transform: `${c} scale(1.06, 0.06)`, offset: 0.72 },
      { transform: `${c} scale(1, 1)`, offset: 0.77, easing: "cubic-bezier(0.2, 0.8, 0.3, 1.3)" },
      { transform: `${c} scale(1)`, opacity: 1, offset: 0.86 },
      { transform: `${c} scale(1.15)`, opacity: 0, offset: 1 },
    ], { duration: ACTION_MS, fill: "forwards" });
  };
  const winkPill = (el: HTMLDivElement | null) => {
    if (!el || el.dataset.played) return;
    el.dataset.played = "1";
    el.animate([
      { transform: "translate(-50%, -50%) scale(0.3)", opacity: 0, borderRadius: "28px", offset: 0 },
      { transform: "translate(-50%, -50%) scale(1)", opacity: 1, offset: 0.1, easing: "cubic-bezier(0.2, 0.8, 0.3, 1)" },
      // Плашка округляется и уходит вниз — под глаз.
      { transform: "translate(-50%, -50%) scale(0.85, 0.6)", borderRadius: "50%", opacity: 1, offset: 0.2 },
      { transform: "translate(-50%, calc(-50% + 22vh)) scale(0.82)", borderRadius: "28px", opacity: 1, offset: 0.3 },
      { transform: "translate(-50%, calc(-50% + 22vh)) scale(0.82)", opacity: 1, offset: 0.86 },
      { transform: "translate(-50%, calc(-50% + 22vh)) scale(0.9)", opacity: 0, offset: 1 },
    ], { duration: ACTION_MS, fill: "forwards" });
  };
  // «Бросок»: летит из глубины, растёт, бьётся о стекло (сплющивается),
  // замирает и медленно сползает вниз; к концу тает.
  const throwOne = (i: number, n: number) => (el: HTMLDivElement | null) => {
    if (!el || el.dataset.played) return;
    el.dataset.played = "1";
    const dx = n > 1 ? (i - (n - 1) / 2) * 26 : 0; // vw
    const rot = Math.round(-14 + Math.random() * 28);
    const at = (x: number, y: string, sx: number, sy: number, r: number) =>
      `translate(calc(-50% + ${x}vw), calc(-50% + ${y})) rotate(${r}deg) scale(${sx}, ${sy})`;
    el.animate([
      { transform: at(dx * 0.2, "0px", 0.08, 0.08, rot - 40), opacity: 0, offset: 0 },
      { transform: at(dx * 0.5, "-4vh", 0.35, 0.35, rot - 20), opacity: 1, offset: 0.1, easing: "cubic-bezier(0.5, 0, 0.9, 0.6)" },
      { transform: at(dx, "0px", 1, 1, rot), offset: 0.26 },
      { transform: at(dx, "0px", 1.14, 0.86, rot), offset: 0.29, easing: "ease-out" },
      { transform: at(dx, "0px", 0.97, 1.03, rot), offset: 0.33 },
      { transform: at(dx, "0px", 1, 1, rot), offset: 0.36 },
      { transform: at(dx, "0px", 1, 1, rot), offset: 0.52 },
      { transform: at(dx, "6vh", 1, 1.04, rot), offset: 0.7, easing: "ease-in" },
      { transform: at(dx, "34vh", 0.98, 1.08, rot), opacity: 1, offset: 0.9, easing: "ease-in" },
      { transform: at(dx, "48vh", 0.96, 1.1, rot), opacity: 0, offset: 1 },
    ], { duration: THROW_MS, delay: i * 220, fill: "both" });
  };
  const topPill = (el: HTMLDivElement | null) => {
    if (!el || el.dataset.played) return;
    el.dataset.played = "1";
    el.animate([
      { transform: "translate(-50%, -12px)", opacity: 0 },
      { transform: "translate(-50%, 0)", opacity: 1, offset: 0.1 },
      { transform: "translate(-50%, 0)", opacity: 1, offset: 0.88 },
      { transform: "translate(-50%, -12px)", opacity: 0 },
    ], { duration: THROW_MS, fill: "forwards" });
  };

  if (skip.current) return null;
  const pillBody = (
    <>
      <span className="inline-block align-middle mr-2" style={{ width: 34, height: 34 }}>
        <NotoEmoji emoji={play.emoji.match(EMOJI_SEQ)?.[0] || play.emoji} size={34} autoPlay delay={150} />
      </span>
      <span className="align-middle">{play.phrase}</span>
    </>
  );
  if (fx === "throw") {
    const size = Math.round(Math.min(window.innerWidth, window.innerHeight) * (thrown.length > 1 ? 0.42 : 0.6));
    return createPortal(
      <div className="fixed inset-0 z-[95] pointer-events-none overflow-hidden" aria-hidden>
        <div ref={topPill} className="absolute left-1/2 px-4 py-2 rounded-[22px] text-foreground shadow-xl text-center text-body"
          style={{ ...PILL_STYLE, top: "max(16px, env(safe-area-inset-top))", opacity: 0 }}>{pillBody}</div>
        {thrown.map((e, i) => (
          <div key={i} ref={throwOne(i, thrown.length)} className="absolute left-1/2 top-[42%] drop-shadow-2xl" style={{ width: size, height: size, opacity: 0 }}>
            <NotoEmoji emoji={e} size={size} autoPlay delay={THROW_MS * 0.26 + i * 220} />
          </div>
        ))}
      </div>,
      document.body,
    );
  }
  if (fx === "wink") {
    const w = Math.round(Math.min(window.innerWidth * 0.72, 360));
    return createPortal(
      <div className="fixed inset-0 z-[95] pointer-events-none overflow-hidden" aria-hidden>
        {/* Глаз: белок с тёмным контуром, эмодзи — зрачком. */}
        <div ref={eye} className="absolute left-1/2 top-1/2 shadow-2xl flex items-center justify-center"
          style={{ width: w, height: Math.round(w * 0.56), borderRadius: "50%", opacity: 0, background: "#fff", border: "6px solid #1f1f1f" }}>
          <NotoEmoji emoji={play.emoji.match(EMOJI_SEQ)?.[0] || play.emoji} size={Math.round(w * 0.36)} autoPlay delay={ACTION_MS * 0.3} />
        </div>
        <div ref={winkPill} className="absolute left-1/2 top-1/2 px-5 py-3 rounded-[28px] text-foreground shadow-2xl text-center"
          style={{ ...PILL_STYLE, fontSize: 18, lineHeight: 1.3, opacity: 0 }}>{pillBody}</div>
      </div>,
      document.body,
    );
  }
  return createPortal(
    <div className="fixed inset-0 z-[95] pointer-events-none overflow-hidden" aria-hidden>
      {fx === "pop" && copies.map((c, i) => (
        <div key={c.id} ref={pop(c)} className="absolute" style={{ left: c.x, top: c.y, width: c.size, height: c.size, opacity: 0 }}>
          <NotoEmoji emoji={thrown[i % thrown.length]} size={c.size} autoPlay delay={c.delay} />
        </div>
      ))}
      <div ref={pill} className="absolute left-1/2 top-1/2 px-5 py-3 rounded-[28px] text-foreground shadow-2xl text-center"
        style={{ ...PILL_STYLE, fontSize: 20, lineHeight: 1.3, opacity: 0, transform: "translate(-50%, -50%) scale(0.3)" }}>
        {pillBody}
      </div>
    </div>,
    document.body,
  );
};

export default ActionEffect;
