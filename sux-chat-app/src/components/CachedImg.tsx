import { useRef, type ImgHTMLAttributes } from "react";
import { useCachedImage } from "@/lib/imageCache";
import { LoadingSkeleton } from "@/components/LoadingSkeleton";

/** <img> через кэш картинок (lib/imageCache): аватары групп, обложки. */
export default function CachedImg({ src, className, ...rest }: ImgHTMLAttributes<HTMLImageElement> & { src: string }) {
  const s = useCachedImage(src);
  const waited = useRef(false);
  if (!s) { waited.current = true; return <LoadingSkeleton className={className} />; }
  return <img src={s} className={`${className || ""}${waited.current ? " ui-fade-in" : ""}`} draggable={false} {...rest} />;
}
