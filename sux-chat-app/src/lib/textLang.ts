/**
 * Язык текста по письменности — как detect_lang на сервере (chat/translate.py):
 * хангыль — ko, кириллица — ru, латиница — en; ссылки и @упоминания не
 * считаем. Без букв — пусто. Нужен, чтобы не спрашивать перевод у текста,
 * который и так на моём языке.
 */
export function scriptLang(text: string): "ko" | "ru" | "en" | "" {
  const t = (text || "").replace(/https?:\/\/\S+|@\w+/g, " ");
  const ko = (t.match(/[가-힣ᄀ-ᇿ㄰-㆏]/g) || []).length;
  const ru = (t.match(/[Ѐ-ӿ]/g) || []).length;
  const en = (t.match(/[A-Za-z]/g) || []).length;
  const best = Math.max(ko, ru, en);
  if (!best) return "";
  return best === ko ? "ko" : best === ru ? "ru" : "en";
}
