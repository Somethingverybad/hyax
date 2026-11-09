import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { Heart, MessageCircle, Share2, MoreHorizontal, Volume2, VolumeX, Play, Radio, Images, ChevronLeft, ChevronRight } from "lucide-react";
import { t as tr, getLang } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { mediaUrl } from "@/api/client";
import { useMediaUrl } from "@/hooks/use-media-url";
import { timeOf } from "@/lib/timeFormat";
import { playerState, toggle as togglePlayer } from "@/lib/player";
import { type ReactionPick, type ReactionSummary } from "@/lib/reactions";
import { ReactionGlyph } from "@/components/chat/Reactions";
import Identicon from "@/components/Identicon";
import { Micro } from "@/components/chat/media";

/**
 * Стена в режиме «Клипы» — как короткие видео: пост во весь экран, листание
 * вертикальным свайпом, текст поста — подпись внизу, справа автор, «лайк»,
 * комментарии, «поделиться». Несколько фото и видео в посте — карусель
 * горизонтальным свайпом. Только свой контент Стены: файлы уже лежат у нас,
 * ничего не перекачивается.
 *
 * «Лайк» — это реакции: число — все реакции поста, сердце ставит быструю
 * реакцию человека (lib/reactions), повторный тап снимает его реакции,
 * удержание — выбрать другую. Двойной тап по кадру — лайк с сердечком.
 *
 * Жесты: ось выбирается по первому движению пальца и дальше не меняется —
 * вертикаль листает клипы (прокрутка ленты), горизонталь — карусель (своя,
 * без прокрутки: иначе диагональ двигала кадр по обеим осям). Щипок —
 * увеличить кадр, отпустили — вернулся. Картинки и видео касаний не ловят:
 * iOS при удержании «поднимал» фото и его можно было таскать по экрану.
 */

export type ClipMedia = {
  id: string; kind: "image" | "video"; raw: string; poster?: string | null; preview?: string | null;
  w?: number | null; h?: number | null; mirror?: boolean;
};

export type ClipPost = {
  id: string; created_at: string; content?: string;
  sender?: { id: string; username: string; avatar_url?: string | null };
  forwarded_chat?: { id: string; name: string; avatar_url?: string | null } | null;
  reactions?: ReactionSummary[]; comments_count?: number; views_count?: number;
  wall_safe?: boolean; wall_hidden?: boolean;
};

export type ClipItem = { post: ClipPost; media: ClipMedia[] };

/** Звук общий на всю ленту и на сеанс: включили раз — дальше клипы со звуком. */
let soundOn = false;

const DOUBLE_TAP_MS = 280;
const HOLD_MS = 450;

