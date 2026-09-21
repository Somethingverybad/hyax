import coverOutlined from "@/assets/pack-cover-outlined.webp";
import coverFlat from "@/assets/pack-cover-flat.webp";
import { getTheme } from "@/lib/theme";
import { mediaUrl } from "@/api/client";

/**
 * Обложка пака: своя, если автор загрузил, иначе — картинка под тему.
 *
 * Две заготовки: «наклейка» с толстой обводкой и жёсткой тенью — под темы с
 * такой же формой (необрутализм и всё, что собрано в этом стиле), и
 * конструктивистская — под плоские темы, тёмную и светлую. Выбираем по форме
 * темы, а не по её имени: пользовательская тема тоже получит подходящую.
 */
export function packCover(cover?: string | null): string {
  if (cover) return mediaUrl(cover);
  return getTheme().shape.style === "outlined" ? coverOutlined : coverFlat;
}
