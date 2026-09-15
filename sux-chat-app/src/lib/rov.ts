import { Capacitor } from "@capacitor/core";

/**
 * Р.Ё.В — режим ёбнутой вибрации: собеседник жмёт площадку, у нас отзывается
 * телефон.
 *
 * Поведение зависит от того, как долго держат:
 *   • короткое касание — один тактильный тычок, такой же, каким iPhone
 *     отзывается на нажатие кнопок;
 *   • удержание — удары начинаются редкими и плавно разгоняются, пока не
 *     сливаются в сплошной гул; держится, пока не отпустят.
 *
 * Тычок даём сразу по первому сигналу: иначе короткое касание пришлось бы
 * ждать, чтобы понять, что оно короткое. Сплошной вибрации «одной командой»
 * нет ни на iOS, ни в вебе, поэтому разгон делаем сами: сокращаем паузу
 * между импульсами, пока мотор не перестаёт успевать останавливаться.
 *
 * Сигналы идут по сокету пачками, пока палец на площадке. Пачка прервалась —
 * глушим по тишине: собеседник мог отпустить, свернуть приложение или
 * потерять сеть.
 */
const HOLD_MS = 600;           // дольше этого — уже удержание, а не касание
const RAMP_MS = 3000;          // за столько разгоняемся от редких ударов до сплошного
const START_PERIOD = 700;      // первая пауза между ударами
const SILENCE_MS = 1200;       // нет сигналов столько — считаем, что отпустили
const MAX_MS = 5 * 60 * 1000;  // страховка, если «отпустил» потерялся

const platform = Capacitor.getPlatform();
// Порог, ниже которого удары уже не различимы по отдельности. На iOS
// системная вибрация длится ~0.4 с и укоротить её нельзя, поэтому там предел
// такой; на Android и в вебе длительность задаём сами и можем идти плотнее.
const FLOOR_PERIOD = platform === "ios" ? 380 : 140;

let active = false;
let holdStart = 0;
let rumble: ReturnType<typeof setTimeout> | null = null;
let escalate: ReturnType<typeof setTimeout> | null = null;
let silence: ReturnType<typeof setTimeout> | null = null;
let hardStop: ReturnType<typeof setTimeout> | null = null;
let onChange: ((active: boolean, from?: string) => void) | null = null;

/** Подписка для интерфейса: подсветить, что нас ревут. */
export const onRovState = (cb: typeof onChange) => { onChange = cb; };

/** Одиночный тычок — лёгкий тактильный отклик. */
const tap = () => {
  if (Capacitor.isNativePlatform()) {
    import("@capacitor/haptics")
      .then(({ Haptics, ImpactStyle }) => Haptics.impact({ style: ImpactStyle.Medium }))
      .catch(() => {});
    return;
  }
  navigator.vibrate?.(35);
};

/** Один удар основного вибромотора длиной чуть больше паузы — чтобы на
 *  разгоне импульсы наезжали друг на друга и превращались в сплошное. */
const buzz = (period: number) => {
  const len = Math.round(period * 1.4);
  if (Capacitor.isNativePlatform()) {
    import("@capacitor/haptics")
      .then(({ Haptics }) => Haptics.vibrate({ duration: len }))
      .catch(() => {});
    return;
  }
  navigator.vibrate?.(len);
};

/** Разгон: пауза между ударами сокращается от START_PERIOD до порога,
 *  дальше вибрация уже сплошная и просто поддерживается. */
const rampStep = () => {
  const held = Date.now() - holdStart - HOLD_MS;
  const p = Math.min(1, Math.max(0, held / RAMP_MS));
  // Медленно в начале, резче к концу — так «нарастание» слышнее рукой.
  const eased = p * p;
  const period = Math.round(START_PERIOD - (START_PERIOD - FLOOR_PERIOD) * eased);
  buzz(period);
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
  if (rumble) { clearTimeout(rumble); rumble = null; }
  if (escalate) { clearTimeout(escalate); escalate = null; }
  if (silence) { clearTimeout(silence); silence = null; }
  if (hardStop) { clearTimeout(hardStop); hardStop = null; }
  navigator.vibrate?.(0);
  onChange?.(false);
}

export const rovActive = () => active;
