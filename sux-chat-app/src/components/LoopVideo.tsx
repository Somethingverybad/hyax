import { useEffect, useRef, useState } from "react";

/**
 * Видео, которым iOS отказала в автозапуске (энергосбережение, лимит
 * одновременных видео): запускаем снова по первому касанию экрана — после
 * жеста пользователя система разрешает. Слушатель один на все видео: аватаров
 * и стикеров на экране десятки.
 */
const waiting = new Set<HTMLVideoElement>();
let gestureBound = false;
const onGesture = () => {
  window.removeEventListener("touchend", onGesture);
  window.removeEventListener("pointerdown", onGesture);
  gestureBound = false;
  const list = [...waiting];
  waiting.clear();
  list.forEach((v) => { if (v.isConnected) v.play().catch(() => {}); });
};
const retryOnGesture = (v: HTMLVideoElement) => {
  waiting.add(v);
  if (gestureBound) return;
  gestureBound = true;
  window.addEventListener("touchend", onGesture, { passive: true });
  window.addEventListener("pointerdown", onGesture, { passive: true });
};

/**
 * Короткое зацикленное видео без звука — анимированный аватар или стикер.
 * Играет, только пока на экране: в сетке стикеров и в списке чатов их
 * десятки, а одновременно проигрываемых видео у телефона немного (Android
 * WebView упирается в число декодеров). Вне экрана и до загрузки — кадр.
 *
 * Как у видео-обоев (WallpaperVideo): пока видео реально не играет, его не
 * видно — прозрачность прячет и системную кнопку «play», которую iOS рисует
 * поверх видео на паузе; снизу лежит кадр. Запускаем после загрузки первых
 * кадров, а при отказе — повторяем по первому касанию экрана.
 */
const LoopVideo = ({ src, poster, className, alt, loop = true }: { src: string; poster?: string; className?: string; alt?: string; loop?: boolean }) => {
  const box = useRef<HTMLSpanElement>(null);
  const video = useRef<HTMLVideoElement>(null);
  const [visible, setVisible] = useState(false);
  const [playing, setPlaying] = useState(false);
  useEffect(() => {
    const el = box.current;
    if (!el || typeof IntersectionObserver === "undefined") { setVisible(true); return; }
    const io = new IntersectionObserver(([e]) => setVisible(e.isIntersecting), { rootMargin: "100px" });
    io.observe(el);
    return () => io.disconnect();
  }, []);
  useEffect(() => {
    const v = video.current;
    if (!visible || !v) { setPlaying(false); return; }
    // iOS запускает автовоспроизведение только у беззвучного видео — и
    // проверяет атрибуты, а React ставит лишь свойства.
    v.muted = true;
    v.defaultMuted = true;
    v.setAttribute("muted", "");
    v.setAttribute("playsinline", "");
    const tryPlay = () => { v.play().catch(() => retryOnGesture(v)); };
    if (v.readyState >= 2) tryPlay(); else v.addEventListener("loadeddata", tryPlay, { once: true });
    return () => { v.removeEventListener("loadeddata", tryPlay); waiting.delete(v); };
  }, [visible, src]);
  return (
    <span ref={box} className={className} style={{ display: "inline-block", overflow: "hidden", position: "relative" }} aria-label={alt}>
      {poster && <img src={poster} alt="" draggable={false} className="absolute inset-0 w-full h-full object-cover" style={{ objectFit: "inherit" }} />}
      {visible && (
        <video
          ref={video}
          src={src}
          poster={poster}
          autoPlay
          loop={loop}
          muted
          playsInline
          preload="auto"
          disablePictureInPicture
          onPlaying={() => setPlaying(true)}
          onPause={() => setPlaying(false)}
          className="loop-video absolute inset-0 w-full h-full"
          style={{ objectFit: "inherit", opacity: playing || !poster ? 1 : 0 }}
        />
      )}
    </span>
  );
};

export default LoopVideo;