const totalReactions = (r?: ReactionSummary[]) => (r || []).reduce((n, x) => n + (x.count || 0), 0);
const fmtCount = (n: number) => (n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1).replace(/\.0$/, "")}M` : n >= 10_000 ? `${Math.round(n / 1000)}K` : n >= 1000 ? `${(n / 1000).toFixed(1).replace(/\.0$/, "")}K` : String(n));

export default function WallClips({ items, startId, hasMore, loadingOlder, onLoadOlder, onActive, onLike, onPickReaction,
  onComments, onShare, onAuthor, onMenu, renderCaption, bottomInset }: {
  items: ClipItem[];
  /** С какого поста начать (тот, что был на экране в ленте). */
  startId?: string | null;
  hasMore: boolean; loadingOlder: boolean; onLoadOlder: () => void;
  /** Пост стал текущим — просмотр, запоминание места. */
  onActive: (id: string) => void;
  /** like: true — поставить (двойной тап только ставит), undefined — переключить. */
  onLike: (post: ClipPost, like?: true) => void;
  onPickReaction: (post: ClipPost) => void;
  onComments: (post: ClipPost) => void;
  onShare: (post: ClipPost) => void;
  onAuthor: (post: ClipPost) => void;
  onMenu: (post: ClipPost) => void;
  renderCaption: (post: ClipPost) => ReactNode;
  /** Снизу под клипом — остров навигации: подпись и кнопки выше него. */
  bottomInset: string;
}) {
  const boxRef = useRef<HTMLDivElement>(null);
  const [active, setActive] = useState<string | null>(startId && items.some((x) => x.post.id === startId) ? startId : items[0]?.post.id ?? null);
  const [muted, setMuted] = useState(!soundOn);
  const activeIdx = Math.max(0, items.findIndex((x) => x.post.id === active));
  // Набор клипов, а не новый массив на каждой перерисовке Стены (опрос раз в несколько секунд).
  const ids = items.map((x) => x.post.id).join(",");

  // Начать с нужного поста — до первого кадра, без видимой прокрутки.
  useLayoutEffect(() => {
    const box = boxRef.current;
    if (!box || !active) return;
    const el = box.querySelector<HTMLElement>(`[data-clip="${CSS.escape(active)}"]`);
    if (el) box.scrollTop = el.offsetTop;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Пришёл новый пост (он встаёт сверху) или подгрузились старые — текущий клип
  // остаётся на экране, лента под ним не съезжает.
  const activeRef = useRef(active);
  activeRef.current = active;
  useLayoutEffect(() => {
    const box = boxRef.current, id = activeRef.current;
    const el = id ? box?.querySelector<HTMLElement>(`[data-clip="${CSS.escape(id)}"]`) : null;
    if (box && el && Math.abs(box.scrollTop - el.offsetTop) > 2) box.scrollTop = el.offsetTop;
  }, [ids]);

  // Текущий — тот, что занимает больше половины экрана.
  useEffect(() => {
    const box = boxRef.current;
    if (!box || typeof IntersectionObserver === "undefined") return;
    const io = new IntersectionObserver((entries) => {
      for (const e of entries) if (e.isIntersecting && e.intersectionRatio >= 0.6) setActive((e.target as HTMLElement).dataset.clip || null);
    }, { root: box, threshold: [0.6] });
    box.querySelectorAll("[data-clip]").forEach((el) => io.observe(el));
    return () => io.disconnect();
  }, [ids]);

  useEffect(() => {
    if (!active) return;
    onActive(active);
    // Досмотрели до трёх последних — подгружаем старые посты.
    if (hasMore && !loadingOlder && activeIdx >= items.length - 3) onLoadOlder();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, items.length]);

  const go = useCallback((dir: 1 | -1) => {
    const box = boxRef.current;
    if (box) box.scrollBy({ top: dir * box.clientHeight, behavior: "smooth" });
  }, []);

  /** Пока щипок — лента не листается. */
  const lockScroll = useCallback((on: boolean) => {
    const box = boxRef.current;
    if (box) box.style.overflowY = on ? "hidden" : "";
  }, []);

  const setSound = useCallback((on: boolean) => {
    soundOn = on;
    setMuted(!on);
    // Музыка из плеера приложения и звук клипа разом — каша: музыку на паузу.
    if (on && playerState().playing) void togglePlayer();
  }, []);

  // Компьютер: стрелки и j/k — листать, M — звук.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) return;
      if (e.key === "ArrowDown" || e.key === "j") { e.preventDefault(); go(1); }
      else if (e.key === "ArrowUp" || e.key === "k") { e.preventDefault(); go(-1); }
      else if (e.key === "m" || e.key === "M" || e.key === "ь" || e.key === "Ь") setSound(muted);
      else if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
        window.dispatchEvent(new CustomEvent("hyax:clip-slide", { detail: { id: activeRef.current, dir: e.key === "ArrowLeft" ? -1 : 1 } }));
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [go, muted, setSound]);

  if (!items.length) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center gap-2 px-8 text-center text-muted-foreground">
        <Images className="w-10 h-10 opacity-60" />
        <p className="text-body">{tr("Здесь будут посты с фото и видео")}</p>
        <p className="text-small">{tr("Опубликуйте первый — он появится и в ленте, и в клипах")}</p>
      </div>
    );
  }

  return (
    <div ref={boxRef} className="clips-feed flex-1 min-h-0 overflow-y-auto overflow-x-hidden snap-y snap-mandatory overscroll-contain bg-black [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
      {items.map((it, i) => (
        <Clip key={it.post.id} item={it} active={it.post.id === active}
          // Медиа держим только у текущего и соседей — остальные без видео и картинок в памяти.
          near={Math.abs(i - activeIdx) <= 1}
          muted={muted} onSound={setSound} bottomInset={bottomInset} lockScroll={lockScroll}
          onLike={onLike} onPickReaction={onPickReaction} onComments={onComments} onShare={onShare}
          onAuthor={onAuthor} onMenu={onMenu} caption={renderCaption(it.post)} />
      ))}
      {loadingOlder && (
        <div className="h-24 snap-end flex items-center justify-center text-small text-white/60">{tr("Загружаю…")}</div>
      )}
    </div>
  );
}

function Clip({ item, active, near, muted, onSound, bottomInset, lockScroll, onLike, onPickReaction, onComments, onShare, onAuthor, onMenu, caption }: {
  item: ClipItem; active: boolean; near: boolean; muted: boolean; onSound: (on: boolean) => void; bottomInset: string;
  lockScroll: (on: boolean) => void;
  onLike: (post: ClipPost, like?: true) => void; onPickReaction: (post: ClipPost) => void;
  onComments: (post: ClipPost) => void; onShare: (post: ClipPost) => void;
  onAuthor: (post: ClipPost) => void; onMenu: (post: ClipPost) => void; caption: ReactNode;
}) {
  const { post, media } = item;
  const [slide, setSlide] = useState(0);
  const [paused, setPaused] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [hearts, setHearts] = useState<{ id: number; x: number; y: number }[]>([]);
  const [zooming, setZooming] = useState(false);
  const frameRef = useRef<HTMLDivElement>(null);
  const trackRef = useRef<HTMLDivElement>(null);
  const zoomRef = useRef<HTMLDivElement | null>(null);
  const tapRef = useRef<{ at: number; timer: ReturnType<typeof setTimeout> | null }>({ at: 0, timer: null });
  const n = media.length;
  const slideRef = useRef(slide);
  slideRef.current = slide;
  // Жест: ось — по первому движению; pinch — щипок двумя пальцами.
  const gRef = useRef({ x0: 0, y0: 0, t0: 0, axis: null as null | "x" | "y" | "pinch", dx: 0, d0: 1, cx0: 0, cy0: 0, noTapUntil: 0 });

  /** Карусель: сдвиг дорожки — к текущему слайду плюс палец (dx). */
  const setTrack = useCallback((dx: number, animate: boolean) => {
    const el = trackRef.current;
    if (!el) return;
    el.style.transition = animate ? "transform 280ms cubic-bezier(.2,.8,.2,1)" : "none";
    el.style.transform = `translate3d(calc(${-slideRef.current * 100}% + ${dx}px), 0, 0)`;
  }, []);
  useLayoutEffect(() => { setTrack(0, true); }, [slide, setTrack]);
  const goSlide = useCallback((i: number) => {
    const next = Math.max(0, Math.min(n - 1, i));
    if (next !== slideRef.current) { setSlide(next); setPaused(false); } else setTrack(0, true);
  }, [n, setTrack]);

  // Стрелки влево/вправо на компьютере — у текущего клипа.
  useEffect(() => {
    if (!active || n < 2) return;
    const on = (e: Event) => { const d = (e as CustomEvent<{ id: string; dir: number }>).detail; if (d?.id === post.id) goSlide(slideRef.current + d.dir); };
    window.addEventListener("hyax:clip-slide", on);
    return () => window.removeEventListener("hyax:clip-slide", on);
  }, [active, n, post.id, goSlide]);

  useEffect(() => {
    const el = frameRef.current;
    if (!el) return;
    const dist = (t: TouchList) => Math.hypot(t[0].clientX - t[1].clientX, t[0].clientY - t[1].clientY);
    const unzoom = () => {
      const z = zoomRef.current;
      if (z) { z.style.transition = "transform 250ms ease-out"; z.style.transform = ""; }
    };
    const onStart = (e: TouchEvent) => {
      const g = gRef.current;
      if (e.touches.length >= 2) {
        // Щипок: дорожку — на место, ленту — держим, кадр увеличиваем от точки между пальцами.
        g.axis = "pinch";
        g.d0 = dist(e.touches) || 1;
        g.cx0 = (e.touches[0].clientX + e.touches[1].clientX) / 2;
        g.cy0 = (e.touches[0].clientY + e.touches[1].clientY) / 2;
        const r = el.getBoundingClientRect();
        const z = zoomRef.current;
        if (z) { z.style.transition = "none"; z.style.transformOrigin = `${g.cx0 - r.left}px ${g.cy0 - r.top}px`; }
        setTrack(0, true);
        lockScroll(true);
        setZooming(true);
        return;
      }
      g.x0 = e.touches[0].clientX; g.y0 = e.touches[0].clientY; g.t0 = performance.now(); g.axis = null; g.dx = 0;
    };
    const onMove = (e: TouchEvent) => {
      const g = gRef.current;
      if (g.axis === "pinch") {
        if (e.touches.length < 2) return;
        if (e.cancelable) e.preventDefault();
        const sc = Math.max(1, Math.min(4, dist(e.touches) / g.d0));
        const cx = (e.touches[0].clientX + e.touches[1].clientX) / 2, cy = (e.touches[0].clientY + e.touches[1].clientY) / 2;
        const z = zoomRef.current;
        if (z) z.style.transform = `translate3d(${cx - g.cx0}px, ${cy - g.cy0}px, 0) scale(${sc})`;
        return;
      }
      const t = e.touches[0];
      const dx = t.clientX - g.x0, dy = t.clientY - g.y0;
      if (!g.axis) {
        if (Math.abs(dx) < 8 && Math.abs(dy) < 8) return;
        g.axis = Math.abs(dx) > Math.abs(dy) ? "x" : "y";
      }
      // Вертикаль — лента листается сама (touch-action: pan-y), горизонталь — наша.
      if (g.axis !== "x") return;
      if (e.cancelable) e.preventDefault();
      if (n < 2) return;
      const i = slideRef.current;
      const edge = (i === 0 && dx > 0) || (i === n - 1 && dx < 0);
      g.dx = edge ? dx / 3 : dx;
      setTrack(g.dx, false);
    };
    const onEnd = (e: TouchEvent) => {
      const g = gRef.current;
      if (g.axis === "pinch") {
        if (e.touches.length > 0) return;
        unzoom();
        g.axis = null;
        g.noTapUntil = performance.now() + 400;
        lockScroll(false);
        setZooming(false);
        return;
      }
      if (g.axis === "x" && n > 1) {
        const w = el.clientWidth || 1;
        const v = g.dx / Math.max(1, performance.now() - g.t0);
        const i = slideRef.current;
        if (g.dx < -w * 0.18 || v < -0.45) goSlide(i + 1);
        else if (g.dx > w * 0.18 || v > 0.45) goSlide(i - 1);
        else setTrack(0, true);
      }
      if (g.axis) g.noTapUntil = performance.now() + 250;
      g.axis = null; g.dx = 0;
    };
    el.addEventListener("touchstart", onStart, { passive: true });
    el.addEventListener("touchmove", onMove, { passive: false });
    el.addEventListener("touchend", onEnd);
    el.addEventListener("touchcancel", onEnd);
    return () => {
      el.removeEventListener("touchstart", onStart);
      el.removeEventListener("touchmove", onMove);
      el.removeEventListener("touchend", onEnd);
      el.removeEventListener("touchcancel", onEnd);
      lockScroll(false);
    };
  }, [n, goSlide, setTrack, lockScroll]);

  // Ушли с клипа — при возврате играет сначала, без паузы и с первой карточки текста.
  useEffect(() => { if (!active) { setPaused(false); setExpanded(false); } }, [active]);

  const current = media[slide];

  /** Тап — пауза у видео (без звука — сначала включает звук), двойной — лайк с сердечком. */
  const onTap = (e: React.MouseEvent) => {
    if (performance.now() < gRef.current.noTapUntil) return; // это был свайп или щипок
    const now = Date.now();
    const tap = tapRef.current;
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    if (now - tap.at < DOUBLE_TAP_MS) {
      if (tap.timer) clearTimeout(tap.timer);
      tap.timer = null; tap.at = 0;
      const id = now;
      setHearts((h) => [...h, { id, x: e.clientX - rect.left, y: e.clientY - rect.top }]);
      setTimeout(() => setHearts((h) => h.filter((x) => x.id !== id)), 900);
      onLike(post, true);
      return;
    }
    tap.at = now;
    tap.timer = setTimeout(() => {
      tap.timer = null;
      if (current?.kind !== "video") return;
      if (muted) { onSound(true); setPaused(false); return; }
      setPaused((p) => !p);
    }, DOUBLE_TAP_MS);
  };

  const mine = (post.reactions || []).find((r) => r.mine);
  const likes = totalReactions(post.reactions);
  const holdRef = useRef<{ timer: ReturnType<typeof setTimeout> | null; held: boolean }>({ timer: null, held: false });
  const likeDown = () => {
    holdRef.current.held = false;
    holdRef.current.timer = setTimeout(() => { holdRef.current.held = true; onPickReaction(post); }, HOLD_MS);
  };
  const likeUp = () => { if (holdRef.current.timer) clearTimeout(holdRef.current.timer); holdRef.current.timer = null; };
  const author = post.forwarded_chat ? post.forwarded_chat.name : post.sender?.username || "";

  return (
    <div data-clip={post.id} className={cn("clip relative h-full w-full snap-start snap-always overflow-hidden bg-black select-none [-webkit-touch-callout:none]", zooming && "clip-zooming")}>
      {/* Кадр: на телефоне во весь экран, на компьютере — колонка 9:16 по центру. */}
      <div className="relative h-full w-full md:w-auto md:aspect-[9/16] md:mx-auto">
        <div ref={frameRef} onClick={onTap} className="absolute inset-0 overflow-hidden" style={{ touchAction: "pan-y" }}>
          <div ref={trackRef} className="absolute inset-0 flex will-change-transform">
            {media.map((m, i) => (
              <div key={m.id} className="relative h-full w-full shrink-0 overflow-hidden">
                <div ref={i === slide ? zoomRef : undefined} className="absolute inset-0">
                  {near && (Math.abs(i - slide) <= 1)
                    ? m.kind === "video"
                      ? <ClipVideo m={m} current={active && i === slide} paused={paused} muted={muted} />
                      : <ClipImage m={m} />
                    : m.preview ? <Micro src={m.preview} /> : null}
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Компьютер: листать карусель кнопками (и стрелками клавиатуры). */}
        {n > 1 && (
          <>
            {slide > 0 && (
              <button type="button" onClick={() => goSlide(slide - 1)} aria-label={tr("Назад")}
                className="clip-ui hidden md:flex absolute left-2 top-1/2 -translate-y-1/2 w-10 h-10 rounded-full bg-black/45 text-white items-center justify-center hover:bg-black/60">
                <ChevronLeft className="w-6 h-6" />
              </button>
            )}
            {slide < n - 1 && (
              <button type="button" onClick={() => goSlide(slide + 1)} aria-label={tr("Далее")}
                className="clip-ui hidden md:flex absolute right-16 top-1/2 -translate-y-1/2 w-10 h-10 rounded-full bg-black/45 text-white items-center justify-center hover:bg-black/60">
                <ChevronRight className="w-6 h-6" />
              </button>
            )}
          </>
        )}

        {hearts.map((h) => (
          <Heart key={h.id} className="clip-heart absolute w-24 h-24 -ml-12 -mt-12 text-rose-500 fill-rose-500 pointer-events-none drop-shadow-lg"
            style={{ left: h.x, top: h.y }} />
        ))}

        {current?.kind === "video" && paused && active && (
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
            <span className="w-20 h-20 rounded-full bg-black/40 flex items-center justify-center"><Play className="w-10 h-10 text-white fill-white ml-1" /></span>
          </div>
        )}

        {/* Затемнение под подписью и кнопками — текст читается на любом кадре. */}
        <div aria-hidden className="clip-ui absolute inset-x-0 bottom-0 h-1/2 bg-gradient-to-t from-black/80 via-black/30 to-transparent pointer-events-none" />
        <div aria-hidden className="clip-ui absolute inset-y-0 right-0 w-24 bg-gradient-to-l from-black/35 to-transparent pointer-events-none" />

        {/* Звук и признаки поста — сверху справа. */}
        <div className="clip-ui absolute right-3 flex items-center gap-1.5" style={{ top: "calc(var(--glass-h, 0px) + 12px)" }}>
          {post.wall_hidden && <span className="px-2 h-6 rounded-full bg-destructive/80 text-[11px] font-semibold text-white flex items-center">{tr("скрыт")}</span>}
          {post.wall_safe && <span className="px-2 h-6 rounded-full bg-black/50 ring-1 ring-white/25 text-[11px] font-semibold text-white flex items-center" title={tr("Контент 4+")}>4+</span>}
          {media.some((m) => m.kind === "video") && (
            <button type="button" onClick={() => onSound(muted)} aria-label={muted ? tr("Включить звук") : tr("Выключить звук")}
              className="w-9 h-9 rounded-full bg-black/50 ring-1 ring-white/25 text-white flex items-center justify-center">
              {muted ? <VolumeX className="w-5 h-5" /> : <Volume2 className="w-5 h-5" />}
            </button>
          )}
        </div>

        {/* Карусель: точки и счётчик. */}
        {media.length > 1 && (
          <>
            <span className="clip-ui absolute left-3 px-2 h-6 rounded-full bg-black/50 ring-1 ring-white/25 text-[12px] font-semibold text-white flex items-center tabular-nums" style={{ top: "calc(var(--glass-h, 0px) + 12px)" }}>{slide + 1}/{media.length}</span>
            <div className="clip-ui absolute inset-x-0 flex justify-center gap-1.5 pointer-events-none" style={{ bottom: `calc(${bottomInset} + 14px)` }}>
              {media.map((m, i) => <span key={m.id} className={cn("h-1.5 rounded-full transition-all", i === slide ? "w-4 bg-white" : "w-1.5 bg-white/50")} />)}
            </div>
          </>
        )}

        {/* Справа: автор, лайк, комментарии, поделиться, ещё. */}
        <div className="clip-ui clip-rail absolute right-2 flex flex-col items-center gap-4 text-white" style={{ bottom: `calc(${bottomInset} + ${media.length > 1 ? 34 : 24}px)` }}>
          {/* Обводка — по форме аватара (квадрат со скруглением, как везде в приложении). */}
          <button type="button" onClick={() => onAuthor(post)} aria-label={author} className="clip-avatar rounded-md ring-2 ring-white/90 overflow-hidden active:scale-95 transition-transform">
            {post.forwarded_chat
              ? post.forwarded_chat.avatar_url
                ? <img src={mediaUrl(post.forwarded_chat.avatar_url)} alt="" className="ui-avatar w-11 h-11 rounded-md object-cover" />
                : <span className="ui-avatar w-11 h-11 rounded-md bg-black/40 flex items-center justify-center"><Radio className="w-5 h-5" /></span>
              : post.sender && <Identicon id={post.sender.id} avatarUrl={post.sender.avatar_url || undefined} className="w-11 h-11" />}
          </button>
          <button type="button" aria-label={mine ? tr("Убрать реакцию") : tr("Нравится")} aria-pressed={!!mine}
            onPointerDown={likeDown} onPointerUp={likeUp} onPointerLeave={likeUp} onPointerCancel={likeUp}
            onContextMenu={(e) => { e.preventDefault(); onPickReaction(post); }}
            onClick={() => { if (!holdRef.current.held) onLike(post); holdRef.current.held = false; }}
            className="flex flex-col items-center gap-0.5 active:scale-95 transition-transform select-none [-webkit-touch-callout:none]">
            <span className="w-11 h-11 flex items-center justify-center">
              {mine
                ? <ReactionGlyph pick={{ key: mine.key || mine.emoji, emoji: mine.emoji, custom: mine.custom } as ReactionPick} size={30} />
                : <Heart className="w-8 h-8 drop-shadow" />}
            </span>
            <span className="text-[12px] font-semibold drop-shadow tabular-nums">{fmtCount(likes)}</span>
          </button>
          <button type="button" onClick={() => onComments(post)} aria-label={tr("Комментарии")} className="flex flex-col items-center gap-0.5 active:scale-95 transition-transform">
            <span className="w-11 h-11 flex items-center justify-center"><MessageCircle className="w-8 h-8 drop-shadow" /></span>
            <span className="text-[12px] font-semibold drop-shadow tabular-nums">{fmtCount(post.comments_count ?? 0)}</span>
          </button>
          <button type="button" onClick={() => onShare(post)} aria-label={tr("Поделиться постом")} className="flex flex-col items-center gap-0.5 active:scale-95 transition-transform">
            <span className="w-11 h-11 flex items-center justify-center"><Share2 className="w-7 h-7 drop-shadow" /></span>
          </button>
          <button type="button" onClick={() => onMenu(post)} aria-label={tr("Действия")} className="w-11 h-9 flex items-center justify-center active:scale-95 transition-transform">
            <MoreHorizontal className="w-7 h-7 drop-shadow" />
          </button>
        </div>

        {/* Снизу слева: автор, время и текст поста — описание клипа. */}
        <div className="clip-ui clip-caption absolute left-3 right-[72px] text-white" style={{ bottom: `calc(${bottomInset} + ${media.length > 1 ? 32 : 22}px)` }}>
          <button type="button" onClick={() => onAuthor(post)} className="text-body font-semibold drop-shadow active:opacity-70">
            {author}<span className="ml-2 text-caption font-normal text-white/70">{timeOf(post.created_at, getLang())}</span>
          </button>
          {post.content?.trim() && (
            <div onClick={() => setExpanded((v) => !v)}
              className={cn("mt-1 text-small leading-snug drop-shadow whitespace-pre-wrap break-words cursor-pointer [&_a]:underline",
                expanded ? "max-h-[40vh] overflow-y-auto" : "line-clamp-2")}>
              {caption}
            </div>
          )}
        </div>

        {current?.kind === "video" && <ClipProgress id={current.id} bottomInset={bottomInset} />}
      </div>
    </div>
  );
}

/** Полоска прогресса текущего видео: тап по ней — перемотка. */
function ClipProgress({ id, bottomInset }: { id: string; bottomInset: string }) {
  const [p, setP] = useState(0);
  const barRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    let raf = 0;
    const tick = () => {
      const v = document.querySelector<HTMLVideoElement>(`video[data-clip-media="${CSS.escape(id)}"]`);
      if (v && v.duration > 0 && Number.isFinite(v.duration)) setP(v.currentTime / v.duration);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [id]);
  const seek = (e: React.PointerEvent) => {
    e.stopPropagation();
    const r = barRef.current?.getBoundingClientRect();
    const v = document.querySelector<HTMLVideoElement>(`video[data-clip-media="${CSS.escape(id)}"]`);
    if (!r || !v || !(v.duration > 0) || !Number.isFinite(v.duration)) return;
    v.currentTime = Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)) * v.duration;
  };
  return (
    <div ref={barRef} onPointerDown={seek} onClick={(e) => e.stopPropagation()}
      className="absolute inset-x-0 h-5 flex items-end cursor-pointer" style={{ bottom: bottomInset }}>
      <div className="w-full h-[3px] bg-white/25">
        <div className="h-full bg-white" style={{ width: `${p * 100}%` }} />
      </div>
    </div>
  );
}

function ClipVideo({ m, current, paused, muted }: { m: ClipMedia; current: boolean; paused: boolean; muted: boolean }) {
  const playing = current && !paused;
  const src = useMediaUrl(m.raw);
  const poster = useMediaUrl(m.poster || null);
  const ref = useRef<HTMLVideoElement>(null);
  // Кадр почти той же формы, что экран, — во весь экран (обрезая края), иначе целиком с полями.
  const [ratio, setRatio] = useState(m.w && m.h ? m.w / m.h : 0);
  const [boxRatio, setBoxRatio] = useState(9 / 16);
  useLayoutEffect(() => {
    const el = ref.current?.parentElement;
    if (el && el.clientHeight) setBoxRatio(el.clientWidth / el.clientHeight);
  }, []);
  const cover = ratio > 0 && Math.abs(ratio - boxRatio) / boxRatio < 0.22;

  useEffect(() => {
    const v = ref.current;
    if (!v) return;
    v.muted = muted;
    if (playing) {
      const p = v.play();
      // Со звуком без жеста система не даёт — тогда без звука.
      if (p) p.catch(() => { if (!v.muted) { v.muted = true; void v.play().catch(() => {}); } });
    } else {
      v.pause();
    }
  }, [playing, muted, src]);
  // Ушли с клипа или слайда — вернёмся к началу; пауза по тапу место не сбрасывает.
  useEffect(() => { if (!current && ref.current) ref.current.currentTime = 0; }, [current]);

  return (
    <>
    {/* Кадр с полями — под ним размытая обложка, как у фото: без чёрных пустот. */}
    {!cover && poster && <img src={poster} alt="" aria-hidden draggable={false} className="absolute inset-0 w-full h-full object-cover scale-110 blur-2xl opacity-50 pointer-events-none" />}
    <video ref={ref} data-clip-media={m.id} src={src || undefined} poster={poster || undefined}
      // Соседние клипы грузятся заранее — свайп к ним без ожидания (дальние не рисуются вовсе).
      playsInline loop muted={muted} preload="auto"
      onLoadedMetadata={(e) => { const v = e.currentTarget; if (v.videoWidth && v.videoHeight) setRatio(v.videoWidth / v.videoHeight); }}
      style={m.mirror ? { transform: "scaleX(-1)" } : undefined}
      className={cn("absolute inset-0 w-full h-full pointer-events-none", cover ? "object-cover" : "object-contain")} />
    </>
  );
}

function ClipImage({ m }: { m: ClipMedia }) {
  const src = useMediaUrl(m.raw);
  const [loaded, setLoaded] = useState(false);
  return (
    <>
      {/* Подложка — то же фото размытым: у кадра другой формы нет чёрных полей. */}
      {m.preview ? <Micro src={m.preview} />
        : src && <img src={src} alt="" aria-hidden draggable={false} className="absolute inset-0 w-full h-full object-cover scale-110 blur-2xl opacity-50 pointer-events-none" />}
      {src && <img src={src} alt="" onLoad={() => setLoaded(true)} draggable={false}
        className={cn("absolute inset-0 w-full h-full object-contain pointer-events-none transition-opacity duration-200", loaded ? "opacity-100" : "opacity-0")} />}
    </>
  );
}
