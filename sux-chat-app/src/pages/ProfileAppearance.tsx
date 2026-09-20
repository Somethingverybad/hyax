import ScreenHeader from "@/components/ScreenHeader";
import { SettingsCard } from "@/components/settings";
import { setTheme, useTheme, type Theme } from "@/lib/theme";
import { Check, Moon, Sun, Shapes } from "lucide-react";
import { cn } from "@/lib/utils";

const THEMES: { id: Theme; label: string; hint: string; icon: React.ComponentType<{ className?: string }> }[] = [
  { id: "light", label: "Светлая", hint: "Белые карточки, тёмный текст", icon: Sun },
  { id: "dark", label: "Тёмная", hint: "Почти чёрный фон — как было", icon: Moon },
  { id: "neo", label: "Необрутализм", hint: "Кремовый фон, обводки тушью, жёсткие тени", icon: Shapes },
];

/** Цвета образца: фон экрана, рамка, полоса шапки, акцент. */
const SWATCH: Record<Theme, { bg: string; border: string; bar: string; accent: string }> = {
  light: { bg: "#F8FAFC", border: "#E5E7EB", bar: "#FFFFFF", accent: "#DB2317" },
  dark: { bg: "#0F0F10", border: "#262628", bar: "#171718", accent: "#DB2317" },
  neo: { bg: "#F5F5EB", border: "#111111", bar: "#FFE08A", accent: "#22C55E" },
};

/** Образец темы: два прямоугольника цветами самой темы, а не текущей. */
const Swatch = ({ theme }: { theme: Theme }) => {
  const c = SWATCH[theme];
  return (
    <span
      className={cn("w-12 h-9 shrink-0 rounded-md overflow-hidden flex flex-col", theme === "neo" ? "border-2" : "border")}
      style={{ backgroundColor: c.bg, borderColor: c.border, boxShadow: theme === "neo" ? `2px 2px 0 0 ${c.border}` : undefined }}
      aria-hidden
    >
      <span className="h-3 w-full" style={{ backgroundColor: c.bar, borderBottom: theme === "neo" ? `2px solid ${c.border}` : undefined }} />
      <span className="flex-1 flex items-center px-1">
        <span className="h-1.5 w-5 rounded-full" style={{ backgroundColor: c.accent, outline: theme === "neo" ? `1.5px solid ${c.border}` : undefined }} />
      </span>
    </span>
  );
};

/**
 * Внешний вид. Пока здесь только выбор темы — светлая, тёмная или «Необрутализм».
 * Выбор запоминается на устройстве (см. lib/theme), на сервер не уходит.
 */
const ProfileAppearance = () => {
  const current = useTheme();

  return (
    <div className="h-screen flex flex-col bg-background">
      <ScreenHeader title="Внешний вид" />

      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-3">
        <SettingsCard>
          {THEMES.map(({ id, label, hint, icon: Icon }) => (
            <button
              key={id}
              type="button"
              onClick={() => setTheme(id)}
              className="w-full min-h-16 px-4 py-2.5 flex items-center gap-3 text-left active:bg-surface-3"
              aria-pressed={current === id}
            >
              <Swatch theme={id} />
              <span className="min-w-0 flex-1">
                <span className="flex items-center gap-1.5 text-body">
                  <Icon className="w-4 h-4 text-subtle shrink-0" />
                  {label}
                </span>
                <span className="block text-caption text-subtle truncate">{hint}</span>
              </span>
              {current === id && <Check className="w-5 h-5 text-primary shrink-0" />}
            </button>
          ))}
        </SettingsCard>

        <p className="px-1 text-caption text-subtle">
          Тема запоминается на этом устройстве.
        </p>
      </div>
    </div>
  );
};

export default ProfileAppearance;
