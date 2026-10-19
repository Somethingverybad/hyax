import { Capacitor } from "@capacitor/core";
import { App } from "@capacitor/app";
import { APP_VERSION, APP_BUILD } from "./appVersion";
import { t } from "./i18n";

/**
 * Проверка обновлений через манифест на сервере (/apk/version.json). Клиент
 * сравнивает свою APP_VERSION с версией из манифеста и, если серверная выше,
 * показывает плашку. Ссылку на файл выбираем под платформу.
 */
const MANIFEST_URL = "https://cdn.huyax.e-tree.su/apk/version.json";
const MANIFEST_URL_DIRECT = "https://huyax.e-tree.su/apk/version.json";

/**
 * Сборка для Google Play (VITE_DISTRIBUTION=play): на Android обновляет только
 * Play — правила магазина запрещают приложению ставить себя в обход него, так
 * что плашки с APK нет, а «Проверить обновления» открывает страницу в Play.
 */
export const PLAY_BUILD = import.meta.env.VITE_DISTRIBUTION === "play";
export const PLAY_URL = "https://play.google.com/store/apps/details?id=com.hyax.messenger";

export function updatesViaPlay() {
  return PLAY_BUILD && Capacitor.getPlatform() === "android";
}

export interface UpdateManifest {
  version: string;
  /** Номер сборки (число коммитов). Версия может не меняться неделями, а
   *  сборки идти каждый день — без сравнения сборок тестировщики сидели на
   *  старой и видели «установлена последняя версия». */
  build?: number;
  notes?: string;
  files?: { mac?: string; win?: string; linux?: string; linux_deb?: string; android?: string; ios?: string };
}

export interface UpdateInfo {
  version: string;
  notes?: string;
  /** Прямой URL установщика для текущей платформы (может отсутствовать, напр. iOS). */
  fileUrl?: string;
  fileName?: string;
  /** Десктоп умеет обновиться изнутри (скачать+запустить). */
  desktop: boolean;
}

function cmp(a: string, b: string): number {
  const pa = a.split(".").map((n) => parseInt(n, 10) || 0);
  const pb = b.split(".").map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] || 0) - (pb[i] || 0);
    if (d) return d;
  }
  return 0;
}

function desktopOs(): "mac" | "win" | "linux" {
  const ua = (navigator.userAgent || "").toLowerCase();
  if (ua.includes("mac")) return "mac";
  if (ua.includes("win")) return "win";
  return "linux";
}

