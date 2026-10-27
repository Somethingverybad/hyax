import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { MicOff, Pin, Volume1, Volume2, VolumeX, X } from "lucide-react";
import Identicon from "@/components/Identicon";
import type { AudioLevels, PeerRect, VideoRect } from "@/lib/nativeCall";
import { cn } from "@/lib/utils";
import { t } from "@/lib/i18n";
import VideoView from "./VideoView";
import { useSpeaking } from "./useSpeaking";

/** Плитка участника группового звонка (и своя — self). */
export interface StageTile {
  id: string;
  name: string;
  avatarUrl?: string | null;
  self?: boolean;
  /** Браузер: поток с видео (своя камера или поток участника). */
  stream?: MediaStream | null;
  /** Камера включена — плитка с видео, иначе аватар. */
  video: boolean;
  /** Своё превью с фронтальной камеры зеркалим. */
  mirrored?: boolean;
  muted?: boolean;
  /** Соединение ещё поднимается. */
  connecting?: boolean;
  /** Демонстрация экрана участника: кадр целиком (без обрезки), сама встаёт крупно. */
  screen?: boolean;
}

/** Сетка — все поровну; «Говорящий» — крупно тот, кто говорит. */
export type StageMode = "grid" | "speaker";

type Rect = { x: number; y: number; w: number; h: number };

const GAP = 8;
const RADIUS = 14;
// Плитка сетки не уже 9:16 и не шире 16:9 — иначе выходят «полоски».
const MIN_A = 9 / 16;
const MAX_A = 16 / 9;
const SPEAK = "#3ddc84";

const round = (r: Rect): Rect => ({ x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.w), h: Math.round(r.h) });

/** Сетка: число колонок, при котором плитки выходят крупнее всего;
 *  неполный последний ряд — по центру. */
function gridRects(n: number, W: number, H: number): Rect[] {
  if (n <= 0) return [];
  let best = { cols: 1, rows: n, w: 0, h: 0, score: -1 };
  for (let cols = 1; cols <= n; cols++) {
    const rows = Math.ceil(n / cols);
    const cw = (W - GAP * (cols - 1)) / cols;
    const ch = (H - GAP * (rows - 1)) / rows;
    if (cw <= 0 || ch <= 0) continue;
    let w = cw;
    let h = ch;
    if (w / h > MAX_A) w = h * MAX_A;
    else if (w / h < MIN_A) h = w / MIN_A;
    if (w * h > best.score + 1) best = { cols, rows, w, h, score: w * h };
  }
  const { cols, rows, w, h } = best;
  const y0 = (H - (rows * h + GAP * (rows - 1))) / 2;
  const out: Rect[] = [];
  for (let i = 0; i < n; i++) {
    const row = Math.floor(i / cols);
    const col = i % cols;
    const inRow = row === rows - 1 ? n - cols * (rows - 1) : cols;
    const x0 = (W - (inRow * w + GAP * (inRow - 1))) / 2;
    out.push(round({ x: x0 + col * (w + GAP), y: y0 + row * (h + GAP), w, h }));
  }
  return out;
}

/** Один крупно, остальные полосой: снизу на узком экране, справа на широком. */
function spotlightRects(k: number, W: number, H: number): { main: Rect; strip: Rect[] } {
  if (k === 0) return { main: { x: 0, y: 0, w: W, h: H }, strip: [] };
  if (W <= H * 1.05) {
    const sh = Math.round(Math.min(160, Math.max(88, H * 0.2)));
    let tw = Math.round(sh * 0.75);
    if (k * tw + (k - 1) * GAP > W) tw = Math.floor((W - (k - 1) * GAP) / k);
    const x0 = (W - (k * tw + (k - 1) * GAP)) / 2;
    return {
      main: { x: 0, y: 0, w: W, h: H - sh - GAP },
      strip: Array.from({ length: k }, (_, i) => round({ x: x0 + i * (tw + GAP), y: H - sh, w: tw, h: sh })),
    };
  }
  const sw = Math.round(Math.min(260, Math.max(140, W * 0.2)));
  let th = Math.round((sw * 9) / 16);
  if (k * th + (k - 1) * GAP > H) th = Math.floor((H - (k - 1) * GAP) / k);
  const y0 = (H - (k * th + (k - 1) * GAP)) / 2;
  return {
    main: { x: 0, y: 0, w: W - sw - GAP, h: H },
    strip: Array.from({ length: k }, (_, i) => round({ x: W - sw, y: y0 + i * (th + GAP), w: sw, h: th })),
  };
}

