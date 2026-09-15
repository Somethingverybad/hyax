import { Capacitor, registerPlugin } from "@capacitor/core";

/** Сплошной гул через Core Haptics: системная вибрация iOS прерывистая по
 *  своей природе, повтором её сплошной не сделать (ios/App/App/RovHapticsPlugin.swift). */
interface RovHapticsPlugin {
  start(o?: { intensity?: number; sharpness?: number }): Promise<{ value: boolean }>;
  stop(): Promise<void>;
  supported(): Promise<{ value: boolean }>;
}
const rovHaptics = registerPlugin<RovHapticsPlugin>("RovHaptics");

/**
 * Р.Ё.В — режим ёбнутой вибрации: собеседник жмёт площадку, у нас отзывается
 * телефон.
 *
 * Поведение зависит от того, как долго держат:
 *   • короткое касание — один тактильный тычок, такой же, каким iPhone
 *     отзывается на нажатие кнопок;
 *   • удержание — те же одиночные тычки, но всё чаще и чаще; когда чаще уже
 *     некуда, они переходят в сплошной гул мотора и держатся до отпускания.
 *
 * Тычок даём сразу по первому сигналу: иначе короткое касание пришлось бы
 * ждать, чтобы понять, что оно короткое. Разгон — это именно учащение
 * коротких тычков (тактильный движок), а не длинные импульсы мотора: иначе
 * «нарастание» пропадает и с первого же шага получается сплошной гул.
 * Сплошного режима одной командой нет ни на iOS, ни в вебе, поэтому в конце
 * держим его сами — длинными импульсами внахлёст.
 *
 * Сигналы идут по сокету пачками, пока палец на площадке. Пачка прервалась —
 * глушим по тишине: собеседник мог отпустить, свернуть приложение или
 * потерять сеть.
 */
const HOLD_MS = 450;           // дольше этого — уже удержание, а не касание
const RAMP_MS = 1800;          // за столько тычки разгоняются до предела
const START_PERIOD = 420;      // первая пауза между тычками
const TAP_FLOOR = 90;          // чаще тычки уже не различить — пора гудеть
const SILENCE_MS = 1200;       // нет сигналов столько — считаем, что отпустили
const MAX_MS = 5 * 60 * 1000;  // страховка, если «отпустил» потерялся

const platform = Capacitor.getPlatform();
// Поддержание сплошного гула: iOS бьёт системной вибрацией ~0.4 с, её и
// подкачиваем чаще; на Android и в вебе длительность задаём сами.
const RUMBLE_STEP = platform === "ios" ? 380 : 1400;
const RUMBLE_LEN = 1500;

let active = false;
let rumbling = false;
let holdStart = 0;
let rumble: ReturnType<typeof setTimeout> | null = null;
let escalate: ReturnType<typeof setTimeout> | null = null;
let silence: ReturnType<typeof setTimeout> | null = null;
let hardStop: ReturnType<typeof setTimeout> | null = null;
let onChange: ((active: boolean, from?: string) => void) | null = null;

/** Подписка для интерфейса: подсветить, что нас ревут. */
export const onRovState = (cb: typeof onChange) => { onChange = cb; };

/** Одиночный тычок — короткий тактильный удар, различимый по отдельности.
 *  На разгоне бьём «тяжёлым» стилем: средний в кармане почти не слышно. */
const tap = (heavy = false) => {
  if (Capacitor.isNativePlatform()) {
    import("@capacitor/haptics")
      .then(({ Haptics, ImpactStyle }) =>
        Haptics.impact({ style: heavy ? ImpactStyle.Heavy : ImpactStyle.Medium }))
      .catch(() => {});
    return;
  }
  navigator.vibrate?.(heavy ? 45 : 35);
};

/** Запасной гул — повтором системной вибрации: на iPhone он на ощупь
 *  пульсирует, поэтому там сначала пробуем Core Haptics. */
const rumbleOnce = () => {
  if (Capacitor.isNativePlatform()) {
    import("@capacitor/haptics")
      .then(({ Haptics }) => Haptics.vibrate({ duration: RUMBLE_LEN }))
      .catch(() => {});
    return;
  }
  navigator.vibrate?.(RUMBLE_LEN);
};

const startRumble = () => {
  if (rumble) { clearTimeout(rumble); rumble = null; }
  rumbling = true;
  if (Capacitor.isNativePlatform()) {
    // Core Haptics держит настоящий непрерывный гул; если движок недоступен
    // (старое железо, занят звонком) — откатываемся на повтор вибрации.
    rovHaptics.start({ intensity: 1, sharpness: 0.5 })
      .then(({ value }) => { if (!value && rumbling) startFallbackRumble(); })
      .catch(() => { if (rumbling) startFallbackRumble(); });
    return;
  }
  startFallbackRumble();
};

const startFallbackRumble = () => {
  if (!rumbling || rumble) return;
  rumbleOnce();
  rumble = setInterval(rumbleOnce, RUMBLE_STEP) as unknown as ReturnType<typeof setTimeout>;
};

/** Разгон: пауза между ТЫЧКАМИ сокращается от START_PERIOD до TAP_FLOOR;
 *  как дошли до предела — переходим в сплошной гул. */
const rampStep = () => {
  const held = Date.now() - holdStart - HOLD_MS;
  const p = Math.min(1, Math.max(0, held / RAMP_MS));
  // Ускоряемся сразу и заметно: квадратичная кривая тормозила в начале, и
  // разгон ощущался вялым. Теперь наоборот — резко в начале, плавно к концу.
  const eased = 1 - (1 - p) * (1 - p);
  const period = Math.round(START_PERIOD - (START_PERIOD - TAP_FLOOR) * eased);
  if (period <= TAP_FLOOR) { startRumble(); return; }
  tap(true);
  rumble = setTimeout(rampStep, period);
};

/** Пришёл сигнал «держу»: первый — тычок, дальше перерастает в гул. */
export function rovOn(from?: string) {
  if (!active) {
    active = true;
    holdStart = Date.now();
    tap();
    escalate = setTimeout(rampStep, HOLD_MS);
    hardStop = setTimeout(rovOff, MAX_MS);
    onChange?.(true, from);
  }
  if (silence) clearTimeout(silence);
  silence = setTimeout(rovOff, SILENCE_MS);
}

/** «Отпустил» — либо сигналы кончились, либо вышло время. */
export function rovOff() {
  if (!active && !rumble) return;
  active = false;
  if (rumble) {
    // На разгоне это таймаут, в гуле — интервал: снимаем и то и другое.
    clearTimeout(rumble);
    clearInterval(rumble as unknown as ReturnType<typeof setInterval>);
    rumble = null;
  }
  if (rumbling && Capacitor.isNativePlatform()) rovHaptics.stop().catch(() => {});
  rumbling = false;
  if (escalate) { clearTimeout(escalate); escalate = null; }
  if (silence) { clearTimeout(silence); silence = null; }
  if (hardStop) { clearTimeout(hardStop); hardStop = null; }
  navigator.vibrate?.(0);
  onChange?.(false);
}

export const rovActive = () => active;
export const rovRumbling = () => rumbling;
