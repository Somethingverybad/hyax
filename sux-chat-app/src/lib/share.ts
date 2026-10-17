/**
 * Поделиться профилем. Людей находят и поиском по нику (кроме скрывших себя
 * из поиска), но ссылка — самый прямой путь, и она работает всегда. Ссылка
 * https://wyx.su/u/<ник>: на телефоне с установленным WYXом она открывается
 * прямо в приложении (universal link / app link), у остальных — карточкой на
 * wyx.su с «Открыть в WYX», «Веб-версия» и «Скачать». Так же — каналы, паки,
 * темы и плейлисты. Старые ссылки на основной домен работают как раньше.
 *
 * Через системное меню «Поделиться» (Web Share API — работает в WKWebView и
 * Android WebView), с откатом в буфер обмена.
 */
import { Capacitor } from "@capacitor/core";
import { t } from "./i18n";
import { writeClipboard } from "./clipboard";

export type ShareResult = "shared" | "copied" | "error";

/** Основной домен: веб-версия, тайлы карты, установщики, перенос ключей (/kt/).
 *  Захардкожен: в нативной сборке origin — capacitor://localhost. */
export const PUBLIC_ORIGIN = "https://huyax.e-tree.su";
/** Домен ссылок «Поделиться» — нейтральный (nginx/conf.d/wyx.conf). */
export const LINK_ORIGIN = "https://wyx.su";

export const profileLink = (username: string) => `${LINK_ORIGIN}/u/${encodeURIComponent(username)}`;
/** Мини-приложение бота: https://wyx.su/u/<бот>?app. */
export const miniAppLink = (username: string) => `${LINK_ORIGIN}/u/${encodeURIComponent(username)}?app`;
/** Ссылка на тему оформления — /t/<id>, как у паков. */
export const themeLink = (id: string) => `${LINK_ORIGIN}/t/${id}`;

/** Ссылка на пак звуков: по ней пак добавляют себе (см. pages/SoundPackPage). */
export const soundPackLink = (id: string) => `${LINK_ORIGIN}/sp/${id}`;
/** Ссылка на стикерпак: по ней пак добавляют себе (см. pages/StickerPackPage). */
export const stickerPackLink = (id: string) => `${LINK_ORIGIN}/stp/${id}`;

/** Плейлист по ссылке: ключ, а не id — доступ можно отозвать. */
export const playlistLink = (token: string) => `${LINK_ORIGIN}/pl/${token}`;

/** Ссылка на канал: по @username, а без него — по id (канал без хэндла тоже можно передать). */
export const channelLink = (ch: { id: string; username?: string | null }) =>
  `${LINK_ORIGIN}/c/${encodeURIComponent(ch.username || ch.id)}`;

/* Ссылка — внутри текста, одним элементом. Если отдать text и url порознь,
   пункт «Скопировать» системного меню на iPhone берёт только первый —
   в буфере оказывался текст без ссылки («Напиши мне в WYX»). */
/**
 * Системное «Поделиться». Android — нативным плагином: в Android WebView нет
 * Web Share, а WebView Huawei без сервисов Google не давал и буфер обмена —
 * кнопка не делала ничего. iPhone — Web Share, как раньше. true — показали
 * (или человек закрыл окно сам), null — не вышло, пора в буфер.
 */
async function systemShare(d: { title?: string; text?: string; url?: string }): Promise<true | null> {
  if (Capacitor.getPlatform() === "android") {
    try {
      const { Share } = await import("@capacitor/share");
      await Share.share({ title: d.title, text: d.text, url: d.url, dialogTitle: d.title });
      return true;
    } catch (e: any) {
      if (/cancel/i.test(String(e?.message || e))) return true;
    }
  }
  const nav = navigator as Navigator & { share?: (d: any) => Promise<void> };
  if (typeof nav.share === "function") {
    try { await nav.share(d); return true; }
    catch (e: any) { if (e?.name === "AbortError") return true; }
  }
  return null;
}

async function shareUrl(title: string, text: string, url: string): Promise<ShareResult> {
  if (await systemShare({ title, text: `${text}: ${url}` })) return "shared";
  try { await writeClipboard(`${text}: ${url}`); return "copied"; }
  catch { return "error"; }
}

/** Поделиться паком звуков: системное окно «Поделиться», иначе — буфер. */
/** Поделиться мини-приложением бота — ссылкой на wyx.su. */
export const shareMiniApp = (title: string, username: string) =>
  shareUrl("WYX", t("«{name}» в WYX", { name: title }), miniAppLink(username));

export const shareSoundPack = (name: string, id: string) =>
  shareUrl("WYX", t("Пак звуков «{name}» в WYX", { name }), soundPackLink(id));

/** Поделиться стикерпаком: системное окно «Поделиться», иначе — буфер. */
export const shareStickerPack = (name: string, id: string) =>
  shareUrl("WYX", t("Стикеры «{name}» в WYX", { name }), stickerPackLink(id));

/** Набор своих эмодзи — та же страница набора, другая подпись. */
export const shareEmojiPack = (name: string, id: string) =>
  shareUrl("WYX", t("Эмодзи «{name}» в WYX", { name }), stickerPackLink(id));

/** Поделиться плейлистом: системное окно «Поделиться», иначе — буфер. */
export const sharePlaylistLink = (name: string, token: string) =>
  shareUrl("WYX", t("Плейлист «{name}» в WYX", { name }), playlistLink(token));

export const shareChannel = (ch: { id: string; name: string; username?: string | null }) =>
  shareUrl("WYX", t("Канал «{name}» в WYX", { name: ch.name }), channelLink(ch));

/** Ссылка на пост канала: та же страница канала, ?post= — к какому посту
 *  прокрутить (см. PublicChannel → ChannelView). */
export const postLink = (ch: { id: string; username?: string | null }, postId: string) =>
  `${channelLink(ch)}?post=${encodeURIComponent(postId)}`;

/** Поделиться постом наружу: первая строка текста поста — как подпись. */
export const sharePost = (ch: { id: string; name: string; username?: string | null }, postId: string, text?: string | null) => {
  const line = (text || "").trim().split("\n")[0].slice(0, 120);
  return shareUrl("WYX", line ? t("{line} — «{name}» в WYX", { line, name: ch.name }) : t("Пост из канала «{name}» в WYX", { name: ch.name }), postLink(ch, postId));
};

/** Профиль — только ссылкой, без подписи: «Скопировать» в системном меню
 *  кладёт в буфер ровно её. */
export async function shareProfile(username: string): Promise<ShareResult> {
  const url = profileLink(username);
  // Только ссылка: так её берут и мессенджеры, и пункт «Скопировать».
  if (await systemShare({ url })) return "shared";
  try {
    await writeClipboard(url);
    return "copied";
  } catch {
    return "error";
  }
}