/** Свой оттенок фона плитки у каждого — по id, чтобы плитки различались. */
function hue(id: string): number {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) % 360;
  return h;
}

interface Props {
  tiles: StageTile[];
  mode: StageMode;
  onModeChange: (m: StageMode) => void;
  /** Уровни звука — для подсветки говорящего и режима «Говорящий». */
  getLevels?: () => Promise<AudioLevels>;
  /** Приложение: видео рисует нативный движок под страницей. */
  nativeLayout?: (remotes: PeerRect[], local: VideoRect | null) => void;
  /** Где под страницей видео (координаты экрана звонка) — там фон не рисуем. */
  onHoles?: (holes: VideoRect[]) => void;
  volumes: Record<string, number>;
  onVolume: (id: string, v: number) => void;
  className?: string;
}

/**
 * Участники группового звонка плитками. Сетка — все поровну; нажатие
 * разворачивает участника, остальные остаются полосой миниатюр (нажатие по
 * миниатюре — переключиться на неё, по крупному — обратно к сетке). В
 * режиме «Говорящий» крупно сам собой показывается тот, кто говорит.
 *
 * В приложении видео рисуют нативные окна под прозрачной страницей: сюда
 * они приходят прямоугольниками плиток, а вокруг фон рисует экран звонка.
 */
