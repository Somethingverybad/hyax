import { t } from "@/lib/i18n";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { NavLink, useLocation } from "react-router-dom";
import { Capacitor } from "@capacitor/core";
import { Haptics, ImpactStyle } from "@capacitor/haptics";
import { MessageSquare, Bookmark, Music2, Settings, Newspaper } from "lucide-react";
import { cn } from "@/lib/utils";
import { useMint, MintIcon, type MintIconName } from "@/themes/mint";
import { readCache } from "@/lib/session-cache";
import type { WallState } from "@/api/client";
import { useSections } from "@/lib/sections";
import { useNavTabs, type NavTab } from "@/lib/navTabs";
import { useIsMobile } from "@/hooks/use-mobile";
import RailPlayer from "@/components/RailPlayer";
import { useRailPos } from "@/lib/railPos";
import { setRailCallSlot } from "@/lib/railSlot";

/** Новые посты на Стене — бейдж на вкладке. Состояние кладёт Chat.tsx в кеш
 *  сессии и сообщает событием hyax:wall; при открытии Стены счётчик обнуляется. */
const useWallNew = () => {
  const [n, setN] = useState(() => readCache<WallState>("wall")?.new_count || 0);
  useEffect(() => {
    const on = (e: Event) => setN(((e as CustomEvent).detail as WallState | undefined)?.new_count || 0);
    window.addEventListener("hyax:wall", on);
    return () => window.removeEventListener("hyax:wall", on);
  }, []);
  return n;
};
const WallBadge = ({ n }: { n: number }) => n > 0 ? (
  <span className="absolute top-1.5 right-[calc(50%-18px)] min-w-[16px] h-4 px-1 rounded-full bg-primary text-primary-foreground text-[10px] font-bold leading-4 text-center" aria-label={t("Новых постов: {n}", { n })}>{n > 99 ? "99+" : n}</span>
) : null;

/**
 * Навигация по экранам. На телефоне — нижняя панель: иконки без подписей,
 * активная — красная: так на референсах, и так экономнее по высоте.
 * Подкладывается под home-индикатор (pad-safe-bottom), чтобы фон доходил
 * до края экрана. На широком окне — вертикальная панель у левого края
 * (NavRail); экраны с ней отступают слева на её ширину (класс nav-rail-pad).
 */
/** Вкладки — одна запись на каждую: путь, подпись, иконка обычной темы и
 *  «Мяты». Порядок и набор — lib/navTabs (настраивается в «Внешнем виде»). */
export const TAB_DEFS: Record<NavTab, { to: string; label: string; icon: typeof MessageSquare; mint: MintIconName; size: [number, number] }> = {
  chat: { to: "/chat", label: "Чаты", icon: MessageSquare, mint: "navChat", size: [28, 20] },
  wall: { to: "/wall", label: "Стена", icon: Newspaper, mint: "navWall", size: [21, 21] },
  saved: { to: "/saved", label: "Избранное", icon: Bookmark, mint: "navSaved", size: [16, 21] },
  music: { to: "/music", label: "Музыка", icon: Music2, mint: "navMusic", size: [17, 21] },
  profile: { to: "/profile", label: "Настройки", icon: Settings, mint: "navSettings", size: [23, 23] },
};

/** На телефоне в «Мяте» последняя вкладка — «Профиль» с человечком, как в
 *  мобильном макете; на широком окне (NavRail) — «Настройки» с шестерёнкой:
 *  там экран открывается колонкой настроек. */
export const MINT_PROFILE = { label: "Профиль", mint: "navProfile" as MintIconName, size: [21, 22] as [number, number] };

/** Вкладки меню по порядку; Стену можно выключить целиком (lib/sections). */
const useTabs = (mint: boolean) => {
  const { tabs } = useNavTabs(mint);
  const sections = useSections();
  return tabs.filter((id) => id !== "wall" || sections.wall).map((id) => ({ id, ...TAB_DEFS[id] }));
};

/** Вкладки — ссылки, и долгое нажатие на телефоне начинало их «перетаскивать»
 *  с подсказкой https://localhost/chat (баг-репорт): ни тянуть, ни меню ссылки. */
const NO_DRAG = { draggable: false, onContextMenu: (e: React.MouseEvent) => e.preventDefault(), onDragStart: (e: React.DragEvent) => e.preventDefault() };

/** Лёгкий отклик при переключении вкладок (на телефоне). */
const tap = () => {
  if (Capacitor.isNativePlatform()) Haptics.impact({ style: ImpactStyle.Light }).catch(() => {});
};

/** Панель живёт внутри каждого экрана и при переключении создаётся заново —
 *  помним, где стояла подсветка, чтобы она переплыла оттуда на новую вкладку. */
let lastMintIndex = -1;

