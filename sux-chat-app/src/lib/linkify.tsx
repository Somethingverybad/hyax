import { Capacitor } from "@capacitor/core";
import { useNavigate } from "react-router-dom";
import { PUBLIC_ORIGIN, LINK_ORIGIN } from "./share";
import { emojify } from "@/components/NotoEmoji";

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
    // Нейтральный wyx.su (так делятся сейчас) и основной домен (старые ссылки).
    const link = new URL(LINK_ORIGIN).host;
    if (u.host !== new URL(PUBLIC_ORIGIN).host && u.host !== link && u.host !== `www.${link}`) return null;
    return /^\/(u|c|sp|stp|t|pl|air)\/[^/]+\/?$/.test(u.pathname) ? u.pathname + u.search : null;
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

/** Ключ плейлиста из ссылки /pl/<ключ> — для карточки плейлиста в сообщении и посте. */
export function playlistLinkToken(raw: string): string | null {
  const m = /^\/pl\/([^/?#]+)/.exec(internalPath(raw) || "");
  return m ? m[1] : null;
}

/** Эфир из ссылки /air/<id> — для карточки эфира в сообщении и посте. */
export function stationLinkId(raw: string): string | null {
  const m = /^\/air\/([0-9a-f-]{36})/i.exec(internalPath(raw) || "");
  return m ? m[1].toLowerCase() : null;
}

/** Ник из ссылки на профиль /u/<ник> — для карточки профиля в сообщении. */
export function profileLinkName(raw: string): string | null {
  const m = /^\/u\/([^/?]+)/.exec(internalPath(raw) || "");
  if (!m) return null;
  try { return decodeURIComponent(m[1]); } catch { return m[1]; }
}

/** Канал из ссылки /c/<@ник|id>[?post=<id>] — для карточки канала в сообщении. */
export function channelLinkRef(raw: string): { handle: string; post?: string } | null {
  const path = internalPath(raw);
  const m = path && /^\/c\/([^/?#]+)/.exec(path);
  if (!m) return null;
  let handle = m[1];
  try { handle = decodeURIComponent(handle); } catch { /* оставляем как есть */ }
  const post = /[?&]post=([^&#]+)/.exec(raw)?.[1];
  return { handle, post: post ? decodeURIComponent(post) : undefined };
}

export const openExternal = (url: string) => {
  const href = url.startsWith("http") ? url : `https://${url}`;
  const w = window as unknown as { electronAPI?: { openExternal?: (u: string) => void } };
  if (w.electronAPI?.openExternal) { w.electronAPI.openExternal(href); return; }
  if (Capacitor.isNativePlatform()) { window.open(href, "_system"); return; }
  window.open(href, "_blank", "noopener,noreferrer");
};

/** Текст с кликабельными ссылками и эмодзи Noto; переводы строк сохраняет CSS (whitespace-pre-wrap). */
export function Linkify({ text, className }: { text: string; className?: string }) {
  const navigate = useNavigate();
  const parts: React.ReactNode[] = [];
  let last = 0;
  let m: RegExpExecArray | null;
  URL_RE.lastIndex = 0;
  while ((m = URL_RE.exec(text)) !== null) {
    const [url, tail] = trimTail(m[0]);
    if (m.index > last) parts.push(emojify(text.slice(last, m.index), `p${last}`));
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
  if (!parts.length) return <>{emojify(text)}</>;
  if (last < text.length) parts.push(emojify(text.slice(last), `p${last}`));
  return <>{parts}</>;
}
