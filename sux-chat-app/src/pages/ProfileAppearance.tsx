import ScreenHeader from "@/components/ScreenHeader";
import { SettingsCard } from "@/components/settings";
import { setTheme, useTheme, type Theme } from "@/lib/theme";
import { Check, Moon, Sun } from "lucide-react";
import { cn } from "@/lib/utils";

const THEMES: { id: Theme; label: string; hint: string; icon: React.ComponentType<{ className?: string }> }[] = [
  { id: "light", label: "Светлая", hint: "Белые карточки, тёмный текст", icon: Sun },
  { id: "dark", label: "Тёмная", hint: "Почти чёрный фон — как было", icon: Moon },
];

/** Образец темы: два прямоугольника цветами самой темы, а не текущей. */
const Swatch = ({ theme }: { theme: Theme }) => (
  <span
    className={cn(
      "w-12 h-9 shrink-0 rounded-md border overflow-hidden flex flex-col",
      theme === "light" ? "bg-[#F8FAFC] border-[#E5E7EB]" : "bg-[#0F0F10] border-[#262628]",
    )}
    aria-hidden
  >
    <span className={cn("h-3 w-full", theme === "light" ? "bg-white" : "bg-[#171718]")} />
    <span className="flex-1 flex items-center px-1">
      <span className="h-1.5 w-5 rounded-full bg-[#DB2317]" />
    </span>
  </span>
);

/**
 * Внешний вид. Пока здесь только выбор темы — светлая или тёмная.
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