export async function checkForUpdate(): Promise<UpdateInfo | null> {
  if (updatesViaPlay()) return null;
  try {
    // Манифест через CDN, при сетевой ошибке — напрямую с сервера.
    const res = await fetch(`${MANIFEST_URL}?t=${Date.now()}`, { cache: "no-store", signal: AbortSignal.timeout(5000) })
      .catch(() => fetch(`${MANIFEST_URL_DIRECT}?t=${Date.now()}`, { cache: "no-store" }));
    if (!res.ok) return null;
    const m: UpdateManifest = await res.json();
    if (!m?.version) return null;
    // Android сравнивает установленный APK, а не веб-бандл: бандл мог прийти по
    // воздуху (lib/ota.ts) и быть новее — APK от этого новее не стал, и
    // наоборот, правка одного бандла не повод ставить APK заново.
    let version = APP_VERSION;
    let build = APP_BUILD;
    if (Capacitor.getPlatform() === "android") {
      try { const info = await App.getInfo(); version = info.version || version; build = info.build || build; } catch { /* как раньше — по бандлу */ }
    }
    // Компьютер — так же по установщику: веб-часть могла прийти по воздуху
    // (electron/ota.cjs) и быть новее того, что внутри программы.
    const ed = (window as { electronAPI?: { otaInfo?: () => Promise<{ builtinVersion: string; builtinBuild: number } | null> } }).electronAPI;
    if (ed?.otaInfo) {
      try { const i = await ed.otaInfo(); if (i?.builtinBuild) { version = i.builtinVersion || version; build = String(i.builtinBuild); } } catch { /* по бандлу */ }
    }
    const byVersion = cmp(m.version, version);
    const localBuild = parseInt(build, 10) || 0;
    const newer = byVersion > 0 || (byVersion === 0 && typeof m.build === "number" && localBuild > 0 && m.build > localBuild);
    if (!newer) return null;

    const isDesktop = !!(window as any).electronAPI;
    const platform = Capacitor.getPlatform(); // ios | android | web
    let fileUrl: string | undefined;
    let fileName: string | undefined;

    if (isDesktop) {
      const os = desktopOs();
      fileUrl = m.files?.[os];
      // Linux из .deb обновляется только новым .deb: AppImage ему бесполезен.
      if (os === "linux" && m.files?.linux_deb) {
        const kind = await (window as any).electronAPI?.installKind?.().catch(() => null);
        if (kind === "deb") fileUrl = m.files.linux_deb;
      }
      fileName = fileUrl?.split("/").pop();
    } else if (platform === "android") {
      fileUrl = m.files?.android;
      fileName = fileUrl?.split("/").pop();
    } else if (platform === "ios") {
      // Обновления iOS идут через TestFlight/App Store. Без ссылки для iOS
      // плашка вела бы на страницу с APK и десктопными установщиками —
      // на айфоне ей нечего предложить, поэтому не показываем её вовсе.
      fileUrl = m.files?.ios;
      if (!fileUrl) return null;
    }

    return {
      version: m.version,
      notes: m.notes,
      fileUrl,
      fileName,
      desktop: isDesktop,
    };
  } catch {
    return null;
  }
}

/**
 * Перейти к установке найденного обновления.
 *
 * Десктоп качает установщик и запускает его сам; телефон и веб — уводим на
 * файл или на страницу загрузок. Вынесено из плашки, чтобы кнопка «Проверить
 * обновления» в профиле вела себя ровно так же.
 */
export type StartUpdateResult =
  /** Установщик открыт (mac/win/AppImage). */
  | { result: "installer" }
  /** Пакет поставлен, приложение сейчас перезапустится (Linux .deb через pkexec). */
  | { result: "restart" }
  /** Ушли на страницу загрузок или файл (телефон, веб). */
  | { result: "opened" }
  /** Пользователь закрыл диалог пароля (Linux). */
  | { result: "cancelled" }
  | { result: "error"; error?: string; file?: string };

export async function startUpdate(info: UpdateInfo): Promise<StartUpdateResult> {
  const api = (window as any).electronAPI;
  if (info.desktop && info.fileUrl && api?.installUpdate) {
    try {
      const r = await api.installUpdate(info.fileUrl, info.fileName || "hyax-update");
      if (r?.ok) return { result: r.restart ? "restart" : "installer" };
      if (r?.error === "cancelled") return { result: "cancelled" };
      return { result: "error", error: r?.error, file: r?.file };
    } catch (e) {
      return { result: "error", error: String((e as Error)?.message || e) };
    }
  }
  const url = info.fileUrl || "https://huyax.e-tree.su/apk/";
  if (api?.openExternal) api.openExternal(url);
  else window.open(url, "_blank");
  return { result: "opened" };
}

/** Текст для тоста, когда установка не удалась: что случилось и где лежит файл. */
export function describeUpdateError(r: Extract<StartUpdateResult, { result: "error" }>): string {
  const base = r.error ? t("Не удалось установить обновление: {error}", { error: r.error }) : t("Не удалось скачать обновление");
  if (!r.file) return base;
  return /\.deb$/i.test(r.file)
    ? `${base}. ${t("Файл сохранён: {file} — установи вручную: sudo dpkg -i \"{file}\"", { file: r.file })}`
    : `${base}. ${t("Файл сохранён: {file}", { file: r.file })}`;
}

/** Обновления iOS приходят через TestFlight — своей ссылки у них обычно нет. */
export function isIosWithoutFile() {
  return Capacitor.getPlatform() === "ios";
}
