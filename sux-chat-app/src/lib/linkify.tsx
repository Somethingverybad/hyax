import { Capacitor } from "@capacitor/core";
import { useNavigate } from "react-router-dom";
import { PUBLIC_ORIGIN } from "./share";

/**
 * Ссылки в тексте сообщений: находим http(s)/www и делаем кликабельными.
 *
 * Чужие ссылки открываем во внешнем браузере, а не внутри приложения: в
 * Electron — через shell.openExternal (main.cjs слушает setWindowOpenHandler и
 * 'open-external'), в мобильной сборке WebView сам отдаёт ссылку системе,
 * в вебе — обычная вкладка. Без этого чужой сайт открылся бы прямо поверх
 * мессенджера, из которого некуда вернуться.
 *
 * А свои ссылки (профиль, канал, паки, тема) открываем внутри приложения: во
 * внешнем браузере нет сессии, и пак звуков по ссылке из переписки просто не
 * загружался — «Пак не найден».
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

/** Путь внутри приложения, если это ссылка на наши же страницы. */
export function internalPath(raw: string): string | null {
  try {
    const u = new URL(raw.startsWith("http") ? raw : `https://${raw}`);
    if (u.host !== new URL(PUBLIC_ORIGIN).host) return null;
    return /^\/(u|c|sp|stp|t)\/[^/]+\/?$/.test(u.pathname) ? u.pathname + u.search : null;
  } catch {
    return null;
  }
}

/** Куда ведёт ссылка: пак звуков, стикерпак или тема — для карточки в сообщении. */
export function packLinkKind(raw: string): { kind: "sound" | "sticker" | "theme"; id: string } | null {
  const path = internalPath(raw);
  const m = path && /^\/(sp|stp|t)\/([^/]+)/.exec(path);
  if (!m) return null;
  return { kind: m[1] === "sp" ? "sound" : m[1] === "stp" ? "sticker" : "theme", id: m[2] };
}

export const openExternal = (url: string) => {
  const href = url.startsWith("http") ? url : `https://${url}`;
  const w = window as unknown as { electronAPI?: { openExternal?: (u: string) => void } };
  if (w.electronAPI?.openExternal) { w.electronAPI.openExternal(href); return; }
  if (Capacitor.isNativePlatform()) { window.open(href, "_system"); return; }
  window.open(href, "_blank", "noopener,noreferrer");
};

/** Текст с кликабельными ссылками; переводы строк сохраняет CSS (whitespace-pre-wrap). */
export function Linkify({ text, className }: { text: string; className?: string }) {
  const navigate = useNavigate();
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
        onClick={(e) => {
          e.preventDefault(); e.stopPropagation();
          const inside = internalPath(url);
          if (inside) navigate(inside);
          else openExternal(url);
        }}
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
