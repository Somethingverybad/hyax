/**
 * Переводчик вставленного текста (components/TranslatorHost): открыть можно
 * откуда угодно — кнопкой в шапке чатов, сочетанием клавиш на компьютере
 * (electron/main.cjs). С текстом — сразу переводит его.
 */
const EVENT = "hyax:translator";

export function openTranslator(text?: string) {
  window.dispatchEvent(new CustomEvent<string | undefined>(EVENT, { detail: text }));
}

export function onTranslator(cb: (text?: string) => void): () => void {
  const h = (e: Event) => cb((e as CustomEvent<string | undefined>).detail);
  window.addEventListener(EVENT, h);
  return () => window.removeEventListener(EVENT, h);
}
