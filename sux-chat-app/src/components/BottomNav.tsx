import { NavLink } from "react-router-dom";
import { MessageSquare, Bookmark, User } from "lucide-react";
import { cn } from "@/lib/utils";

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
  { to: "/profile", label: "Профиль", icon: User },
];

const BottomNav = () => {
  return (
    <nav className="ui-bottom-nav shrink-0 flex border-t border-border bg-background pad-safe-bottom">
      {ITEMS.map(({ to, label, icon: Icon }) => (
        <NavLink
          key={to}
          to={to}
          aria-label={label}
          title={label}
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
