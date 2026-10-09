import { useLayoutEffect, useState } from "react";
import { NavLink, useLocation } from "react-router-dom";
import { Capacitor } from "@capacitor/core";
import { Haptics, ImpactStyle } from "@capacitor/haptics";
import { MessageSquare, Bookmark, Music2, User } from "lucide-react";
import { cn } from "@/lib/utils";
import { useMint, MintIcon, type MintIconName } from "@/themes/mint";

/**
 * Нижняя навигация — только на телефоне. Три иконки без подписей, активная —
 * красная: так на референсах, и так экономнее по высоте.
 *
 * Подкладывается под home-индикатор (pad-safe-bottom), чтобы фон доходил
 * до края экрана.
 */
const ITEMS = [
  { to: "/chat", label: "Чаты", icon: MessageSquare },
  { to: "/saved", label: "Избранное", icon: Bookmark },
  { to: "/music", label: "Музыка", icon: Music2 },
  { to: "/profile", label: "Профиль", icon: User },
];

/** «Мята»: остров по макету — свои иконки и порядок вкладок. */
const MINT_ITEMS: { to: string; label: string; icon: MintIconName; size: [number, number] }[] = [
  { to: "/music", label: "Музыка", icon: "navMusic", size: [17, 21] },
  { to: "/saved", label: "Избранное", icon: "navSaved", size: [16, 21] },
  { to: "/chat", label: "Чаты", icon: "navChat", size: [28, 20] },
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
  const idx = MINT_ITEMS.findIndex((i) => pathname === i.to || pathname.startsWith(i.to + "/"));
  const [pos, setPos] = useState(lastMintIndex >= 0 ? lastMintIndex : idx);
  useLayoutEffect(() => {
    if (idx < 0) return;
    const raf = requestAnimationFrame(() => setPos(idx));
    lastMintIndex = idx;
    return () => cancelAnimationFrame(raf);
  }, [idx]);
  return (
    <div className="mint-nav-wrap shrink-0 flex justify-center pt-2 pad-safe-bottom">
      <nav className="mint-nav">
        {pos >= 0 && <span className="mint-nav-pill" style={{ ["--i" as string]: pos }} aria-hidden />}
        {MINT_ITEMS.map(({ to, label, icon, size }) => (
          <NavLink key={to} to={to} aria-label={label} title={label} onClick={tap}
            className={({ isActive }) => cn("mint-nav-item", isActive && "mint-nav-on")}>
            <MintIcon name={icon} size={size} />
          </NavLink>
        ))}
      </nav>
    </div>
  );
};

const BottomNav = () => {
  const mint = useMint();
  if (mint) return <MintIsland />;
  return (
    <nav className="ui-bottom-nav shrink-0 flex border-t border-border bg-background pad-safe-bottom">
      {ITEMS.map(({ to, label, icon: Icon }) => (
        <NavLink
          key={to}
          to={to}
          aria-label={label}
          title={label}
          onClick={tap}
          className={({ isActive }) =>
            cn(
              "ui-nav-item flex-1 flex flex-col items-center justify-center gap-0.5 h-14 transition-colors active:bg-surface-2",
              isActive ? "ui-nav-on text-primary" : "text-subtle",
            )
          }
        >
          {/* Без подписей, как на референсе: активная вкладка — красная иконка. */}
          <Icon className="w-6 h-6" />
          {/* Подпись видна только в темах, где она предусмотрена (см. index.css). */}
          <span className="ui-nav-label hidden text-[11px] font-semibold leading-none">{label}</span>
        </NavLink>
      ))}
    </nav>
  );
};

export default BottomNav;