const GroupStage = ({ tiles, mode, onModeChange, getLevels, nativeLayout, onHoles, volumes, onVolume, className }: Props) => {
  const stageRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const [pinned, setPinned] = useState<string | null>(null);
  const [volFor, setVolFor] = useState<string | null>(null);
  // Демонстрацию, которую свернули к сетке нажатием, больше крупно не ставим.
  const [dismissed, setDismissed] = useState<string | null>(null);
  const self = tiles.find((x) => x.self);
  const { speaking, activeSpeaker } = useSpeaking(getLevels, self?.id || "self", true);

  useLayoutEffect(() => {
    const el = stageRef.current;
    if (!el) return;
    const measure = () => {
      const r = el.getBoundingClientRect();
      setSize((p) => (Math.abs(p.w - r.width) < 1 && Math.abs(p.h - r.height) < 1 ? p : { w: r.width, h: r.height }));
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const ids = tiles.map((x) => x.id);
  const remotes = tiles.filter((x) => !x.self);
  // Кто-то показывает экран — он крупно, как в Зуме (пока не свернули).
  const shared = tiles.find((x) => x.screen && x.id !== dismissed);
  let mainId: string | null = null;
  if (tiles.length > 1) {
    if (pinned && ids.includes(pinned)) mainId = pinned;
    else if (shared) mainId = shared.id;
    else if (mode === "speaker") mainId = activeSpeaker && ids.includes(activeSpeaker) ? activeSpeaker : remotes[0]?.id ?? null;
  }

  const idsKey = ids.join();
  // Демонстрация закончилась — следующая того же участника снова крупно.
  useEffect(() => {
    if (dismissed && !idsKey.split(",").includes(dismissed)) setDismissed(null);
  }, [idsKey, dismissed]);
  const rects = useMemo(() => {
    const m = new Map<string, Rect>();
    if (!size.w || !size.h) return m;
    const list = idsKey ? idsKey.split(",") : [];
    if (!mainId) {
      gridRects(list.length, size.w, size.h).forEach((r, i) => m.set(list[i], r));
    } else {
      const others = list.filter((id) => id !== mainId);
      const { main, strip } = spotlightRects(others.length, size.w, size.h);
      m.set(mainId, round(main));
      others.forEach((id, i) => m.set(id, strip[i]));
    }
    return m;
  }, [size.w, size.h, idsKey, mainId]);

  // Нативное видео: прямоугольники плиток с камерой — движку и экрану звонка.
  const nativeKey = nativeLayout
    ? JSON.stringify(tiles.filter((x) => x.video).map((x) => [x.id, x.self ? 1 : 0, rects.get(x.id)]))
    : "";
  const layoutRef = useRef(nativeLayout);
  layoutRef.current = nativeLayout;
  const holesRef = useRef(onHoles);
  holesRef.current = onHoles;
  useLayoutEffect(() => {
    if (!nativeLayout) return;
    const push = () => {
      const stage = stageRef.current;
      const layer = stage?.closest(".call-layer");
      if (!stage || !layer) return;
      const sb = stage.getBoundingClientRect();
      const lb = layer.getBoundingClientRect();
      const peers: PeerRect[] = [];
      let local: VideoRect | null = null;
      const holes: VideoRect[] = [];
      for (const tile of tiles) {
        const r = tile.video ? rects.get(tile.id) : undefined;
        if (!r) continue;
        const v: VideoRect = { x: sb.left + r.x, y: sb.top + r.y, w: r.w, h: r.h, r: RADIUS };
        holes.push({ ...v, x: v.x - lb.left, y: v.y - lb.top });
        if (tile.self) local = v;
        else peers.push({ ...v, peerId: tile.id });
      }
      document.documentElement.classList.toggle("native-video", holes.length > 0);
      nativeLayout(peers, local);
      holesRef.current?.(holes);
    };
    push();
    window.addEventListener("resize", push);
    return () => window.removeEventListener("resize", push);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nativeKey, nativeLayout]);
  // Экран звонка свернули или закрыли — видео из-под страницы убрать.
  useLayoutEffect(() => () => {
    if (!layoutRef.current) return;
    document.documentElement.classList.remove("native-video");
    layoutRef.current([], null);
    holesRef.current?.([]);
  }, []);

  const native = !!nativeLayout;
  const volTile = volFor ? tiles.find((x) => x.id === volFor && !x.self) : undefined;
  const vol = volTile ? volumes[volTile.id] ?? 1 : 1;

  return (
    <div ref={stageRef} className={cn("relative", className)}>
      {tiles.map((tile) => {
        const r = rects.get(tile.id);
        if (!r) return null;
        const isMain = tile.id === mainId;
        const small = !!mainId && !isMain;
        return (
          <Tile
            key={tile.id}
            tile={tile}
            rect={r}
            native={native}
            speaking={speaking.includes(tile.id)}
            pinned={pinned === tile.id}
            small={small}
            main={isMain}
            onTap={() => {
              if (isMain) {
                setPinned(null);
                if (tile.screen) setDismissed(tile.id);
                if (mode === "speaker") onModeChange("grid");
              } else {
                setPinned(tile.id);
              }
            }}
            onVolume={!tile.self && !small && r.w >= 120 ? () => setVolFor(tile.id) : undefined}
          />
        );
      })}
      {volTile && (
        <div className="absolute left-1/2 -translate-x-1/2 bottom-2 z-20 w-[min(360px,calc(100%-1rem))] rounded-xl bg-surface-1 text-foreground border border-border shadow-xl p-3 flex items-center gap-3">
          <div className="w-9 h-9 shrink-0"><Identicon id={volTile.id} avatarUrl={volTile.avatarUrl} className="w-full h-full" /></div>
          <div className="min-w-0 flex-1">
            <div className="text-small font-semibold truncate">{volTile.name}</div>
            {/* До 200%: середина шкалы — обычная громкость, отмечена чёрточкой. */}
            <div className="relative">
              <input
                type="range"
                min={0}
                max={2}
                step={0.05}
                value={vol}
                onChange={(e) => onVolume(volTile.id, Number(e.target.value))}
                className="w-full h-1 accent-primary"
                aria-label={t("Громкость: {name}", { name: volTile.name })}
              />
              <span className="absolute left-1/2 -translate-x-1/2 top-full mt-0.5 w-px h-1.5 bg-subtle/60 pointer-events-none" aria-hidden />
            </div>
          </div>
          <span className="text-caption text-subtle tabular-nums w-10 text-right">{Math.round(vol * 100)}%</span>
          <button
            type="button"
            onClick={() => onVolume(volTile.id, vol === 0 ? 1 : 0)}
            className="w-9 h-9 shrink-0 rounded-full flex items-center justify-center text-subtle active:bg-surface-3"
            aria-label={vol === 0 ? t("Включить {name}", { name: volTile.name }) : t("Выключить {name}", { name: volTile.name })}
          >
            {vol === 0 ? <VolumeX className="w-5 h-5" /> : vol < 0.6 ? <Volume1 className="w-5 h-5" /> : <Volume2 className="w-5 h-5" />}
          </button>
          <button type="button" onClick={() => setVolFor(null)} className="w-9 h-9 shrink-0 rounded-full flex items-center justify-center text-subtle active:bg-surface-3" aria-label={t("Закрыть")}>
            <X className="w-5 h-5" />
          </button>
        </div>
      )}
    </div>
  );
};

const Tile = ({ tile, rect, native, speaking, pinned, small, main, onTap, onVolume }: {
  tile: StageTile;
  rect: Rect;
  native: boolean;
  speaking: boolean;
  pinned: boolean;
  small: boolean;
  main: boolean;
  onTap: () => void;
  onVolume?: () => void;
}) => {
  const avatar = Math.round(Math.max(28, Math.min(136, Math.min(rect.w, rect.h) * 0.4)));
  const h = hue(tile.id);
  const name = tile.self ? t("Вы") : tile.name;
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onTap}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onTap();
        }
      }}
      aria-label={main ? t("Показать всех") : t("Развернуть: {name}", { name })}
      data-tile={tile.id}
      className={cn(
        "absolute overflow-hidden select-none cursor-pointer outline-none",
        // Нативные окна не анимируются — плитки тоже, иначе разъедутся.
        !native && "transition-[left,top,width,height] duration-300 ease-out",
      )}
      style={{
        left: rect.x,
        top: rect.y,
        width: rect.w,
        height: rect.h,
        borderRadius: RADIUS,
        background: tile.video
          ? native ? "transparent" : "#000"
          : `radial-gradient(120% 90% at 50% 38%, hsl(${h} 60% 55% / 0.30), transparent 72%), hsl(var(--surface-2))`,
      }}
    >
      {tile.video && !native && tile.stream && (
        <VideoView stream={tile.stream} mirrored={tile.self && tile.mirrored} className={cn("absolute inset-0 w-full h-full", tile.screen ? "object-contain" : "object-cover")} />
      )}
      {!tile.video && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 px-2">
          <div
            className={cn("rounded-full transition-[box-shadow] duration-200", tile.connecting && "opacity-50")}
            style={{ width: avatar, height: avatar, boxShadow: speaking ? `0 0 0 3px ${SPEAK}, 0 0 22px 4px rgba(61,220,132,.45)` : "none" }}
          >
            <Identicon id={tile.id} avatarUrl={tile.avatarUrl} className="w-full h-full" />
          </div>
          {tile.connecting && !small && <div className="text-caption text-subtle">{t("Подключение…")}</div>}
        </div>
      )}
      {/* Говорит — светится рамка плитки (видна и поверх видео). */}
      <div
        className="absolute inset-0 pointer-events-none transition-opacity duration-200"
        style={{ borderRadius: RADIUS, boxShadow: `inset 0 0 0 3px ${SPEAK}`, opacity: speaking ? 1 : 0 }}
        aria-hidden
      />
      <div
        className={cn(
          "absolute left-1.5 bottom-1.5 max-w-[calc(100%-0.75rem)] flex items-center gap-1 rounded-md bg-black/55 text-white px-1.5 py-0.5 leading-tight",
          small ? "text-[10px]" : "text-[12px]",
        )}
      >
        {tile.muted && <MicOff className="w-3.5 h-3.5 shrink-0 text-[#ff6b6b]" aria-label={t("Микрофон выключен")} />}
        {pinned && <Pin className="w-3 h-3 shrink-0" aria-hidden />}
        <span className="truncate">{name}</span>
      </div>
      {onVolume && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onVolume();
          }}
          className="absolute right-1.5 top-1.5 w-8 h-8 rounded-full bg-black/45 text-white flex items-center justify-center active:bg-black/60"
          aria-label={t("Громкость: {name}", { name: tile.name })}
          title={t("Громкость: {name}", { name: tile.name })}
        >
          <Volume2 className="w-4 h-4" />
        </button>
      )}
    </div>
  );
};

/** Фон экрана звонка с вырезами под нативное видео (скруглённые углы плиток). */
export const StageMask = ({ holes }: { holes: VideoRect[] }) => {
  const rr = ({ x, y, w, h, r = 0 }: VideoRect) => {
    const q = Math.min(r, w / 2, h / 2);
    return `M${x + q} ${y}H${x + w - q}A${q} ${q} 0 0 1 ${x + w} ${y + q}V${y + h - q}A${q} ${q} 0 0 1 ${x + w - q} ${y + h}H${x + q}A${q} ${q} 0 0 1 ${x} ${y + h - q}V${y + q}A${q} ${q} 0 0 1 ${x + q} ${y}Z`;
  };
  const d = "M-10 -10H100000V100000H-10Z" + holes.map(rr).join("");
  return (
    <svg className="absolute inset-0 w-full h-full pointer-events-none" aria-hidden>
      <path d={d} fillRule="evenodd" style={{ fill: "hsl(var(--background))" }} />
    </svg>
  );
};

export default GroupStage;
