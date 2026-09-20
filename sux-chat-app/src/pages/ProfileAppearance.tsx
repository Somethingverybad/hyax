import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { Check, Link2, MoreHorizontal, Pencil, Plus, Trash2 } from "lucide-react";
import ScreenHeader from "@/components/ScreenHeader";
import { SettingsCard } from "@/components/settings";
import { api } from "@/api/client";
import { BUILTIN_THEMES, setInstalledThemes, setTheme, useInstalledThemes, useTheme } from "@/lib/theme";
import { normalizeTheme } from "@/themes/engine";
import { themeLink } from "@/lib/share";
import type { ThemeDef } from "@/themes/types";

/** Образец темы: фон, полоса шапки, акцент и обводка — цветами самой темы. */
export const Swatch = ({ theme }: { theme: ThemeDef }) => {
  const c = theme.colors, outlined = theme.shape.style === "outlined";
  return (
    <span
      className="w-12 h-9 shrink-0 rounded-md overflow-hidden flex flex-col"
      style={{ backgroundColor: c.background, border: `${outlined ? 2 : 1}px solid ${outlined ? c.ink : c.border}`, boxShadow: outlined && theme.shape.shadowOffset ? `2px 2px 0 0 ${c.ink}` : undefined }}
      aria-hidden
    >
      <span className="h-3 w-full" style={{ backgroundColor: c.surface1, borderBottom: `1px solid ${outlined ? c.ink : c.border}` }} />
      <span className="flex-1 flex items-center gap-1 px-1">
        <span className="h-1.5 w-5 rounded-full" style={{ backgroundColor: c.primary, outline: outlined ? `1px solid ${c.ink}` : undefined }} />
        <span className="h-1.5 w-2 rounded-full" style={{ backgroundColor: c.bubbleIn, outline: outlined ? `1px solid ${c.ink}` : undefined }} />
      </span>
    </span>
  );
};

const Row = ({ theme, active, onPick, menu }: { theme: ThemeDef; active: boolean; onPick: () => void; menu?: React.ReactNode }) => (
  <div className="flex items-center">
    <button
      type="button"
      onClick={onPick}
      className="flex-1 min-w-0 min-h-16 px-4 py-2.5 flex items-center gap-3 text-left active:bg-surface-3"
      aria-pressed={active}
    >
      <Swatch theme={theme} />
      <span className="min-w-0 flex-1">
        <span className="block text-body truncate">{theme.name}</span>
        <span className="block text-caption text-subtle truncate">
          {theme.builtin
            ? (theme.shape.style === "outlined" ? "Обводки тушью, жёсткие тени" : theme.base === "light" ? "Белые карточки, тёмный текст" : "Почти чёрный фон")
            : `${theme.mine ? "Моя тема" : theme.author ? `Автор: ${theme.author}` : "Без автора"}${theme.installs ? ` · установок: ${theme.installs}` : ""}`}
        </span>
      </span>
      {active && <Check className="w-5 h-5 text-primary shrink-0" />}
    </button>
    {menu}
  </div>
);

/**
 * Внешний вид: встроенные темы, мои и установленные, создание своей.
 * Выбор уходит в профиль на сервере и переезжает между устройствами; копия
 * лежит на устройстве (см. lib/theme).
 */
const ProfileAppearance = () => {
  const navigate = useNavigate();
  const current = useTheme();
  const installed = useInstalledThemes();
  const [menuFor, setMenuFor] = useState<string | null>(null);

  useEffect(() => {
    api.listThemes().then((list) => setInstalledThemes(list.map((t) => normalizeTheme(t)))).catch(() => {});
  }, []);

  const share = async (t: ThemeDef) => {
    try { await navigator.clipboard.writeText(themeLink(t.id)); toast.success("Ссылка скопирована"); }
    catch { toast.error("Не удалось скопировать"); }
    setMenuFor(null);
  };
  const remove = async (t: ThemeDef) => {
    setMenuFor(null);
    try {
      if (t.mine) { if (!confirm(`Удалить тему «${t.name}»? Она пропадёт и у тех, кто её установил.`)) return; await api.deleteTheme(t.id); }
      else await api.uninstallTheme(t.id);
      const rest = installed.filter((x) => x.id !== t.id);
      setInstalledThemes(rest);
      if (current.id === t.id) setTheme(BUILTIN_THEMES[1]);
      toast.success(t.mine ? "Тема удалена" : "Тема убрана");
    } catch (e: any) { toast.error(e?.message || "Не получилось"); }
  };

  return (
    <div className="h-screen flex flex-col bg-background">
      <ScreenHeader title="Внешний вид" />

      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-3">
        <p className="px-1 text-small text-subtle">Встроенные</p>
        <SettingsCard>
          {BUILTIN_THEMES.map((t) => <Row key={t.id} theme={t} active={current.id === t.id} onPick={() => setTheme(t)} />)}
        </SettingsCard>

        <p className="px-1 pt-2 text-small text-subtle">Мои и установленные</p>
        <SettingsCard>
          {installed.length === 0 && (
            <div className="px-4 py-4 text-small text-subtle">Пока пусто. Создайте свою тему или установите чужую по ссылке /t/…</div>
          )}
          {installed.map((t) => (
            <div key={t.id} className="relative">
              <Row
                theme={t}
                active={current.id === t.id}
                onPick={() => setTheme(t)}
                menu={
                  <button type="button" onClick={() => setMenuFor(menuFor === t.id ? null : t.id)} className="w-11 h-16 flex items-center justify-center text-subtle active:opacity-60" aria-label="Действия">
                    <MoreHorizontal className="w-5 h-5" />
                  </button>
                }
              />
              {menuFor === t.id && (
                <div className="px-4 pb-3 flex flex-wrap gap-2">
                  {t.mine && (
                    <button type="button" onClick={() => navigate(`/profile/themes/${t.id}`)} className="h-9 px-3 rounded-md bg-surface-4 text-small font-medium inline-flex items-center gap-1.5"><Pencil className="w-4 h-4" /> Изменить</button>
                  )}
                  <button type="button" onClick={() => share(t)} className="h-9 px-3 rounded-md bg-surface-4 text-small font-medium inline-flex items-center gap-1.5"><Link2 className="w-4 h-4" /> Поделиться</button>
                  <button type="button" onClick={() => remove(t)} className="h-9 px-3 rounded-md bg-surface-4 text-small font-medium text-destructive inline-flex items-center gap-1.5"><Trash2 className="w-4 h-4" /> {t.mine ? "Удалить" : "Убрать"}</button>
                </div>
              )}
            </div>
          ))}
        </SettingsCard>

        <button
          type="button"
          onClick={() => navigate("/profile/themes/new")}
          className="w-full h-11 rounded-md bg-primary text-primary-foreground font-semibold flex items-center justify-center gap-2 active:opacity-90"
        >
          <Plus className="w-5 h-5" /> Создать тему
        </button>

        <p className="px-1 text-caption text-subtle">
          Выбор запоминается в профиле и применяется на всех ваших устройствах. Своей темой можно поделиться ссылкой.
        </p>
      </div>
    </div>
  );
};

export default ProfileAppearance;
