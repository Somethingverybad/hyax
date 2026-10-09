import type { CSSProperties } from "react";
import "@fontsource-variable/inter";
import "./mint.css";
import { useTheme } from "@/lib/theme";
import back from "./icons/back.svg";
import checks from "./icons/checks.svg";
import chevron from "./icons/chevron.svg";
import close from "./icons/close.svg";
import attach from "./icons/attach.svg";
import sticker from "./icons/compose-left.svg";
import mic from "./icons/mic.svg";
import send from "./icons/send.svg";
import rev from "./icons/rev.svg";
import camera from "./icons/camera.svg";
import navChat from "./icons/nav-chat.svg";
import navMusic from "./icons/nav-music.svg";
import navProfile from "./icons/nav-profile.svg";
import navSaved from "./icons/nav-saved.svg";
import pencil from "./icons/pencil.svg";
import pinnedRight from "./icons/pinned-right.svg";
import rowAbout from "./icons/row-about.svg";
import rowAppearance from "./icons/row-appearance.svg";
import rowAt from "./icons/row-at.svg";
import rowBell from "./icons/row-bell.svg";
import rowCopy from "./icons/row-copy.svg";
import rowLock from "./icons/row-lock.svg";
import rowSaved from "./icons/row-saved.svg";
import rowSticker from "./icons/row-sticker.svg";
import rowTag from "./icons/row-tag.svg";
import rowBug from "./icons/row-bug.svg";
import rowCache from "./icons/row-cache.svg";
import rowUpdate from "./icons/row-update.svg";
import rowLogout from "./icons/row-logout.svg";
import search from "./icons/search.svg";
import share from "./icons/share.svg";
import sort from "./icons/sort-a.svg";
import soundPlay from "./icons/sound-play.svg";
import stkAdd from "./icons/stk-add.svg";
import stkBookmark from "./icons/stk-bookmark.svg";
import stkRecent from "./icons/stk-recent.svg";

/**
 * Раскладка «Мяты» (макет в Figma): шапки из таблеток, остров навигации,
 * свои иконки. Включается стилем формы soft — тем же признаком, что и CSS
 * в index.css, поэтому своя тема с «мягкими карточками» получает её тоже.
 */
export function useMint(): boolean {
  return useTheme().shape.style === "soft";
}

/** Иконки макета. Красим маской в currentColor: одна и та же иконка годится
 *  и светлой «Мяте», и тёмной. */
export const MINT_ICONS = {
  back, checks, chevron, close, attach, sticker, mic, send, rev, camera, navChat, navMusic, navProfile, navSaved,
  pencil, pinnedRight, rowAbout, rowAppearance, rowAt, rowBell, rowCopy, rowLock, rowSaved,
  rowSticker, rowTag, rowBug, rowCache, rowUpdate, rowLogout, search, share, sort, soundPlay, stkAdd, stkBookmark, stkRecent,
} as const;
export type MintIconName = keyof typeof MINT_ICONS;

/** Иконки, нарисованные в макете повёрнутыми: «назад» и одна из стрелок
 *  сортировки — исходник смотрит в другую сторону. */
const FLIP: Partial<Record<MintIconName, string>> = { back: "scaleX(-1)" };

export function MintIcon({ name, size = 22, className, style }: { name: MintIconName; size?: number | [number, number]; className?: string; style?: CSSProperties }) {
  const url = `url("${MINT_ICONS[name]}")`;
  const [w, h] = Array.isArray(size) ? size : [size, size];
  return (
    <span
      aria-hidden
      className={className}
      style={{
        display: "inline-block", flexShrink: 0, width: w, height: h,
        backgroundColor: "currentColor",
        WebkitMaskImage: url, maskImage: url,
        WebkitMaskRepeat: "no-repeat", maskRepeat: "no-repeat",
        WebkitMaskPosition: "center", maskPosition: "center",
        WebkitMaskSize: "contain", maskSize: "contain",
        transform: FLIP[name],
        ...style,
      }}
    />
  );
}
