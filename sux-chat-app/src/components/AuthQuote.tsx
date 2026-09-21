import { useEffect, useRef, useState } from "react";

/**
 * Подпись под логотипом на экране входа: цитаты сменяют друг друга.
 *
 * Раньше здесь висела одна строка про «не очень-то быстрый мессенджер».
 * Смена идёт по кругу, случайным порядком на каждый запуск, анимация —
 * только прозрачность и сдвиг (их считает композитор, раскладка не
 * пересчитывается). При «уменьшить движение» просто меняем текст.
 */
const QUOTES = [
  "Каждый проходит путь самурая, чтобы однажды стать тамагочи…",
  "Не учатся ничему некоторые и учиться не хотят…",
  "На сметане мешон, на окошке стужен…",
  "Семь раз отмерь — один раз отправь…",
  "Молчание — золото, а голосовое — серебро…",
  "Тише едешь — дальше будешь от темы разговора…",
  "Не откладывай на завтра то, что можно не писать сегодня…",
  "Всё гениальное просто, а всё простое уже занято…",
  "Дарёному коню в переписку не смотрят…",
  "Где родился, там и залип…",
  "У семи нянек дитя без интернета…",
  "Лучше поздно, чем в полночь голосовым…",
  "Слово не воробей, а уведомление — тем более…",
  "Утро вечера мудренее, а вечер разговорчивее…",
];

const PERIOD = 5200;

const AuthQuote = ({ className = "" }: { className?: string }) => {
  // Порядок свой на каждый запуск: одна и та же первая строка приедалась бы.
  const order = useRef<number[]>([...QUOTES.keys()].sort(() => Math.random() - 0.5));
  const [step, setStep] = useState(0);
  const [visible, setVisible] = useState(true);

  useEffect(() => {
    const calm = typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    const id = setInterval(() => {
      if (calm) { setStep((n) => n + 1); return; }
      // Сначала гасим старую строку, затем подставляем новую — так они не
      // перекрывают друг друга и высота не скачет.
      setVisible(false);
      setTimeout(() => { setStep((n) => n + 1); setVisible(true); }, 320);
    }, PERIOD);
    return () => clearInterval(id);
  }, []);

  const text = QUOTES[order.current[step % QUOTES.length]];

  return (
    <p className={`auth-quote min-h-[2.6em] flex items-center justify-center text-center ${className}`}>
      <span key={text} className={visible ? "auth-quote-in" : "auth-quote-out"}>{text}</span>
    </p>
  );
};

export default AuthQuote;
