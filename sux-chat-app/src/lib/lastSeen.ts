/**
 * «В сети 5 минут назад» — человеческое время последнего входа.
 *
 * Без рода: в русском «был» и «была» пришлось бы угадывать, а пол мы не
 * спрашиваем. Формулировка одна на всех и не врёт.
 */
export function lastSeenText(iso: string | null | undefined): string {
  if (!iso) return "не в сети";
  const when = new Date(iso).getTime();
  if (!isFinite(when)) return "не в сети";
  const mins = Math.floor((Date.now() - when) / 60000);

  if (mins < 1) return "в сети только что";
  if (mins < 60) return `в сети ${mins} ${plural(mins, "минуту", "минуты", "минут")} назад`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `в сети ${hours} ${plural(hours, "час", "часа", "часов")} назад`;
  const days = Math.floor(hours / 24);
  if (days === 1) return "в сети вчера";
  if (days < 7) return `в сети ${days} ${plural(days, "день", "дня", "дней")} назад`;
  // Дальше недели точность не нужна — важно лишь, что человек давно не заходил.
  return `в сети ${new Date(iso).toLocaleDateString("ru-RU", { day: "numeric", month: "long" })}`;
}

function plural(n: number, one: string, few: string, many: string): string {
  const d = n % 10, dd = n % 100;
  if (d === 1 && dd !== 11) return one;
  if (d >= 2 && d <= 4 && (dd < 10 || dd >= 20)) return few;
  return many;
}
