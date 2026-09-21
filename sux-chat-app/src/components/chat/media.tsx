import { useEffect, useRef, useState } from "react";
import { Paperclip, Download, Play, Pause } from "lucide-react";
import { cn } from "@/lib/utils";
import { useMediaUrl } from "@/hooks/use-media-url";
import { currentTrack, fmtTime, usePlayer } from "@/lib/player";

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
  const src = useMediaUrl(raw);
  const s = usePlayer();
  const cur = currentTrack();
  const mine = !!cur && cur.raw === raw;
  const title = (name || "Аудио").replace(/\.[^.]+$/, "");
  const frac = mine && s.duration ? Math.min(1, s.time / s.duration) : 0;

  return (
    <div className={cn(
      "flex items-center gap-2.5 p-2 rounded-lg border min-w-[14rem] max-w-full",
      isOwn ? "bg-primary/20 border-primary/30" : "bg-muted border-border",
    )}>
      <button type="button" onClick={() => onPlay?.()} disabled={!onPlay} className="w-9 h-9 shrink-0 rounded-md flex items-center justify-center bg-black/20 disabled:opacity-50" aria-label={mine && s.playing ? "Пауза" : "Играть"}>
        {mine && s.playing ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4" />}
      </button>
      <div className="flex-1 min-w-0">
        <div className="text-sm truncate">{title}</div>
        <div className="mt-1 h-1.5 rounded-full bg-black/20 overflow-hidden">
          <div className="h-full rounded-full bg-current opacity-80" style={{ width: `${frac * 100}%` }} />
        </div>
        <div className="mt-0.5 text-[11px] opacity-70 tabular-nums">
          {mine ? `${fmtTime(s.time)}${s.duration ? ` / ${fmtTime(s.duration)}` : ""}` : "Нажми, чтобы слушать"}
        </div>
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

/** Размеры медиа с сервера (ffprobe при загрузке) → {w,h} или null. */
export const dimsOf = (w?: number | null, h?: number | null) => (w && h ? { w, h } : null);

/** Заглушка на время загрузки медиа: место уже зарезервировано по размерам,
 *  а внутри — медленно плывущие фигуры в духе супрематизма (квадрат,
 *  круг, брусок), чтобы пауза читалась как «грузится», а не как дыра. */
export const MediaSkeleton = ({ className }: { className?: string }) => (
  <svg className={cn("supra block w-full h-full", className)} viewBox="0 0 200 160" preserveAspectRatio="xMidYMid slice" aria-hidden>
    <rect width="200" height="160" fill="hsl(var(--surface-3))" />
    <rect className="supra-square" x="52" y="34" width="70" height="70" fill="hsl(var(--primary))" />
    <circle className="supra-circle" cx="150" cy="116" r="22" fill="hsl(var(--foreground) / 0.85)" />
    <rect className="supra-bar" x="20" y="120" width="96" height="9" fill="hsl(var(--foreground) / 0.55)" />
    <rect className="supra-bar2" x="130" y="28" width="7" height="60" fill="hsl(var(--amber))" />
  </svg>
);

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
  // Своё из blob декодируется мгновенно — без скелетона; чужое ждёт onLoad.
  const [loaded, setLoaded] = useState(!!localBlob);
  const size = dims ? previewSize(dims) : { width: 160, height: 112 };
  return (
    <div className="msg-media relative rounded-lg overflow-hidden max-w-full" style={size}>
      {!loaded && <MediaSkeleton className="absolute inset-0" />}
      {src && (
        <img
          src={src}
          alt={name || "Изображение"}
          loading="lazy"
          className={cn("w-full h-full object-contain cursor-pointer block transition-opacity duration-200", loaded ? "opacity-100" : "opacity-0")}
          onLoad={() => setLoaded(true)}
          onClick={() => onOpen(src, name || "image")}
          onError={onError}
        />
      )}
    </div>
  );
};

export const MessageVideoFile = ({ raw, dims }: { raw: string; dims?: { w: number; h: number } | null }) => {
  const src = useMediaUrl(raw);
  const [ready, setReady] = useState(false);
  // Бокс под видео по размерам с сервера (в пределах 280×256), чтобы лента не
  // прыгала, когда плеер узнает размер кадра. Без размеров — как раньше.
  const size = dims ? (() => { const s = Math.min(280 / dims.w, 256 / dims.h, 1); return { width: Math.round(dims.w * s), height: Math.round(dims.h * s) }; })() : { width: 176, height: 112 };
  return (
    <div className="msg-media relative rounded-lg overflow-hidden bg-black max-w-full" style={size}>
      {!ready && <MediaSkeleton className="absolute inset-0" />}
      {src && (
        <video
          src={src}
          controls
          playsInline
          preload="metadata"
          onLoadedData={() => setReady(true)}
          className={cn("w-full h-full block bg-black transition-opacity duration-200", ready ? "opacity-100" : "opacity-0")}
        />
      )}
    </div>
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
        className={cn("msg-note-edge absolute inset-0", own ? "bg-primary" : "bg-success")}
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



/** Элемент альбома — фото или видео из сообщения с общим album_id. */
export interface AlbumItem {
  id: string;
  raw: string;
  name: string | null;
  dims?: { w: number; h: number } | null;
  pending?: boolean;
  progress?: number | null;
  failed?: boolean;
}

const AlbumCell = ({ item, localMap, onOpen }: { item: AlbumItem; localMap?: Map<string, string>; onOpen: (url: string, name: string, id: string) => void }) => {
  const localBlob = item.raw.startsWith("blob:") ? item.raw : localMap?.get(item.raw);
  const signed = useMediaUrl(localBlob ? null : item.raw);
  const src = localBlob || signed;
  const [loaded, setLoaded] = useState(!!localBlob);
  const video = isVideoFile(item.name, item.raw);
  return (
    <div className="relative aspect-square overflow-hidden bg-black/20">
      {!loaded && !video && <MediaSkeleton className="absolute inset-0" />}
      {src && (video ? (
        <video src={src} controls playsInline preload="metadata" className="w-full h-full object-cover" />
      ) : (
        <img src={src} alt={item.name || ""} loading="lazy" onLoad={() => setLoaded(true)} onClick={() => onOpen(src, item.name || "image", item.id)}
          className={cn("w-full h-full object-cover cursor-pointer transition-opacity duration-200", loaded ? "opacity-100" : "opacity-0")} />
      ))}
      {item.pending && item.progress != null && (
        <div className="absolute inset-0 bg-black/45 flex items-center justify-center text-white text-sm font-semibold tabular-nums">
          {item.failed ? "✕" : item.progress === -1 ? "ждёт" : item.progress === -2 ? "сжатие" : item.progress < 100 ? `${item.progress}%` : "…"}
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
  <div className={cn("msg-media grid gap-0.5 rounded-lg overflow-hidden w-[min(320px,100%)]", items.length >= 5 ? "grid-cols-3" : "grid-cols-2", className)}>
    {items.map((it) => <AlbumCell key={it.id} item={it} localMap={localMap} onOpen={onOpen} />)}
  </div>
);
