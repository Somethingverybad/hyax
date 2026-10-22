import { useCallback, useEffect, useRef, useState } from "react";
import { LoadingSkeleton } from "@/components/LoadingSkeleton";
import { createPortal } from "react-dom";
import { Paperclip, Download, Play, Pause, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { useMediaUrl } from "@/hooks/use-media-url";
import { useNearView } from "@/hooks/use-near-view";
import { currentTrack, fmtTime, usePlayer } from "@/lib/player";
import { fmtNoteTime, inlineNote, noteCurrentTime, openNoteBig, seekNote, startNote, toggleNote, useNoteHost, useVideoNoteSlice } from "@/lib/videoNote";
import { t as tr } from "@/lib/i18n";

/**
 * Медиа сообщений, общие для переписки (ChatWindow) и ленты канала
 * (ChannelView): картинка, видеофайл, файл строкой, видео-«треугольник» и
 * живое превью с камеры. Вынесены из ChatWindow, когда в каналы добавили
 * вложения — чтобы пост и сообщение выглядели одинаково.
 */

/** Является ли вложение картинкой — по расширению имени или ссылки. */
export const isImageFile = (fileName: string | null | undefined, fileUrl: string | null | undefined): boolean => {
  if (!fileName && !fileUrl) return false;
  const imageExtensions = ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.svg', '.bmp'];
  const checkString = fileName || fileUrl || '';
  return imageExtensions.some(ext => checkString.toLowerCase().endsWith(ext));
};

export const isVideoFile = (fileName: string | null | undefined, fileUrl: string | null | undefined): boolean => {
  const s = (fileName || fileUrl || '').toLowerCase();
  return ['.mp4', '.mov', '.m4v', '.webm'].some(ext => s.endsWith(ext));
};

/** Музыка/аудио как вложение — играет в пузыре, а не качается. */
export const isAudioFile = (fileName: string | null | undefined, fileUrl: string | null | undefined): boolean => {
  const s = (fileName || fileUrl || '').toLowerCase().split('?')[0];
  return ['.mp3', '.wav', '.m4a', '.aac', '.ogg', '.oga', '.opus', '.flac', '.weba'].some(ext => s.endsWith(ext));
};

/** Аудиофайл в переписке и в ленте канала: играет в общем плеере с очередью
 *  (см. @/lib/player) — музыка не обрывается при переходе в другой чат.
 *  Строка показывает название, прогресс и состояние; скачать можно кнопкой
 *  справа. Файл, отправленный как «Файл» (download_only), тоже сюда — для
 *  музыки скачивание вместо воспроизведения сбивало с толку. */
export const MessageAudioFile = ({ raw, name, isOwn, onSave, onPlay }: {
  raw: string; name: string | null; isOwn: boolean;
  onSave: (url: string, name: string) => void;
  /** Запустить очередь этого чата с этого трека; без обработчика — просто строка. */
  onPlay?: () => void;
}) => {
  const [nearRef, near] = useNearView();
  const src = useMediaUrl(near ? raw : null);
  const s = usePlayer();
  const cur = currentTrack();
  const mine = !!cur && cur.raw === raw;
  const title = (name || tr("Аудио")).replace(/\.[^.]+$/, "");
  const frac = mine && s.duration ? Math.min(1, s.time / s.duration) : 0;

  // Длинное название прокручиваем, а не растягиваем пузырь: с названиями вроде
  // «Faint (Official Music Video) [4K UPGRADE]» карточка вылезала за край
  // экрана. Сдвиг считаем по факту — CSS не знает, поместился ли текст.
  const titleRef = useRef<HTMLSpanElement>(null);
  const [shift, setShift] = useState(0);
  useEffect(() => {
    const el = titleRef.current;
    if (!el) return;
    const extra = el.scrollWidth - el.clientWidth;
    setShift(extra > 4 ? extra : 0);
  }, [title]);

  return (
    <div ref={nearRef} className={cn(
      // Потолок ширины обязателен: обрезка текста сама по себе не мешает
      // карточке растянуться под всё название.
      // Цвет карточки — от цвета текста пузыря (.att-card), а не из темы.
      "att-card flex items-center gap-2.5 p-2 rounded-lg border min-w-[14rem] max-w-[min(72vw,22rem)]",
    )}>
      <button type="button" onClick={() => onPlay?.()} disabled={!onPlay} className="w-9 h-9 shrink-0 rounded-md flex items-center justify-center bg-black/20 disabled:opacity-50" aria-label={mine && s.playing ? tr("Пауза") : tr("Играть")}>
        {mine && s.playing ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4" />}
      </button>
      <div className="flex-1 min-w-0">
        <div className="text-sm overflow-hidden whitespace-nowrap">
          <span
            ref={titleRef}
            className={cn("inline-block max-w-full align-bottom truncate", shift > 0 && mine && "audio-title-run")}
            style={shift > 0 && mine ? ({ "--shift": `-${shift}px` } as React.CSSProperties) : undefined}
            title={title}
          >
            {title}
          </span>
        </div>
        <div className="mt-1 h-1.5 rounded-full bg-black/20 overflow-hidden">
          <div className="h-full rounded-full bg-current opacity-80" style={{ width: `${frac * 100}%` }} />
        </div>
        <div className="mt-0.5 text-[11px] opacity-85 tabular-nums">
          {mine ? `${fmtTime(s.time)}${s.duration ? ` / ${fmtTime(s.duration)}` : ""}` : tr("Нажми, чтобы слушать")}
        </div>
      </div>
      <button
        type="button"
        onClick={(e) => { e.preventDefault(); if (src) onSave(src, name || "audio"); }}
        className="p-1 rounded hover:bg-background/50 transition-colors shrink-0"
        title={tr("Сохранить файл")}
      >
        <Download className="w-4 h-4" />
      </button>
    </div>
  );
};

/** Вписывает натуральный размер в бокс превью (240×192), не увеличивая. */
export const previewSize = (dims: { w: number; h: number }, maxW = 240, maxH = 192) => {
  const scale = Math.min(maxW / dims.w, maxH / dims.h, 1);
  return { width: Math.round(dims.w * scale), height: Math.round(dims.h * scale) };
};

/** Одиночное фото или видео в пузыре — на всю его ширину: подпись, ответ или
 *  пересылка бывают шире картинки, и рядом с ней оставалось пустое место.
 *  Не уже превью (на узком экране — не шире 62vw), высота — по пропорциям,
 *  но не выше 420px (дальше кадр обрезается по краям, без пустых полос). */
const fillBox = (dims: { w: number; h: number } | null | undefined, maxW: number, maxH: number, fallback: { width: number; height: number }): React.CSSProperties => {
  if (!dims) return fallback;
  const p = previewSize(dims, maxW, maxH);
  return { width: "100%", minWidth: `min(${p.width}px, 62vw)`, aspectRatio: `${dims.w} / ${dims.h}`, maxHeight: 420 };
};

/** Размеры медиа с сервера (ffprobe при загрузке) → {w,h} или null. */
export const dimsOf = (w?: number | null, h?: number | null) => (w && h ? { w, h } : null);

/** Заглушка на время загрузки медиа: место уже зарезервировано по размерам,
 *  а внутри — скелетон «Мяты» (палочки «X» играют в пинг-понг). */
export const MediaSkeleton = ({ className }: { className?: string }) => (
  <LoadingSkeleton className={cn("block w-full h-full", className)} />
);

/** Треугольная маска — форма наших видео-сообщений вместо круглых «кружков». */
export const TRIANGLE = "polygon(50% 0%, 100% 100%, 0% 100%)";

/** Треугольник со скруглёнными углами (clip-path: path в пикселях — у
 *  видео-сообщений размер постоянный). d — насколько срезан каждый угол;
 *  flip — вершиной вниз. Команды пути одинаковые в обе стороны, поэтому
 *  переворот анимируется переходом clip-path. */
export function triClip(w: number, h: number, flip = false, d = Math.min(w, h) * 0.09) {
  const T = [w / 2, flip ? h : 0], R = [w, flip ? 0 : h], L = [0, flip ? 0 : h];
  const along = (a: number[], b: number[]) => {
    const dx = b[0] - a[0], dy = b[1] - a[1], len = Math.hypot(dx, dy);
    return [a[0] + (dx * d) / len, a[1] + (dy * d) / len];
  };
  const f = (p: number[]) => `${p[0].toFixed(2)} ${p[1].toFixed(2)}`;
  return `path('M ${f(along(T, R))} L ${f(along(R, T))} Q ${f(R)} ${f(along(R, L))} L ${f(along(L, R))} Q ${f(L)} ${f(along(L, T))} L ${f(along(T, L))} Q ${f(T)} ${f(along(T, R))} Z')`;
}

/** Та же фигура маской (SVG data-URL): Android WebView на части прошивок
 *  (Samsung One UI) кладёт <video> в отдельный слой композитора и clip-path
 *  обёртки для него игнорирует — кромка режется треугольником, а само видео
 *  остаётся чёрным квадратом. Маска идёт другим путём композитора и слой
 *  видео режет; вместе с clip-path вреда нет. */
export function triMask(w: number, h: number, flip = false) {
  const d = triClip(w, h, flip).replace(/^path\('/, "").replace(/'\)$/, "");
  return `url("data:image/svg+xml;utf8,${encodeURIComponent(`<svg xmlns='http://www.w3.org/2000/svg' width='${w}' height='${h}' viewBox='0 0 ${w} ${h}'><path d='${d}' fill='black'/></svg>`)}")`;
}

/** Стеклянно-мятная рамка видео-сообщения: кромка — градиент как у палочек
 *  «X», мягкая тень, блик стекла поверх видео. Внутренний треугольник
 *  отступает от кромки на rim по нормали к каждой стороне (вершина у
 *  треугольника острая, поэтому сверху отступ больше — иначе боковая кромка
 *  выходила вдвое тоньше нижней). */
export const GlassTriangle = ({ size, rim = 3, flip = false, className, innerClassName, onClick, children }: {
  size: number; rim?: number; flip?: boolean; className?: string; innerClassName?: string; onClick?: () => void; children?: React.ReactNode;
}) => {
  const apex = rim * Math.sqrt(5);             // rim / sin(угла при вершине / 2), tg = 1/2
  const h = size - rim - apex;
  // Переворот — как карточка вокруг горизонтальной оси: форма меняется в
  // середине, когда треугольник стоит ребром и подмены не видно.
  const [shown, setShown] = useState(flip);
  const [turning, setTurning] = useState(false);
  useEffect(() => {
    if (flip === shown) { setTurning(false); return; }
    setTurning(true);
    const half = window.setTimeout(() => setShown(flip), 180);
    const end = window.setTimeout(() => setTurning(false), 380);
    return () => { window.clearTimeout(half); window.clearTimeout(end); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [flip]);
  return (
    <div className={cn("relative shrink-0", turning && "tri-turn", className)} data-flip={shown ? "1" : undefined}
      style={{ width: size, height: size, transition: "width .3s cubic-bezier(.2,.8,.2,1), height .3s cubic-bezier(.2,.8,.2,1)" }} onClick={onClick}>
      {/* Тень — отдельный размытый треугольник позади, а не filter: drop-shadow
          на всей рамке: тот перерисовывался с каждым кадром видео и скелетона,
          и в WebKit лента при прокрутке дёргалась. */}
      <div className="absolute inset-0 tri-shadow-layer" aria-hidden>
        <div className="absolute inset-0 bg-black/25" style={{ clipPath: triClip(size, size, shown) }} />
      </div>
      <div className="absolute inset-0 tri-rim" style={{ clipPath: triClip(size, size, shown) }} />
      <div className={cn("absolute overflow-hidden", innerClassName ?? "bg-black")}
        style={{
          top: shown ? rim : apex, left: (size - h) / 2, width: h, height: h, clipPath: triClip(h, h, shown),
          WebkitMaskImage: triMask(h, h, shown), maskImage: triMask(h, h, shown),
          WebkitMaskSize: "100% 100%", maskSize: "100% 100%", WebkitMaskRepeat: "no-repeat", maskRepeat: "no-repeat",
          isolation: "isolate", willChange: "transform",
          // Увеличение треугольника на месте (VideoNote big): геометрия едет плавно.
          transition: "top .3s cubic-bezier(.2,.8,.2,1), left .3s cubic-bezier(.2,.8,.2,1), width .3s cubic-bezier(.2,.8,.2,1), height .3s cubic-bezier(.2,.8,.2,1)",
        }}>
        {children}
        <div className="tri-sheen absolute inset-0 pointer-events-none" />
      </div>
    </div>
  );
};

/** Живое изображение с камеры во время записи. */
export const LivePreview = ({ stream, dimmed, facing, flip, onToggleFlip }: { stream: MediaStream | null; dimmed: boolean; facing: "user" | "environment"; flip?: boolean; onToggleFlip?: () => void }) => {
  const ref = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    if (ref.current && stream) {
      ref.current.srcObject = stream;
      ref.current.play().catch(() => {});
    }
  }, [stream]);
  return (
    <GlassTriangle size={160} flip={flip} onClick={onToggleFlip}>
      <video
        ref={ref}
        muted
        playsInline
        className={cn("absolute inset-0 w-full h-full object-cover transition-opacity", dimmed && "opacity-40")}
        style={{ transform: facing === "user" ? "scaleX(-1)" : undefined }}
      />
    </GlassTriangle>
  );
};

/** Видео-сообщение в переписке: тап — воспроизведение со звуком. */
// Картинка сообщения: своя показывается из локального blob мгновенно, чужая —
// по временной подписанной ссылке (S3) или локально (/media).
export const MessageImage = ({ raw, name, dims, localMap, onOpen, onError }: {
  raw: string; name: string | null; dims?: { w: number; h: number } | null;
  localMap: Map<string, string>; onOpen: (url: string, name: string) => void; onError: () => void;
}) => {
  const localBlob = raw.startsWith("blob:") ? raw : localMap.get(raw);
  // Подпись и загрузка — когда картинка рядом с видимой частью ленты (use-near-view).
  const [nearRef, near] = useNearView();
  const signed = useMediaUrl(localBlob || !near ? null : raw);
  const src = localBlob || signed;
  // Своё из blob декодируется мгновенно — без скелетона; чужое ждёт onLoad.
  const [loaded, setLoaded] = useState(!!localBlob);
  return (
    <div ref={nearRef} className="msg-media relative rounded-lg overflow-hidden max-w-full" style={fillBox(dims, 240, 192, { width: 160, height: 112 })}>
      {!loaded && <MediaSkeleton className="absolute inset-0" />}
      {src && (
        <img
          src={src}
          alt={name || tr("Изображение")}
          loading="lazy"
          // absolute: натуральный размер картинки не должен раздувать пузырь (ширина — от бокса).
          className={cn("absolute inset-0 w-full h-full object-cover cursor-pointer block transition-opacity duration-200", loaded ? "opacity-100" : "opacity-0")}
          onLoad={() => setLoaded(true)}
          onClick={() => onOpen(src, name || "image")}
          onError={onError}
        />
      )}
    </div>
  );
};

/** Плеер на весь экран — как в Telegram: тап по превью, а не встроенный
 *  плеер в пузыре. Порталом на body: пузырь может быть внутри transform. */
const VideoViewer = ({ src, poster, onClose }: { src: string; poster?: string | null; onClose: () => void }) => {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") { e.preventDefault(); onClose(); } };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  // Свайп вниз закрывает, как у картинок (ImageViewer): видео едет за пальцем,
  // фон светлеет; не дотянули — возвращается. Нижняя полоса — системные
  // кнопки плеера (перемотка, звук), там жест не начинаем.
  const [drag, setDrag] = useState(0);
  const pan = useRef<{ id: number; y: number; at: number; on: boolean } | null>(null);
  const onDown = (e: React.PointerEvent) => {
    if (e.pointerType === "mouse") return;
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    if (e.clientY > r.bottom - 72) return;
    pan.current = { id: e.pointerId, y: e.clientY, at: performance.now(), on: false };
  };
  const onMove = (e: React.PointerEvent) => {
    const p = pan.current;
    if (!p || p.id !== e.pointerId) return;
    const dy = e.clientY - p.y;
    if (!p.on && dy > 12) p.on = true;
    if (p.on) setDrag(Math.max(0, dy));
  };
  const onUp = (e: React.PointerEvent) => {
    const p = pan.current;
    if (!p || p.id !== e.pointerId) return;
    pan.current = null;
    const dy = e.clientY - p.y;
    const speed = dy / Math.max(1, performance.now() - p.at);
    if (p.on && (dy > 110 || (dy > 40 && speed > 0.6))) { onClose(); return; }
    setDrag(0);
  };
  return createPortal(
    <div
      className="fixed inset-0 z-[85] flex items-center justify-center"
      style={{ backgroundColor: `rgba(0,0,0,${1 - Math.min(drag / 450, 0.7)})`, transition: pan.current?.on ? "none" : "background-color 180ms ease-out" }}
      onClick={onClose}
      onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp}
    >
      <video
        src={src}
        poster={poster || undefined}
        controls
        autoPlay
        playsInline
        className="w-full max-h-[100dvh] object-contain"
        style={{ transform: `translateY(${drag}px) scale(${1 - Math.min(drag / 1600, 0.15)})`, transition: pan.current?.on ? "none" : "transform 180ms cubic-bezier(0.2, 0.8, 0.2, 1)" }}
        onClick={(e) => e.stopPropagation()}
      />
      <button
        type="button"
        onClick={onClose}
        className="absolute left-3 w-10 h-10 rounded-full bg-black/55 text-white flex items-center justify-center active:opacity-70"
        style={{ top: "calc(var(--sat) + 0.5rem)", opacity: drag ? Math.max(0, 1 - drag / 120) : 1 }}
        aria-label={tr("Закрыть")}
      >
        <X className="w-6 h-6" />
      </button>
    </div>,
    document.body,
  );
};

/** Превью выбранного видео в панели ввода (до отправки): Android WebView не
 *  декодирует кадр, пока видео не запустят, — без подталкивания перемоткой
 *  оставалась пустая серая коробка (баг-репорт 1abb3da6). Тот же приём, что у
 *  VideoThumb в ленте, плюс значок «play». */
export const AttachVideoPreview = ({ src }: { src: string }) => {
  const ref = useRef<HTMLVideoElement>(null);
  return (
    <>
      <video
        ref={ref}
        src={src}
        muted
        playsInline
        preload="metadata"
        onLoadedMetadata={() => { const el = ref.current; if (el && el.currentTime === 0) { try { el.currentTime = 0.05; } catch { /* кадр покажется при просмотре */ } } }}
        className="w-full h-full object-cover bg-black"
      />
      <span className="absolute inset-0 flex items-center justify-center pointer-events-none" aria-hidden>
        <span className="w-7 h-7 rounded-full bg-black/55 text-white flex items-center justify-center"><Play className="w-3.5 h-3.5 ml-0.5" fill="currentColor" /></span>
      </span>
    </>
  );
};

/** Превью видео в ленте: постер с сервера, а без него (старые видео) — первый
 *  кадр, к которому WebKit нужно подтолкнуть перемоткой: сам он до тапа ничего
 *  не декодирует, и раньше здесь до тапа висела заглушка. Тап — VideoViewer. */
const VideoThumb = ({ src, poster, cover }: { src: string | null; poster?: string | null; cover?: boolean }) => {
  const [ready, setReady] = useState(false);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLVideoElement>(null);
  const fit = cover ? "object-cover" : "object-contain";
  return (
    <>
      {!ready && <MediaSkeleton className="absolute inset-0" />}
      {poster ? (
        <img src={poster} alt="" onLoad={() => setReady(true)}
          className={cn("absolute inset-0 w-full h-full block transition-opacity duration-200", fit, ready ? "opacity-100" : "opacity-0")} />
      ) : src && (
        <video
          ref={ref}
          src={src}
          muted
          playsInline
          preload="metadata"
          onLoadedMetadata={() => { const el = ref.current; if (el && el.currentTime === 0) { try { el.currentTime = 0.05; } catch { /* покажем при просмотре */ } } }}
          onLoadedData={() => setReady(true)}
          onSeeked={() => setReady(true)}
          className={cn("absolute inset-0 w-full h-full block bg-black transition-opacity duration-200", fit, ready ? "opacity-100" : "opacity-0")}
        />
      )}
      <button
        type="button"
        aria-label={tr("Смотреть")}
        disabled={!src}
        onClick={(e) => { e.stopPropagation(); setOpen(true); }}
        className="absolute inset-0 flex items-center justify-center"
      >
        <span className="w-12 h-12 rounded-full bg-black/55 text-white flex items-center justify-center">
          <Play className="w-6 h-6 ml-0.5" fill="currentColor" />
        </span>
      </button>
      {open && src && <VideoViewer src={src} poster={poster} onClose={() => setOpen(false)} />}
    </>
  );
};

export const MessageVideoFile = ({ raw, dims, poster }: { raw: string; dims?: { w: number; h: number } | null; poster?: string | null }) => {
  const [nearRef, near] = useNearView();
  const src = useMediaUrl(near ? raw : null);
  const posterSrc = useMediaUrl(near ? poster || null : null);
  // Бокс под видео по размерам с сервера, чтобы лента не прыгала, когда плеер
  // узнает размер кадра; по ширине — весь пузырь. Без размеров — как раньше.
  return (
    <div ref={nearRef} className="msg-media relative rounded-lg overflow-hidden bg-black max-w-full" style={fillBox(dims, 280, 256, { width: 176, height: 112 })}>
      <VideoThumb src={src} poster={posterSrc} cover={!!dims} />
    </div>
  );
};

/** Файл в переписке: вся карточка — «сохранить на устройство» (lib/saveFile).
 *  Раньше название было ссылкой на хранилище — тап открывал файл в браузере. */
export const MessageFile = ({ raw, name, onSave }: {
  raw: string; name: string | null; isOwn?: boolean; onSave: (url: string, name: string) => void;
}) => {
  const [nearRef, near] = useNearView<HTMLButtonElement>();
  const src = useMediaUrl(near ? raw : null);
  return (
    <button
      ref={nearRef}
      type="button"
      onClick={() => { if (src) onSave(src, name || "file"); }}
      title={tr("Сохранить файл")}
      className="att-card flex items-center gap-2 p-2 rounded-lg border transition-opacity active:opacity-70 max-w-full min-w-0 text-left"
    >
      <Paperclip className="w-4 h-4 flex-shrink-0" />
      <span className="flex-1 min-w-0 text-sm break-all line-clamp-2">{name || tr("Файл")}</span>
      <Download className="w-4 h-4 shrink-0" />
    </button>
  );
};

/** Размер увеличенного треугольника: почти во всю ширину телефона, на компьютере — до 420. */
const bigSize = () => Math.round(Math.min(typeof window !== "undefined" ? window.innerWidth - 32 : 420, 420));
const NOTE_SIZE = 176;

export const VideoNote = ({ id, url, seconds, mirror, flip, poster, chatId, sender, at }: {
  id?: string; url: string; seconds: number; own?: boolean; mirror?: boolean; flip?: boolean; poster?: string | null;
  chatId?: string; sender?: { id: string; username: string; avatar_url?: string | null } | null; at?: string;
}) => {
  const noteId = id || url;
  const [nearRef, near] = useNearView<HTMLVideoElement>();
  const src = useMediaUrl(near ? url : null);
  const ref = useRef<HTMLVideoElement | null>(null);
  const setVideo = useCallback((el: HTMLVideoElement | null) => { ref.current = el; nearRef(el); }, [nearRef]);
  // С постером кадр есть сразу — скелетон не нужен.
  const [ready, setReady] = useState(!!poster);
  // Играет ли это сообщение в общем проигрывателе (lib/videoNote) и где оно
  // сейчас: здесь (обычное или увеличенное на месте) или виджетом.
  const mode = useVideoNoteSlice((st) => (st.note?.id === noteId ? st.mode : null));
  const active = mode !== null;
  const big = mode === "big";
  const playing = useVideoNoteSlice((st) => st.note?.id === noteId && st.playing);
  const time = useVideoNoteSlice((st) => (st.note?.id === noteId ? st.time : -1));
  const duration = useVideoNoteSlice((st) => (st.note?.id === noteId ? st.duration : 0)) || seconds || 0;
  // Размер: увеличенный — как в Telegram, почти во всю ширину; внутренний
  // треугольник — как в GlassTriangle(rim=3).
  const [wide, setWide] = useState(bigSize);
  useEffect(() => {
    if (!big) return;
    const on = () => setWide(bigSize());
    window.addEventListener("resize", on);
    return () => window.removeEventListener("resize", on);
  }, [big]);
  const size = big ? wide : NOTE_SIZE;
  // Увеличились — просим ленту показать треугольник целиком (ChatWindow ведёт
  // его в центр, следя за ростом; иначе вершина пряталась под шапкой и плашкой).
  useEffect(() => {
    if (!big || !boxRef.current) return;
    window.dispatchEvent(new CustomEvent("hyax:reveal", { detail: boxRef.current }));
  }, [big]);
  const innerH = size - 3 - 3 * Math.sqrt(5);
  const clip = triClip(innerH, innerH, !!flip);
  const hostRef = useNoteHost(mode === "inline" || mode === "big", { fit: "cover", clip });
  // Треугольник на экране? Уехал за край ленты — ролик продолжает виджетом,
  // вернулся — снова здесь. Следим только пока играет это сообщение.
  const boxRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!active) return;
    const el = boxRef.current;
    if (!el || typeof IntersectionObserver === "undefined") { inlineNote(noteId, true); return () => inlineNote(noteId, false); }
    const io = new IntersectionObserver((list) => {
      const last = list[list.length - 1];
      if (last) inlineNote(noteId, last.isIntersecting);
    }, { threshold: 0.05 });
    io.observe(el);
    return () => { io.disconnect(); inlineNote(noteId, false); };
  }, [active, noteId]);
  useEffect(() => {
    if (ready) return;
    const t = window.setTimeout(() => setReady(true), 2500);
    return () => window.clearTimeout(t);
  }, [ready]);

  // Первый кадр вместо чёрного треугольника: WebKit рисует видео только
  // после перемотки, поэтому подталкиваем его на первый же кадр.
  const showFirstFrame = () => {
    const el = ref.current;
    if (!el || el.currentTime > 0) return;
    try { el.currentTime = 0.05; } catch { /* браузер ещё не готов */ }
  };

  // Кольцо прогресса по контуру треугольника (как кольцо у кружка в Telegram):
  // дорожка, пройденная часть и ручка. За ручку (или по контуру) можно тянуть —
  // перемотка; тап по середине — пауза/играть.
  const ringRef = useRef<SVGPathElement | null>(null);
  const handleRef = useRef<SVGCircleElement | null>(null);
  const samplesRef = useRef<{ x: number; y: number }[]>([]);
  const [drag, setDrag] = useState<number | null>(null);
  const dragRef = useRef<number | null>(null);
  const outline = triClip(size, size, !!flip).replace(/^path\('/, "").replace(/'\)$/, "");
  useEffect(() => {
    const path = ringRef.current;
    if (!path || !big) { samplesRef.current = []; return; }
    const total = path.getTotalLength();
    const n = 240;
    samplesRef.current = Array.from({ length: n }, (_, i) => { const q = path.getPointAtLength((i / n) * total); return { x: q.x, y: q.y }; });
  }, [big, size, flip]);
  // Кольцо и ручка рисуются каждый кадр прямо из <video> (requestAnimationFrame),
  // а не по timeupdate четыре раза в секунду — иначе ручка шла скачками.
  useEffect(() => {
    if (!big) return;
    let raf = 0;
    const paint = () => {
      const path = ringRef.current, dot = handleRef.current;
      if (path && dot) {
        const d = duration > 0 ? duration : seconds || 1;
        const f = dragRef.current ?? Math.min(1, Math.max(0, noteCurrentTime() / d));
        path.setAttribute("stroke-dasharray", `${Math.max(0.001, f)} 1`);
        const q = path.getPointAtLength(f * path.getTotalLength());
        dot.setAttribute("cx", String(q.x));
        dot.setAttribute("cy", String(q.y));
      }
      raf = requestAnimationFrame(paint);
    };
    raf = requestAnimationFrame(paint);
    return () => cancelAnimationFrame(raf);
  }, [big, size, duration, seconds]);
  const fracAt = (clientX: number, clientY: number) => {
    const r = boxRef.current?.getBoundingClientRect();
    const pts = samplesRef.current;
    if (!r || !pts.length) return null;
    const x = clientX - r.left, y = clientY - r.top;
    let best = -1, bd = Infinity;
    pts.forEach((q, i) => { const d = (q.x - x) ** 2 + (q.y - y) ** 2; if (d < bd) { bd = d; best = i; } });
    return Math.sqrt(bd) <= 36 ? { f: best / pts.length } : null;
  };
  const setDragBoth = (v: number | null) => { dragRef.current = v; setDrag(v); };
  const onDown = (e: React.PointerEvent) => {
    if (!big) return;
    const hit = fracAt(e.clientX, e.clientY);
    if (!hit) return;
    e.stopPropagation();
    try { (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId); } catch { /* не везде */ }
    setDragBoth(hit.f);
  };
  const onMove = (e: React.PointerEvent) => {
    if (dragRef.current === null) return;
    e.stopPropagation();
    const hit = fracAt(e.clientX, e.clientY);
    if (hit) setDragBoth(hit.f);
  };
  const onUp = (e: React.PointerEvent) => {
    if (dragRef.current === null) return;
    e.stopPropagation();
    const f = dragRef.current;
    setDragBoth(null);
    seekNote(f * duration);
    // Клик, идущий хвостом за ведением (мышь), не считаем тапом; у касания клика
    // не бывает — снимаем флаг по таймеру, иначе он глотал следующий тап.
    suppressTap.current = true;
    window.setTimeout(() => { suppressTap.current = false; }, 400);
  };
  const suppressTap = useRef(false);

  // Тап: не играет — запустить (сразу увеличенным); играет маленьким — увеличить;
  // увеличенный — пауза/играть (крестик в плашке сверху — остановить).
  const tap = () => {
    if (suppressTap.current) return;
    if (!active) { if (src) startNote({ id: noteId, src, poster, mirror, flip, seconds, chatId, sender, at }); return; }
    if (mode === "inline") { openNoteBig(); return; }
    toggleNote();
  };

  const label = active && time >= 0
    ? fmtNoteTime(time)
    : `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;

  return (
    <div ref={boxRef} className="relative shrink-0" style={{ width: size, height: size, transition: "width .3s cubic-bezier(.2,.8,.2,1), height .3s cubic-bezier(.2,.8,.2,1)", touchAction: big ? "none" : undefined }}
      onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={() => setDragBoth(null)}>
    <GlassTriangle size={size} flip={flip} onClick={tap} innerClassName={ready ? "bg-black" : "bg-transparent"}>
      {!ready && <LoadingSkeleton className="absolute inset-0" />}
      {/* Превью (первый кадр, без звука); пока играет — его место занимает общий <video>. */}
      <video
        ref={setVideo}
        src={src || undefined}
        poster={poster || undefined}
        playsInline
        muted
        preload="metadata"
        onLoadedMetadata={() => { showFirstFrame(); setReady(true); }}
        onLoadedData={() => { showFirstFrame(); setReady(true); }}
        onSeeked={() => setReady(true)}
        onError={() => setReady(true)}
        className={cn("absolute inset-0 w-full h-full object-cover transition-opacity duration-300", ready && !active ? "opacity-100" : "opacity-0")}
        style={{ transform: mirror ? "scaleX(-1)" : undefined, clipPath: clip }}
      />
      <div ref={hostRef} className={cn("absolute inset-0", mode === "float" && "hidden")} />
      {mode === "float" && (
        <span className="absolute inset-0 flex items-center justify-center bg-black/50 text-white/90 text-[11px] font-medium">
          {tr("Играет в виджете")}
        </span>
      )}
      {!playing && ready && mode !== "float" && (
        <span className="tri-play-pos">
          <span className="tri-glass w-11 h-11 rounded-full flex items-center justify-center">
            <Play className="w-5 h-5 ml-0.5" fill="currentColor" />
          </span>
        </span>
      )}
      <span className="tri-pill tri-pill-pos absolute left-1/2 -translate-x-1/2 rounded-full px-2 text-[11px] leading-[16px] tabular-nums pointer-events-none">
        {label}
      </span>
    </GlassTriangle>
    {/* Кольцо прогресса по контуру — только у увеличенного. */}
    {big && (
      <svg className="absolute inset-0 pointer-events-none overflow-visible" width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden>
        <path d={outline} fill="none" stroke="rgba(255,255,255,.35)" strokeWidth={3} />
        <path ref={ringRef} d={outline} fill="none" stroke="#fff" strokeWidth={3} strokeLinecap="round" pathLength={1} strokeDasharray="0.001 1" />
        <circle ref={handleRef} r={drag !== null ? 9 : 7} fill="#fff" style={{ filter: "drop-shadow(0 1px 3px rgba(0,0,0,.4))", transition: "r .15s" }} />
      </svg>
    )}
    </div>
  );
};



/** Элемент альбома — фото или видео из сообщения с общим album_id. */
export interface AlbumItem {
  id: string;
  raw: string;
  name: string | null;
  dims?: { w: number; h: number } | null;
  /** Кадр-превью видео с сервера. */
  poster?: string | null;
  pending?: boolean;
  progress?: number | null;
  failed?: boolean;
}

const AlbumCell = ({ item, localMap, onOpen }: { item: AlbumItem; localMap?: Map<string, string>; onOpen: (url: string, name: string, id: string) => void }) => {
  const localBlob = item.raw.startsWith("blob:") ? item.raw : localMap?.get(item.raw);
  const [nearRef, near] = useNearView();
  const signed = useMediaUrl(localBlob || !near ? null : item.raw);
  const src = localBlob || signed;
  const posterSrc = useMediaUrl(near ? item.poster || null : null);
  const [loaded, setLoaded] = useState(!!localBlob);
  const video = isVideoFile(item.name, item.raw);
  return (
    <div ref={nearRef} className="relative aspect-square overflow-hidden bg-black/20">
      {!loaded && !video && <MediaSkeleton className="absolute inset-0" />}
      {src && (video ? (
        <VideoThumb src={src} poster={posterSrc} cover />
      ) : (
        <img src={src} alt={item.name || ""} loading="lazy" onLoad={() => setLoaded(true)} onClick={() => onOpen(src, item.name || "image", item.id)}
          className={cn("w-full h-full object-cover cursor-pointer transition-opacity duration-200", loaded ? "opacity-100" : "opacity-0")} />
      ))}
      {item.pending && item.progress != null && (
        <div className="absolute inset-0 bg-black/45 flex items-center justify-center text-white text-sm font-semibold tabular-nums">
          {item.failed ? "✕" : item.progress === -1 ? tr("ждёт") : item.progress === -2 ? tr("сжатие") : item.progress < 100 ? `${item.progress}%` : "…"}
        </div>
      )}
    </div>
  );
};

/** Альбом: несколько фото/видео одной отправки — сетка 2 колонки (3 от пяти
 *  штук), как в Telegram. Ячейки квадратные, чтобы лента не прыгала. */
export const AlbumGrid = ({ items, localMap, onOpen, className }: {
  items: AlbumItem[]; localMap?: Map<string, string>; onOpen: (url: string, name: string, id: string) => void; className?: string;
}) => (
  // Ширина — своя, не процент от пузыря: пузырь подстраивается под
  // содержимое, и пока фото не загружены, сетка схлопывалась в ноль — а
  // нулевую ячейку useNearView считает невидимой и не грузит (замкнутый
  // круг: после возврата в чат альбом оставался пустым, баг-репорт 567b8940).
  // Но не шире внутренности пузыря: тот занимает 72% ленты минус свои отступы
  // (≈72vw − 42px), иначе сетка торчала из пузыря ступенькой (баг-репорт 7b7111f4).
  <div className={cn("msg-media grid gap-0.5 rounded-lg overflow-hidden w-[min(320px,calc(72vw-42px))] max-w-full", items.length >= 5 ? "grid-cols-3" : "grid-cols-2", className)}>
    {items.map((it) => <AlbumCell key={it.id} item={it} localMap={localMap} onOpen={onOpen} />)}
  </div>
);
