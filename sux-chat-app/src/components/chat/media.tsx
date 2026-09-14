import { useEffect, useRef, useState } from "react";
import { Paperclip, Download, Play, Pause } from "lucide-react";
import { cn } from "@/lib/utils";
import { useMediaUrl } from "@/hooks/use-media-url";

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

const fmtClock = (sec: number) => {
  const s = Math.max(0, Math.floor(sec || 0));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
};

/** Аудиофайл в переписке и в ленте канала: плеер с перемоткой вместо строки
 *  со скачиванием. Файл, отправленный как «Файл» (download_only), тоже сюда —
 *  для музыки скачивание вместо воспроизведения сбивало с толку. Скачать
 *  по-прежнему можно кнопкой справа. */
export const MessageAudioFile = ({ raw, name, isOwn, onSave }: {
  raw: string; name: string | null; isOwn: boolean; onSave: (url: string, name: string) => void;
}) => {
  const src = useMediaUrl(raw);
  const ref = useRef<HTMLAudioElement | null>(null);
  const [playing, setPlaying] = useState(false);
  const [cur, setCur] = useState(0);
  const [dur, setDur] = useState(0);
  const title = (name || "Аудио").replace(/\.[^.]+$/, "");

  useEffect(() => () => { ref.current?.pause(); ref.current = null; }, [src]);

  const ensure = () => {
    if (ref.current || !src) return ref.current;
    const a = new Audio(src);
    a.preload = "metadata";
    a.onloadedmetadata = () => setDur(a.duration || 0);
    a.ontimeupdate = () => setCur(a.currentTime);
    a.onended = () => { setPlaying(false); setCur(0); };
    a.onpause = () => setPlaying(false);
    a.onplay = () => setPlaying(true);
    ref.current = a;
    return a;
  };
  const toggle = () => {
    const a = ensure();
    if (!a) return;
    if (playing) a.pause(); else a.play().catch(() => setPlaying(false));
  };
  const seek = (e: React.MouseEvent<HTMLDivElement>) => {
    const a = ensure();
    if (!a || !dur) return;
    const r = e.currentTarget.getBoundingClientRect();
    a.currentTime = Math.min(dur, Math.max(0, (e.clientX - r.left) / r.width)) * dur;
    setCur(a.currentTime);
  };
  const frac = dur ? Math.min(1, cur / dur) : 0;

  return (
    <div className={cn(
      "flex items-center gap-2.5 p-2 rounded-lg border min-w-[14rem] max-w-full",
      isOwn ? "bg-primary/20 border-primary/30" : "bg-muted border-border",
    )}>
      <button type="button" onClick={toggle} disabled={!src} className="w-9 h-9 shrink-0 rounded-md flex items-center justify-center bg-black/20 disabled:opacity-50" aria-label={playing ? "Пауза" : "Играть"}>
        {playing ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4" />}
      </button>
      <div className="flex-1 min-w-0">
        <div className="text-sm truncate">{title}</div>
        <div className="mt-1 h-1.5 rounded-full bg-black/20 cursor-pointer" onClick={seek}>
          <div className="h-full rounded-full bg-current opacity-80" style={{ width: `${frac * 100}%` }} />
        </div>
        <div className="mt-0.5 text-[11px] opacity-70 tabular-nums">{fmtClock(cur)}{dur ? ` / ${fmtClock(dur)}` : ""}</div>
      </div>
      <button
        type="button"
        onClick={(e) => { e.preventDefault(); if (src) onSave(src, name || "audio"); }}
        className="p-1 rounded hover:bg-background/50 transition-colors shrink-0"
        title="Сохранить файл"
      >
        <Download className="w-4 h-4" />
      </button>
    </div>
  );
};

/** Вписывает натуральный размер в бокс превью (240×192), не увеличивая. */
export const previewSize = (dims: { w: number; h: number }) => {
  const scale = Math.min(240 / dims.w, 192 / dims.h, 1);
  return { width: Math.round(dims.w * scale), height: Math.round(dims.h * scale) };
};

/** Треугольная маска — форма наших видео-сообщений вместо круглых «кружков». */
export const TRIANGLE = "polygon(50% 0%, 100% 100%, 0% 100%)";

/** Живое изображение с камеры во время записи. */
export const LivePreview = ({ stream, dimmed, facing }: { stream: MediaStream | null; dimmed: boolean; facing: "user" | "environment" }) => {
  const ref = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    if (ref.current && stream) {
      ref.current.srcObject = stream;
      ref.current.play().catch(() => {});
    }
  }, [stream]);
  return (
    <video
      ref={ref}
      muted
      playsInline
      className={cn("w-40 h-40 object-cover transition-opacity", dimmed && "opacity-40")}
      style={{ clipPath: TRIANGLE, transform: facing === "user" ? "scaleX(-1)" : undefined }}
    />
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
  const signed = useMediaUrl(localBlob ? null : raw);
  const src = localBlob || signed;
  if (!src) return <div className="w-40 h-28 bg-black/20 rounded-lg animate-pulse" />;
  return (
    <img
      src={src}
      alt={name || "Изображение"}
      loading="lazy"
      className="max-h-48 max-w-[min(240px,100%)] w-auto object-contain cursor-pointer block"
      style={dims ? previewSize(dims) : undefined}
      onClick={() => onOpen(src, name || "image")}
      onError={onError}
    />
  );
};

