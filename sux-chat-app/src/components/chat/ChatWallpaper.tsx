import { useEffect, useRef, useState } from "react";
import { Capacitor } from "@capacitor/core";
import type { ChatWallpaper } from "@/api/client";
import { useMediaUrl } from "@/hooks/use-media-url";
import { getSetting } from "@/lib/settings";

/** Действующие обои: личные перекрывают общие; "none" — скрыты у меня. */
export function effectiveWallpaper(info?: { wallpaper?: ChatWallpaper | null; my_wallpaper?: ChatWallpaper | null } | null): ChatWallpaper | null {
  const my = info?.my_wallpaper, shared = info?.wallpaper;
  if (my?.kind === "none") return null;
  const w = my?.url ? my : shared;
  return w?.url ? w : null;
}

/** Слой обоев под лентой на весь экран (переписка, канал): видео крутится,
 *  если анимация не выключена в настройках, иначе — его постер. */
export function WallpaperLayer({ info }: { info?: { wallpaper?: ChatWallpaper | null; my_wallpaper?: ChatWallpaper | null } | null }) {
  const wallpaper = effectiveWallpaper(info);
  const src = useMediaUrl(wallpaper?.url || null);
  const poster = useMediaUrl(wallpaper?.poster || null);
  // На iOS <video> без жеста может не стартовать — там крутится WebP того же ролика.
  const animSrc = useMediaUrl(Capacitor.getPlatform() === "ios" ? wallpaper?.anim || null : null);
  const [anim, setAnim] = useState(() => getSetting("wallpaper_anim"));
  useEffect(() => {
    const on = (e: Event) => { if ((e as CustomEvent).detail?.key === "wallpaper_anim") setAnim((e as CustomEvent).detail.value); };
    window.addEventListener("hyax:setting", on);
    return () => window.removeEventListener("hyax:setting", on);
  }, []);
  if (!wallpaper || !(src || poster)) return null;
  return (
    <div className="absolute inset-0 -z-10 overflow-hidden pointer-events-none" aria-hidden>
      {wallpaper.kind === "video" && anim && src ? (
        <WallpaperVideo src={src} poster={poster} anim={animSrc || null} />
      ) : (
        <img src={(wallpaper.kind === "video" ? poster : src) || src || undefined} alt="" className="absolute inset-0 w-full h-full object-cover" />
      )}
      <div className="absolute inset-0 bg-black/20" />
    </div>
  );
}

/** Видео-обои. Основной путь — <video>: аппаратно, плавно. Пока оно реально
 *  не играет, его не видно (opacity 0 прячет и системную кнопку «play»), снизу
 *  лежит постер. Если iOS отказала в автозапуске (энергосбережение), вместо
 *  видео крутится анимированный WebP того же ролика, а по первому касанию
 *  экрана пробуем снова запустить видео — и возвращаемся к нему. */
export const WallpaperVideo = ({ src, poster, anim }: { src: string; poster?: string | null; anim?: string | null }) => {
  const ref = useRef<HTMLVideoElement>(null);
  const [playing, setPlaying] = useState(false);
  const [denied, setDenied] = useState(false);
  const [broken, setBroken] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    setBroken(false); setPlaying(false); setDenied(false);
    el.muted = true;
    el.defaultMuted = true;
    el.setAttribute("muted", "");
    el.setAttribute("playsinline", "");
    let gestureBound = false;
    const unbind = () => { window.removeEventListener("touchend", onGesture); window.removeEventListener("pointerdown", onGesture); gestureBound = false; };
    const onGesture = () => { unbind(); el.play().catch(() => {}); };
    const tryPlay = () => {
      el.play().catch(() => {
        setDenied(true);
        if (gestureBound) return;
        gestureBound = true;
        window.addEventListener("touchend", onGesture, { passive: true });
        window.addEventListener("pointerdown", onGesture, { passive: true });
      });
    };
    if (el.readyState >= 2) tryPlay(); else el.addEventListener("loadeddata", tryPlay, { once: true });
    return () => { el.removeEventListener("loadeddata", tryPlay); unbind(); };
  }, [src]);
  const showAnim = denied && !playing && !!anim;
  return (
    <>
      {poster && <img src={poster} alt="" className="absolute inset-0 w-full h-full object-cover" />}
      {showAnim && <img src={anim!} alt="" className="absolute inset-0 w-full h-full object-cover" />}
      {!broken && (
        <video
          ref={ref}
          src={src}
          autoPlay
          loop
          muted
          playsInline
          preload="auto"
          disablePictureInPicture
          onPlaying={() => { setPlaying(true); setDenied(false); }}
          onPause={() => setPlaying(false)}
          onError={() => setBroken(true)}
          className="absolute inset-0 w-full h-full object-cover transition-opacity duration-500"
          style={{ opacity: playing ? 1 : 0 }}
        />
      )}
    </>
  );
};
