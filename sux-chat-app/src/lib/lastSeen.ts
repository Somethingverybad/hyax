/**
 * «В сети 5 минут назад» — человеческое время последнего входа.
 *
 * Без рода: в русском «был» и «была» пришлось бы угадывать, а пол мы не
 * спрашиваем. Формулировка одна на всех и не врёт.
 *
 * Вызывать только в рендере: фразы берутся на текущем языке (t/tn).
 */
import { getLang, t, tn } from "@/lib/i18n";

const LOCALE = { ru: "ru-RU", en: "en-US", ko: "ko-KR" } as const;

export function lastSeenText(iso: string | null | undefined): string {
  if (!iso) return t("не в сети");
  const when = new Date(iso).getTime();
  if (!isFinite(when)) return t("не в сети");
  const mins = Math.floor((Date.now() - when) / 60000);

  if (mins < 1) return t("в сети только что");
  if (mins < 60) return tn(mins, "в сети {n} минуту назад", "в сети {n} минуты назад", "в сети {n} минут назад");
  const hours = Math.floor(mins / 60);
  if (hours < 24) return tn(hours, "в сети {n} час назад", "в сети {n} часа назад", "в сети {n} часов назад");
  const days = Math.floor(hours / 24);
  if (days === 1) return t("в сети вчера");
  if (days < 7) return tn(days, "в сети {n} день назад", "в сети {n} дня назад", "в сети {n} дней назад");
  // Дальше недели точность не нужна — важно лишь, что человек давно не заходил.
  const date = new Date(iso).toLocaleDateString(LOCALE[getLang()] || "ru-RU", { day: "numeric", month: "long" });
  return t("в сети {date}", { date });
}