const MintIsland = () => {
  const { pathname } = useLocation();
  const wallNew = useWallNew();
  const items = useTabs(true).map((d) => d.id === "profile"
    ? { to: d.to, label: MINT_PROFILE.label, icon: MINT_PROFILE.mint, size: MINT_PROFILE.size }
    : { to: d.to, label: d.label, icon: d.mint, size: d.size });
  const idx = items.findIndex((i) => pathname === i.to || pathname.startsWith(i.to + "/"));
  const [pos, setPos] = useState(lastMintIndex >= 0 ? lastMintIndex : idx);
  // Остров висит поверх контента: экраны отступают снизу на его высоту
  // (--mint-nav-space), чтобы последняя строка не пряталась под ним.
  const wrapRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = wrapRef.current, root = document.documentElement;
    if (!el) return;
    // Отступ меняется уже после отрисовки (эффект и его уборка) — сообщаем
    // о нём событием: панели ввода чатов перемеряют своё место по нему
    // (ChatWindow, «Мята»), иначе в открытом чате оставался отступ острова.
    const changed = () => window.dispatchEvent(new Event("hyax:nav-space"));
    const set = () => { root.style.setProperty("--mint-nav-space", `${Math.ceil(el.getBoundingClientRect().height)}px`); changed(); };
    set();
    const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(set) : null;
    ro?.observe(el);
    return () => { ro?.disconnect(); root.style.removeProperty("--mint-nav-space"); changed(); };
  }, []);
  useLayoutEffect(() => {
    if (idx < 0) return;
    const raf = requestAnimationFrame(() => setPos(idx));
    lastMintIndex = idx;
    return () => cancelAnimationFrame(raf);
  }, [idx]);
  return (
    <div ref={wrapRef} className="mint-nav-wrap flex justify-center pt-2 pad-safe-bottom">
      <nav className="mint-nav" style={{ ["--n" as string]: items.length }}>
        {pos >= 0 && pos < items.length && <span className="mint-nav-pill" style={{ ["--i" as string]: pos }} aria-hidden />}
        {items.map(({ to, label, icon, size }) => (
          <NavLink key={to} to={to} aria-label={t(label)} title={t(label)} {...NO_DRAG} onClick={tap}
            className={({ isActive }) => cn("mint-nav-item", isActive && "mint-nav-on")}>
            <MintIcon name={icon} size={size} />
            {to === "/wall" && <WallBadge n={wallNew} />}
          </NavLink>
        ))}
      </nav>
    </div>
  );
};

/** Широкое окно: те же вкладки столбиком у левого края, сверху вниз. */
const NavRail = ({ mint }: { mint: boolean }) => {
  const { pathname } = useLocation();
  const railPos = useRailPos();
  const wallNew = useWallNew();
  const items = useTabs(false);
  const idx = items.findIndex((i) => pathname === i.to || pathname.startsWith(i.to + "/"));
  const [pos, setPos] = useState(lastMintIndex >= 0 ? lastMintIndex : idx);
  useLayoutEffect(() => {
    if (idx < 0) return;
    const raf = requestAnimationFrame(() => setPos(idx));
    lastMintIndex = idx;
    return () => cancelAnimationFrame(raf);
  }, [idx]);
  return (
    <div className={cn("nav-rail-wrap", mint ? "mint-rail-wrap" : "ui-nav-rail border-r border-border bg-background")} data-pos={railPos}>
      <nav className={cn("nav-rail-tabs", mint ? "mint-rail" : "flex flex-col gap-1")} aria-label={t("Разделы")}>
        {mint && pos >= 0 && pos < items.length && <span className="mint-rail-pill" style={{ ["--i" as string]: pos }} aria-hidden />}
        {items.map(({ id, to, label, icon: Icon }) => (
          <NavLink key={to} to={to} aria-label={t(label)} title={t(label)} {...NO_DRAG}
            className={({ isActive }) => mint
              ? cn("mint-rail-item", isActive && "mint-nav-on")
              : cn("ui-nav-item relative flex items-center justify-center w-12 h-12 rounded-md transition-colors hover:bg-surface-2",
                isActive ? "ui-nav-on text-primary" : "text-subtle")}>
            {mint ? <MintIcon name={TAB_DEFS[id].mint} size={TAB_DEFS[id].size} /> : <Icon className="w-6 h-6" />}
            {to === "/wall" && <WallBadge n={wallNew} />}
          </NavLink>
        ))}
      </nav>
      {/* Низ колонки: плеер, а во время свёрнутого звонка — он (lib/railSlot). */}
      <div className="nav-rail-extra">
        <div ref={setRailCallSlot} className={cn(mint && "mint-rail rail-player", "empty:hidden")} />
        <RailPlayer mint={mint} />
      </div>
    </div>
  );
};

const BottomNav = () => {
  const mint = useMint();
  const wallNew = useWallNew();
  const items = useTabs(false);
  const isMobile = useIsMobile();
  if (isMobile === false) return <NavRail mint={mint} />;
  if (mint) return <MintIsland />;
  return (
    <nav className="ui-bottom-nav shrink-0 flex border-t border-border bg-background pad-safe-bottom">
      {items.map(({ to, label, icon: Icon }) => (
        <NavLink
          key={to}
          to={to}
          {...NO_DRAG}
          aria-label={t(label)}
          title={t(label)}
          onClick={tap}
          className={({ isActive }) =>
            cn(
              "ui-nav-item relative flex-1 flex flex-col items-center justify-center gap-0.5 h-14 transition-colors active:bg-surface-2",
              isActive ? "ui-nav-on text-primary" : "text-subtle",
            )
          }
        >
          {/* Без подписей, как на референсе: активная вкладка — красная иконка. */}
          <Icon className="w-6 h-6" />
          {to === "/wall" && <WallBadge n={wallNew} />}
          {/* Подпись видна только в темах, где она предусмотрена (см. index.css). */}
          <span className="ui-nav-label hidden text-[11px] font-semibold leading-none">{t(label)}</span>
        </NavLink>
      ))}
    </nav>
  );
};

export default BottomNav;
