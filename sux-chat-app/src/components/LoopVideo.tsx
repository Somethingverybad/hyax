import { useEffect, useRef, useState } from "react";

/**
 * Короткое зацикленное видео без звука — анимированный аватар или стикер.
 * Играет, только пока на экране: в сетке стикеров и в списке чатов их
 * десятки, а одновременно проигрываемых видео у телефона немного (Android
 * WebView упирается в число декодеров). Вне экрана и до загрузки — кадр.
 */
const LoopVideo = ({ src, poster, className, alt, loop = true }: { src: string; poster?: string; className?: string; alt?: string; loop?: boolean }) => {
  const box = useRef<HTMLSpanElement>(null);
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    const el = box.current;
    if (!el || typeof IntersectionObserver === "undefined") { setVisible(true); return; }
    const io = new IntersectionObserver(([e]) => setVisible(e.isIntersecting), { rootMargin: "100px" });
    io.observe(el);
    return () => io.disconnect();
  }, []);
  return (
    <span ref={box} className={className} style={{ display: "inline-block", overflow: "hidden", position: "relative" }} aria-label={alt}>
      {poster && <img src={poster} alt="" draggable={false} className="absolute inset-0 w-full h-full object-cover" style={{ objectFit: "inherit" }} />}
      {visible && (
        <video
          ref={(v) => {
            if (!v) return;
            // iOS запускает автовоспроизведение только у беззвучного видео —
            // и проверяет атрибут, а React ставит лишь свойство.
            v.muted = true;
            v.defaultMuted = true;
            v.setAttribute("muted", "");
            v.play?.().catch(() => { /* энергосбережение iOS — остаётся кадр */ });
          }}
          src={src}
          poster={poster}
          autoPlay
          loop={loop}
          muted
          playsInline
          preload="auto"
          disablePictureInPicture
          className="absolute inset-0 w-full h-full"
          style={{ objectFit: "inherit" }}
        />
      )}
    </span>
  );
};

export default LoopVideo;
