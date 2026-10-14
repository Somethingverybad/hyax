import coverOutlined from "@/assets/pack-cover-outlined.webp";
import { getTheme } from "@/lib/theme";
import { mediaUrl } from "@/api/client";

/**
 * Обложка пака: своя, если автор загрузил, иначе — заготовка под тему.
 *
 * «Наклейка» с толстой обводкой и жёсткой тенью — под темы с такой же формой
 * (необрутализм и всё, что собрано в этом стиле). Во всех остальных темах —
 * обложка в цветах самой темы: скруглённый квадрат основного цвета с нотой,
 * поэтому она одинаково уместна в «Мяте», стекле, тёмной и светлой, и в любой
 * пользовательской теме. Раньше там стояла красно-чёрная конструктивистская
 * картинка, которая к мятной теме не подходила.
 */
export function packCover(cover?: string | null): string {
  if (cover) return mediaUrl(cover);
  return getTheme().shape.style === "outlined" ? coverOutlined : themedCover();
}

/** Цвет из переменной темы («H S% L%») — в форму, которую понимает SVG везде. */
function themeColor(name: string, fallback: string): string {
  try {
    const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
    const m = v.match(/^(-?[\d.]+)(?:deg)?\s+([\d.]+)%\s+([\d.]+)%/);
    if (m) return `hsl(${m[1]}, ${m[2]}%, ${m[3]}%)`;
  } catch { /* не браузер */ }
  return fallback;
}

let cache: { key: string; url: string } | null = null;

function themedCover(): string {
  const deep = themeColor("--primary-deep", "hsl(165, 32%, 27%)");
  const accent = themeColor("--primary", "hsl(74, 85%, 68%)");
  const key = deep + accent;
  if (cache?.key === key) return cache.url;
  // Нота — форма значка music_note (Material Icons, Apache 2.0), 24 → 96.
  const svg = `<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 96 96'>`
    + `<rect width='96' height='96' rx='24' fill='${deep}'/>`
    + `<circle cx='78' cy='18' r='34' fill='${accent}' opacity='.38'/>`
    + `<circle cx='14' cy='86' r='24' fill='${accent}' opacity='.2'/>`
    + `<g transform='translate(19.2 19.2) scale(2.4)'><path fill='#fff' fill-opacity='.95' d='M12 3v10.55c-.59-.34-1.27-.55-2-.55-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4V7h4V3h-6z'/></g>`
    + `</svg>`;
  const url = `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
  cache = { key, url };
  return url;
}