export const MessageVideoFile = ({ raw }: { raw: string }) => {
  const src = useMediaUrl(raw);
  if (!src) return <div className="w-44 h-28 bg-black/20 rounded-lg animate-pulse" />;
  return (
    <video
      src={src}
      controls
      playsInline
      preload="metadata"
      className="max-h-64 max-w-[min(280px,100%)] w-auto rounded-lg block bg-black"
    />
  );
};

export const MessageFile = ({ raw, name, isOwn, onSave }: {
  raw: string; name: string | null; isOwn: boolean; onSave: (url: string, name: string) => void;
}) => {
  const src = useMediaUrl(raw);
  return (
    <div className={cn(
      "flex items-center gap-2 p-2 rounded-lg border transition-colors max-w-full min-w-0",
      isOwn ? "bg-primary/20 border-primary/30 hover:bg-primary/30" : "bg-muted border-border hover:bg-muted/80",
    )}>
      <Paperclip className="w-4 h-4 flex-shrink-0" />
      <a
        href={src || "#"}
        target="_blank"
        rel="noopener noreferrer"
        className="flex-1 min-w-0 text-sm truncate hover:underline"
      >
        {name || "Файл"}
      </a>
      <button
        onClick={(e) => { e.preventDefault(); if (src) onSave(src, name || "file"); }}
        className="p-1 rounded hover:bg-background/50 transition-colors"
        title="Сохранить файл"
      >
        <Download className="w-4 h-4" />
      </button>
    </div>
  );
};

export const VideoNote = ({ url, seconds, own, mirror }: { url: string; seconds: number; own: boolean; mirror?: boolean }) => {
  const src = useMediaUrl(url);
  const ref = useRef<HTMLVideoElement>(null);
  const [playing, setPlaying] = useState(false);

  // Первый кадр вместо чёрного треугольника: WebKit рисует видео только
  // после перемотки, поэтому подталкиваем его на первый же кадр.
  const showFirstFrame = () => {
    const el = ref.current;
    if (!el || el.currentTime > 0) return;
    try {
      el.currentTime = 0.05;
    } catch {
      /* браузер ещё не готов — покажем кадр при воспроизведении */
    }
  };

  const toggle = () => {
    const el = ref.current;
    if (!el) return;
    if (playing) {
      el.pause();
      return;
    }
    // Звук включаем только на время просмотра: до тапа элемент немой,
    // иначе первый кадр не покажется без разрешения на автовоспроизведение.
    el.muted = false;
    el.currentTime = 0;
    el.play().catch(() => {});
  };

  const label = `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;

  return (
    <div className="relative w-44 h-44" onClick={toggle}>
      {/* Цветная подложка-треугольник даёт обводку по краю: свои — алая,
          входящие — зелёная. Видео вписано внутрь с отступом, и кромка
          подложки читается как контур треугольника. */}
      <div
        className={cn("absolute inset-0", own ? "bg-primary" : "bg-success")}
        style={{ clipPath: TRIANGLE }}
      />
      <video
        ref={ref}
        src={src}
        playsInline
        muted={!playing}
        preload="metadata"
        onLoadedMetadata={showFirstFrame}
        onLoadedData={showFirstFrame}
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onEnded={() => setPlaying(false)}
        className="absolute inset-[3px] object-cover bg-black"
        style={{
          clipPath: TRIANGLE,
          width: "calc(100% - 6px)",
          height: "calc(100% - 6px)",
          // Фронтальная запись зеркалится в превью (селфи-вид); отражаем и
          // воспроизведение, чтобы в чате оно совпадало со съёмкой. Файл не трогаем.
          transform: mirror ? "scaleX(-1)" : undefined,
        }}
      />
      {!playing && (
        <span className="absolute inset-0 flex items-end justify-center pb-6 pointer-events-none">
          <span className="w-11 h-11 flex items-center justify-center bg-black/50">
            <Play className="w-5 h-5 text-white" />
          </span>
        </span>
      )}
      <span className="absolute bottom-1 right-1 text-[11px] px-1 bg-black/60 text-white pointer-events-none">
        {label}
      </span>
    </div>
  );
};

