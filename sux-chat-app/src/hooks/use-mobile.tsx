import * as React from "react";

/**
 * Десктопная раскладка (две колонки) — только когда окну хватает и ширины, и
 * высоты. Одной ширины мало: телефон в горизонтали шире 768 px (iPhone 16 —
 * 852×393), и приложение перескакивало в десктопный вид на экране высотой с
 * две строки. Тот же запрос стоит за вариантом `md:` в tailwind.config.ts и
 * в index.css — JS и CSS обязаны переключаться одновременно.
 */
export const DESKTOP_QUERY = "(min-width: 768px) and (min-height: 500px)";

export function useIsMobile() {
  const [isMobile, setIsMobile] = React.useState<boolean | undefined>(undefined);

  React.useEffect(() => {
    const mql = window.matchMedia(DESKTOP_QUERY);
    // Читаем mql.matches, а не window.innerWidth: WKWebView в момент события
    // поворота ещё отдаёт старую ширину, и после возврата в вертикаль
    // приложение оставалось в десктопной раскладке.
    const sync = () => setIsMobile(!mql.matches);
    // После поворота iOS доводит размеры не сразу — перепроверяем с задержкой.
    const syncLater = () => { sync(); window.setTimeout(sync, 150); window.setTimeout(sync, 500); };
    mql.addEventListener("change", sync);
    window.addEventListener("orientationchange", syncLater);
    window.addEventListener("resize", sync);
    sync();
    return () => {
      mql.removeEventListener("change", sync);
      window.removeEventListener("orientationchange", syncLater);
      window.removeEventListener("resize", sync);
    };
  }, []);

  return !!isMobile;
}
