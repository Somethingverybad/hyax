import { t } from "@/lib/i18n";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { NavLink, useLocation } from "react-router-dom";
import { Capacitor } from "@capacitor/core";
import { Haptics, ImpactStyle } from "@capacitor/haptics";
import { MessageSquare, Bookmark, Music2, User, Newspaper } from "lucide-react";
import { cn } from "@/lib/utils";
import { useMint, MintIcon, type MintIconName } from "@/themes/mint";
import { readCache } from "@/lib/session-cache";
import type { WallState } from "@/api/client";
import { useSections } from "@/lib/sections";

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
 * Нижняя навигация — только на телефоне. Три иконки без подписей, активная —
 * красная: так на референсах, и так экономнее по высоте.
 *
 * Подкладывается под home-индикатор (pad-safe-bottom), чтобы фон доходил
 * до края экрана.
 */
const ITEMS = [
  { to: "/chat", label: "Чаты", icon: MessageSquare },
  { to: "/wall", label: "Стена", icon: Newspaper },
  { to: "/saved", label: "Избранное", icon: Bookmark },
  { to: "/music", label: "Музыка", icon: Music2 },
  { to: "/profile", label: "Профиль", icon: User },
];

/** «Мята»: остров по макету — свои иконки и порядок вкладок. */
const MINT_ITEMS: { to: string; label: string; icon: MintIconName; size: [number, number] }[] = [
  { to: "/music", label: "Музыка", icon: "navMusic", size: [17, 21] },
  { to: "/saved", label: "Избранное", icon: "navSaved", size: [16, 21] },
  { to: "/chat", label: "Чаты", icon: "navChat", size: [28, 20] },
  { to: "/wall", label: "Стена", icon: "navWall", size: [21, 21] },
  { to: "/profile", label: "Профиль", icon: "navProfile", size: [22, 23] },
];

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
  // Стену можно скрыть (lib/sections) — тогда вкладок четыре.
  const sections = useSections();
  const items = MINT_ITEMS.filter((i) => i.to !== "/wall" || sections.wall);
  const idx = items.findIndex((i) => pathname === i.to || pathname.startsWith(i.to + "/"));
  const [pos, setPos] = useState(lastMintIndex >= 0 ? lastMintIndex : idx);
  // Остров висит поверх контента: экраны отступают снизу на его высоту
  // (--mint-nav-space), чтобы последняя строка не пряталась под ним.
  const wrapRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = wrapRef.current, root = document.documentElement;
    if (!el) return;
    const set = () => root.style.setProperty("--mint-nav-space", `${Math.ceil(el.getBoundingClientRect().height)}px`);
    set();
    const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(set) : null;
    ro?.observe(el);
    return () => { ro?.disconnect(); root.style.removeProperty("--mint-nav-space"); };
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
          <NavLink key={to} to={to} aria-label={t(label)} title={t(label)} onClick={tap}
            className={({ isActive }) => cn("mint-nav-item", isActive && "mint-nav-on")}>
            <MintIcon name={icon} size={size} />
            {to === "/wall" && <WallBadge n={wallNew} />}
          </NavLink>
        ))}
      </nav>
    </div>
  );
};

const BottomNav = () => {
  const mint = useMint();
  const wallNew = useWallNew();
  const sections = useSections();
  if (mint) return <MintIsland />;
  return (
    <nav className="ui-bottom-nav shrink-0 flex border-t border-border bg-background pad-safe-bottom">
      {ITEMS.filter((i) => i.to !== "/wall" || sections.wall).map(({ to, label, icon: Icon }) => (
        <NavLink
          key={to}
          to={to}
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
