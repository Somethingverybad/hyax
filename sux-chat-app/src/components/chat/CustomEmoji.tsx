import { useEffect, useRef, useState, type CSSProperties } from "react";
import { mediaUrl } from "@/api/client";
import { isTgs } from "@/components/chat/StickerView";
import { mountTgs } from "@/lib/tgsPlayer";
import { cn } from "@/lib/utils";

/**
 * Свой эмодзи (набор эмодзи, StickerPack kind=emoji): картинка, анимированный
 * WebP (видеоэмодзи Telegram) или .tgs — Lottie, как анимированные стикеры;
 * играет, только пока на экране. repaint — одноцветный значок Telegram
 * (needs_repainting): рисуется цветом текста — маской у картинки, заливкой у
 * Lottie. pack — по тапу открыть набор (добавить себе).
 */
const CustomEmoji = ({ url, alt, pack, repaint, loop = true, className, style }: {
  url: string;
  alt: string;
  pack?: string | null;
  repaint?: boolean;
  loop?: boolean;
  className?: string;
  style?: CSSProperties;
}) => {
  const src = mediaUrl(url);
  const tgs = isTgs(src);
  const box = useRef<HTMLSpanElement>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!tgs || !box.current) return;
    // Перекраска — через svg: заливку его путей переопределяет CSS (.cemoji-repaint).
    return mountTgs(box.current, src, { loop, renderer: repaint ? "svg" : "canvas", onError: () => setFailed(true) });
  }, [src, tgs, loop, repaint]);

  const open = pack ? (e: React.MouseEvent) => {
    e.stopPropagation();
    window.dispatchEvent(new CustomEvent("hyax:navigate", { detail: `/stp/${pack}` }));
  } : undefined;
  const common = {
    className: cn(className, repaint && "cemoji-repaint", pack && "cursor-pointer"),
    title: alt,
    onClick: open,
    role: "img" as const,
    "aria-label": alt,
  };

  if (tgs) {
    if (failed) return <span {...common} style={style}>{alt}</span>;
    return <span ref={box} {...common} style={style} />;
  }
  if (repaint) {
    // Маска: форма значка из картинки, цвет — текущий цвет текста.
    const mask = `url("${src}") center / contain no-repeat`;
    return <span {...common} style={{ ...style, backgroundColor: "currentColor", WebkitMask: mask, mask }} />;
  }
  return <img src={src} alt={alt} draggable={false} loading="lazy" {...common} style={style} />;
};

export default CustomEmoji;
