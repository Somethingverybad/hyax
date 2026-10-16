import { useEffect, useRef, useState } from "react";
import { applog } from "@/lib/applog";

/** Анимированный WebP рядом с видео: «….mp4» → «….mp4.webp» (chat/views.py: anim_webp). */
const webpOf = (src: string) => src.replace(/\.mp4(\?.*)?$/i, ".mp4.webp$1");

// Отказ в автозапуске пишем в журнал один раз: по нему в баг-репорте видно,
// что видео у человека не запускаются (энергосбережение), а не сломаны.
let deniedLogged = false;

/**
 * Короткое зацикленное видео без звука — анимированный аватар или стикер.
 * Играет, только пока на экране: в сетке стикеров и в списке чатов их
 * десятки, а одновременно проигрываемых видео у телефона немного (Android
 * WebView упирается в число декодеров). Вне экрана и до загрузки — кадр.
 *
 * Как у видео-обоев (WallpaperVideo): пока видео реально не играет, его не
 * видно — прозрачность прячет и системную кнопку «play», которую iOS рисует
 * поверх видео на паузе; снизу лежит кадр. Если iOS не дала запустить видео
 * (энергосбережение), вместо него крутится анимированный WebP того же ролика:
 * картинки система анимирует всегда.
 *
 * Запускать видео по касанию экрана нельзя: так первое касание поля ввода
 * уходило на видео, и печатать получалось только со второго.
 */
const LoopVideo = ({ src, poster, className, alt, loop = true }: { src: string; poster?: string; className?: string; alt?: string; loop?: boolean }) => {
  const box = useRef<HTMLSpanElement>(null);
  const video = useRef<HTMLVideoElement>(null);
  const [visible, setVisible] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [denied, setDenied] = useState(false);
  const [noWebp, setNoWebp] = useState(false);
  useEffect(() => { setDenied(false); setNoWebp(false); }, [src]);
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
    let alive = true;
    const tryPlay = () => {
      v.play().catch((e: DOMException) => {
        // AbortError — видео сняли с экрана раньше, чем оно запустилось: это не отказ.
        if (!alive || e?.name === "AbortError") return;
        if (!deniedLogged) { deniedLogged = true; applog.warn(`loop video: автозапуск запрещён (${e?.name || "?"}) — анимация картинкой`); }
        setDenied(true);
      });
    };
    if (v.readyState >= 2) tryPlay(); else v.addEventListener("loadeddata", tryPlay, { once: true });
    return () => { alive = false; v.removeEventListener("loadeddata", tryPlay); };
  }, [visible, src, denied]);
  const showWebp = denied && !noWebp;
  return (
    <span ref={box} className={className} style={{ display: "inline-block", overflow: "hidden", position: "relative" }} aria-label={alt}>
      {poster && <img src={poster} alt="" draggable={false} className="absolute inset-0 w-full h-full object-cover" style={{ objectFit: "inherit" }} />}
      {/* Видео не дали запустить — анимированная картинка (вне экрана её не
          держим, как и видео). Её нет (старый файл) — остаётся кадр. */}
      {showWebp && visible && (
        <img src={webpOf(src)} alt="" draggable={false} onError={() => setNoWebp(true)}
          className="absolute inset-0 w-full h-full object-cover" style={{ objectFit: "inherit" }} />
      )}
      {visible && !denied && (
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
