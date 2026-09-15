import { Capacitor } from "@capacitor/core";

/**
 * Ссылки в тексте сообщений: находим http(s)/www и делаем кликабельными.
 *
 * Открываем всегда во внешнем браузере, а не внутри приложения: в Electron —
 * через shell.openExternal (main.cjs слушает setWindowOpenHandler и
 * 'open-external'), в мобильной сборке WebView сам отдаёт ссылку системе,
 * в вебе — обычная вкладка. Без этого чужой сайт открылся бы прямо поверх
 * мессенджера, из которого некуда вернуться.
 */
const URL_RE = /((?:https?:\/\/|www\.)[^\s<>"']+)/gi;

/** Отрезаем хвостовую пунктуацию: «ссылка.» или «(ссылка)» — частый случай. */
const trimTail = (raw: string): [string, string] => {
  let url = raw;
  let tail = "";
  while (url.length > 1 && /[.,;:!?)\]}»]$/.test(url)) {
    // Закрывающую скобку оставляем, если она парная (ссылки из Википедии).
    const last = url[url.length - 1];
    if ((last === ")" && (url.match(/\(/g) || []).length > (url.match(/\)/g) || []).length) ||
        (last === "]" && (url.match(/\[/g) || []).length > (url.match(/\]/g) || []).length)) break;
    tail = last + tail;
    url = url.slice(0, -1);
  }
  return [url, tail];
};

export const openExternal = (url: string) => {
  const href = url.startsWith("http") ? url : `https://${url}`;
  const w = window as unknown as { electronAPI?: { openExternal?: (u: string) => void } };
  if (w.electronAPI?.openExternal) { w.electronAPI.openExternal(href); return; }
  if (Capacitor.isNativePlatform()) { window.open(href, "_system"); return; }
  window.open(href, "_blank", "noopener,noreferrer");
};

/** Текст с кликабельными ссылками; переводы строк сохраняет CSS (whitespace-pre-wrap). */
export function Linkify({ text, className }: { text: string; className?: string }) {
  const parts: React.ReactNode[] = [];
  let last = 0;
  let m: RegExpExecArray | null;
  URL_RE.lastIndex = 0;
  while ((m = URL_RE.exec(text)) !== null) {
    const [url, tail] = trimTail(m[0]);
    if (m.index > last) parts.push(text.slice(last, m.index));
    parts.push(
      <a
        key={`${m.index}-${url}`}
        href={url.startsWith("http") ? url : `https://${url}`}
        onClick={(e) => { e.preventDefault(); e.stopPropagation(); openExternal(url); }}
        className={className ?? "underline underline-offset-2 break-all"}
        rel="noopener noreferrer"
        target="_blank"
      >
        {url}
      </a>,
    );
    if (tail) parts.push(tail);
    last = m.index + m[0].length;
  }
  if (!parts.length) return <>{text}</>;
  if (last < text.length) parts.push(text.slice(last));
  return <>{parts}</>;
}
