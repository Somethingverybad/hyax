import type { ImgHTMLAttributes } from "react";
import { useCachedImage } from "@/lib/imageCache";

/** <img> через кэш картинок (lib/imageCache): аватары групп, обложки. */
export default function CachedImg({ src, className, ...rest }: ImgHTMLAttributes<HTMLImageElement> & { src: string }) {
  const s = useCachedImage(src);
  if (!s) return <span className={`${className || ""} block bg-surface-4`} aria-hidden />;
  return <img src={s} className={className} draggable={false} {...rest} />;
}
