import { NavLink } from "react-router-dom";
import { MessageSquare, Bookmark, User } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Нижняя навигация — только на телефоне. Плоские плитки без скруглений,
 * активная вкладка отмечается алой полосой сверху: супрематизм размечает
 * состояние геометрией, а не свечением.
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
    <nav className="shrink-0 flex border-t border-border bg-card pad-safe-bottom">
      {ITEMS.map(({ to, label, icon: Icon }) => (
        <NavLink
          key={to}
          to={to}
          className={({ isActive }) =>
            cn(
              "flex-1 flex flex-col items-center gap-1 pt-2 pb-1 border-t-2 transition-colors",
              isActive
                ? "border-primary text-foreground"
                : "border-transparent text-muted-foreground",
            )
          }
        >
          <Icon className="w-5 h-5" />
          <span className="text-[11px] font-medium">{label}</span>
        </NavLink>
      ))}
    </nav>
  );
};

export default BottomNav;
