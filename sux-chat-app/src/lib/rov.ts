import { Capacitor } from "@capacitor/core";

/**
 * Р.Ё.В — режим ёбнутой вибрации: собеседник жмёт площадку, у нас отзывается
 * телефон.
 *
 * Поведение зависит от того, как долго держат:
 *   • короткое касание (меньше секунды) — один тактильный тычок, такой же,
 *     каким iPhone отзывается на нажатие кнопок;
 *   • удержание — через секунду тычок переходит в сплошной гул основного
 *     вибромотора и держится, пока не отпустят.
 *
 * Тычок даём сразу по первому сигналу: иначе короткое касание пришлось бы
 * ждать секунду, чтобы понять, что оно короткое. Сплошной вибрации «одной
 * командой» нет ни на iOS, ни в вебе, поэтому гул поддерживаем сами —
 * подкачиваем мотор чаще, чем он успевает остановиться.
 *
 * Сигналы идут по сокету пачками, пока палец на площадке. Пачка прервалась —
 * глушим по тишине: собеседник мог отпустить, свернуть приложение или
 * потерять сеть.
 */
const HOLD_MS = 1000;          // дольше этого — уже удержание, а не касание
const SILENCE_MS = 1200;       // нет сигналов столько — считаем, что отпустили
const MAX_MS = 5 * 60 * 1000;  // страховка, если «отпустил» потерялся

const platform = Capacitor.getPlatform();
// iOS: системная вибрация длится ~0.4 с и укоротить её нельзя — подкачиваем
// чаще, чтобы удары сливались в сплошное. Android и веб: держим мотор сами,
// длинными импульсами внахлёст.
const RUMBLE_STEP = platform === "ios" ? 380 : 1400;
const RUMBLE_LEN = 1500;

let active = false;
let rumble: ReturnType<typeof setInterval> | null = null;
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

/** Подкачка сплошного гула: мотор на полную, внахлёст с прошлым импульсом. */
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
  if (rumble) return;
  rumbleOnce();
  rumble = setInterval(rumbleOnce, RUMBLE_STEP);
};

/** Пришёл сигнал «держу»: первый — тычок, дальше перерастает в гул. */
export function rovOn(from?: string) {
  if (!active) {
    active = true;
    tap();
    escalate = setTimeout(startRumble, HOLD_MS);
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
  if (rumble) { clearInterval(rumble); rumble = null; }
  if (escalate) { clearTimeout(escalate); escalate = null; }
  if (silence) { clearTimeout(silence); silence = null; }
  if (hardStop) { clearTimeout(hardStop); hardStop = null; }
  navigator.vibrate?.(0);
  onChange?.(false);
}

export const rovActive = () => active;
