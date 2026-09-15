import { Capacitor } from "@capacitor/core";

/**
 * Р.Ё.В — режим ёбнутой вибрации: пока собеседник держит палец на площадке,
 * у нас вибрирует телефон.
 *
 * Непрерывной вибрации нет ни на iOS, ни в вебе, поэтому «держим» её сами:
 * повторяем короткие импульсы, пока приходят сигналы «держу». Сигналы идут
 * по сокету пачками (отправитель повторяет их, пока палец на экране), и если
 * пачка прервалась — глушим по тишине: собеседник мог отпустить, свернуть
 * приложение или потерять сеть.
 *
 * Частоту задаёт отправитель движением пальца по вертикали (rate 0..1) —
 * её отрабатываем локально, поэтому частая вибрация не требует частых
 * пакетов. Потолок длительности тот же, что на сервере: 5 минут подряд.
 */
const PULSE_SLOW = 900;        // палец внизу — редкие удары
const PULSE_FAST = 60;         // палец вверху — частые
// На iOS сильная вибрация — это системный «звонковый» сигнал, он длится около
// 0.4 с и укоротить его нельзя: чаще, чем раз в ~450 мс, бить бессмысленно —
// удары сольются в кашу. На Android длительность задаём сами, поэтому там
// частота работает во всём диапазоне.
const MIN_PERIOD = Capacitor.getPlatform() === "ios" ? 450 : 60;
const pulseFor = (rate: number) => Math.max(
  MIN_PERIOD,
  Math.round(PULSE_SLOW - (PULSE_SLOW - PULSE_FAST) * Math.min(1, Math.max(0, rate))),
);
const SILENCE_MS = 1200;       // нет сигналов столько — считаем, что отпустили
const MAX_MS = 5 * 60 * 1000;  // страховка на случай, если «отпустил» потерялся

let pulse: ReturnType<typeof setInterval> | null = null;
let period = pulseFor(0.5);
let silence: ReturnType<typeof setTimeout> | null = null;
let hardStop: ReturnType<typeof setTimeout> | null = null;
let onChange: ((active: boolean, from?: string) => void) | null = null;

/** Подписка для интерфейса: подсветить, что нас ревут. */
export const onRovState = (cb: typeof onChange) => { onChange = cb; };

const buzz = () => {
  if (Capacitor.isNativePlatform()) {
    // Именно vibrate, а не impact: impact — это лёгкий тычок тактильного
    // движка, его почти не чувствуешь в кармане. vibrate поднимает основной
    // вибромотор — так же, как при звонке. На Android держим мотор почти
    // весь такт, чтобы получилась сплошная дрожь, на iOS длительность
    // системная (~0.4 с) и параметр игнорируется.
    import("@capacitor/haptics")
      .then(({ Haptics }) => Haptics.vibrate({ duration: Math.max(180, Math.round(period * 0.9)) }))
      .catch(() => {});
    return;
  }
  // Браузер: где есть вибромотор (Android) — длинный импульс на весь такт.
  // На десктопе метода нет, останется только подсветка в интерфейсе.
  navigator.vibrate?.(Math.max(80, Math.round(period * 0.9)));
};

/** Пришёл сигнал «держу»: начинаем, продлеваем или меняем частоту. */
export function rovOn(from?: string, rate = 0.5) {
  const want = pulseFor(rate);
  if (!pulse) {
    period = want;
    buzz();
    pulse = setInterval(buzz, period);
    hardStop = setTimeout(rovOff, MAX_MS);
    onChange?.(true, from);
  } else if (want !== period) {
    // Частоту сменили на ходу — перезапускаем такт с новым периодом.
    period = want;
    clearInterval(pulse);
    pulse = setInterval(buzz, period);
  }
  if (silence) clearTimeout(silence);
  silence = setTimeout(rovOff, SILENCE_MS);
}

/** «Отпустил» — либо сигналы кончились, либо вышло время. */
export function rovOff() {
  if (pulse) { clearInterval(pulse); pulse = null; }
  if (silence) { clearTimeout(silence); silence = null; }
  if (hardStop) { clearTimeout(hardStop); hardStop = null; }
  navigator.vibrate?.(0);
  onChange?.(false);
}

export const rovActive = () => pulse !== null;
