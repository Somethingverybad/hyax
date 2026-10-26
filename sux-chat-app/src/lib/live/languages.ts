/** Языки живого перевода — те же, что NAMES в backend chat/translate.py.
 *  Названия — самоназвания: их не нужно переводить на язык интерфейса. */
export const LIVE_LANGS: ReadonlyArray<readonly [code: string, name: string]> = [
  ["ru", "Русский"], ["en", "English"], ["ko", "한국어"], ["uk", "Українська"], ["be", "Беларуская"],
  ["kk", "Қазақша"], ["uz", "Oʻzbekcha"], ["az", "Azərbaycanca"], ["hy", "Հայերեն"], ["ka", "ქართული"],
  ["de", "Deutsch"], ["fr", "Français"], ["es", "Español"], ["it", "Italiano"], ["pt", "Português"],
  ["pl", "Polski"], ["cs", "Čeština"], ["nl", "Nederlands"], ["sv", "Svenska"], ["fi", "Suomi"],
  ["ro", "Română"], ["hu", "Magyar"], ["el", "Ελληνικά"], ["bg", "Български"], ["sr", "Српски"],
  ["tr", "Türkçe"], ["ar", "العربية"], ["he", "עברית"], ["fa", "فارسی"], ["hi", "हिन्दी"],
  ["zh", "中文"], ["ja", "日本語"], ["th", "ไทย"], ["vi", "Tiếng Việt"], ["id", "Bahasa Indonesia"],
];

export const langName = (code?: string | null) => LIVE_LANGS.find(([c]) => c === code)?.[1] ?? (code || "");
