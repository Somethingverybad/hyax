import { Capacitor } from "@capacitor/core";
import { APP_VERSION } from "./appVersion";

/**
 * Проверка обновлений через манифест на сервере (/apk/version.json). Клиент
 * сравнивает свою APP_VERSION с версией из манифеста и, если серверная выше,
 * показывает плашку. Ссылку на файл выбираем под платформу.
 */
const MANIFEST_URL = "https://cdn.huyax.e-tree.su/apk/version.json";
const MANIFEST_URL_DIRECT = "https://huyax.e-tree.su/apk/version.json";

export interface UpdateManifest {
  version: string;
  notes?: string;
  files?: { mac?: string; win?: string; linux?: string; android?: string; ios?: string };
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
  try {
    // Манифест через CDN, при сетевой ошибке — напрямую с сервера.
    const res = await fetch(`${MANIFEST_URL}?t=${Date.now()}`, { cache: "no-store", signal: AbortSignal.timeout(5000) })
      .catch(() => fetch(`${MANIFEST_URL_DIRECT}?t=${Date.now()}`, { cache: "no-store" }));
    if (!res.ok) return null;
    const m: UpdateManifest = await res.json();
    if (!m?.version || cmp(m.version, APP_VERSION) <= 0) return null;

    const isDesktop = !!(window as any).electronAPI;
    const platform = Capacitor.getPlatform(); // ios | android | web
    let fileUrl: string | undefined;
    let fileName: string | undefined;

    if (isDesktop) {
      const os = desktopOs();
      fileUrl = m.files?.[os];
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
