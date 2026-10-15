import { useRef, type ImgHTMLAttributes } from "react";
import { useCachedImage } from "@/lib/imageCache";
import { LoadingSkeleton } from "@/components/LoadingSkeleton";
import LoopVideo from "@/components/LoopVideo";
import { animVideo } from "@/lib/animMedia";

/** <img> через кэш картинок (lib/imageCache): аватары групп, обложки. */
export default function CachedImg({ src, className, ...rest }: ImgHTMLAttributes<HTMLImageElement> & { src: string }) {
  const s = useCachedImage(src);
  const waited = useRef(false);
  if (!s) { waited.current = true; return <LoadingSkeleton className={className} />; }
  // Видео-аватар группы или канала: кадр из кэша, рядом видео (lib/animMedia).
  const vid = animVideo(src);
  if (vid) return <LoopVideo src={vid} poster={s} className={className} alt={rest.alt} />;
  return <img src={s} className={`${className || ""}${waited.current ? " ui-fade-in" : ""}`} draggable={false} {...rest} />;
}
