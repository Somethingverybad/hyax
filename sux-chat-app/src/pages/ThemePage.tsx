import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { toast } from "sonner";
import { Check, Flag, Palette, Plus, Share2, Trash2 } from "lucide-react";
import ScreenHeader from "@/components/ScreenHeader";
import ThemePreview from "@/components/ThemePreview";
import ReportSheet from "@/components/ReportSheet";
import { api } from "@/api/client";
import { setInstalledThemes, setTheme, useInstalledThemes, useTheme } from "@/lib/theme";
import { normalizeTheme } from "@/themes/engine";
import { themeLink } from "@/lib/share";
import type { ThemeDef } from "@/themes/types";

/**
 * Тема по ссылке /t/<id> — как /sp/<id> для звуков: предпросмотр, «Установить»,
 * «Включить». Своя тема открывается отсюда же на правку.
 */
const ThemePage = () => {
  const { id = "" } = useParams();
  const navigate = useNavigate();
  const installed = useInstalledThemes();
  const active = useTheme();
  const [theme, setThemeState] = useState<ThemeDef | null | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  const [reportOpen, setReportOpen] = useState(false);

  useEffect(() => {
    let alive = true;
    api.getTheme(id)
      .then((t) => alive && setThemeState(normalizeTheme(t)))
      .catch(() => alive && setThemeState(null));
    return () => { alive = false; };
  }, [id]);

  const install = async () => {
    if (!theme || busy) return;
    setBusy(true);
    try {
      const saved = normalizeTheme(await api.installTheme(theme.id));
      setInstalledThemes([saved, ...installed.filter((t) => t.id !== saved.id)]);
      setThemeState(saved);
      setTheme(saved);
      toast.success("Тема установлена и включена");
    } catch (e: any) { toast.error(e?.message || "Не получилось"); }
    finally { setBusy(false); }
  };

  const remove = async () => {
    if (!theme || busy) return;
    setBusy(true);
    try {
      await api.uninstallTheme(theme.id);
      setInstalledThemes(installed.filter((t) => t.id !== theme.id));
      setThemeState({ ...theme, installed: false });
      toast.success("Тема убрана");
    } catch (e: any) { toast.error(e?.message || "Не получилось"); }
    finally { setBusy(false); }
  };

  const share = async () => {
    try { await navigator.clipboard.writeText(themeLink(id)); toast.success("Ссылка скопирована"); }
    catch { toast.error("Не удалось скопировать"); }
  };

  return (
    <div className="h-screen flex flex-col bg-background">
      <ScreenHeader
        title="Тема оформления"
        onBack={() => (window.history.length > 1 ? navigate(-1) : navigate("/chat", { replace: true }))}
        right={
          <button type="button" onClick={share} className="w-10 h-10 flex items-center justify-center text-subtle active:opacity-60" aria-label="Поделиться">
            <Share2 className="w-5 h-5" />
          </button>
        }
      />
      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-3">
        {theme === undefined ? (
          <p className="py-10 text-center text-small text-subtle">Загрузка…</p>
        ) : theme === null ? (
          <p className="py-10 text-center text-small text-subtle">Тема не найдена или приватная</p>
        ) : (
          <>
            <div className="flex items-center gap-4">
              <span className="w-16 h-16 rounded-lg bg-surface-3 flex items-center justify-center shrink-0">
                <Palette className="w-7 h-7 text-primary" />
              </span>
              <div className="min-w-0">
                <p className="text-[22px] leading-tight font-semibold truncate">{theme.name}</p>
                <p className="mt-1 text-small text-subtle truncate">
                  {theme.mine ? "Моя тема" : theme.author ? `Автор: ${theme.author}` : "Без автора"}
                  {theme.installs ? ` · установок: ${theme.installs}` : ""}
                </p>
              </div>
            </div>

            <ThemePreview theme={theme} />

            {active.id === theme.id ? (
              <p className="px-1 text-small text-subtle flex items-center gap-1.5"><Check className="w-4 h-4 text-primary" /> Тема включена</p>
            ) : (
              <button type="button" onClick={theme.installed || theme.mine ? () => setTheme(theme) : install} disabled={busy} className="w-full h-11 rounded-md bg-primary text-primary-foreground font-semibold flex items-center justify-center gap-2 disabled:opacity-50">
                {theme.installed || theme.mine ? <><Check className="w-4 h-4" /> Включить</> : <><Plus className="w-4 h-4" /> Установить</>}
              </button>
            )}

            {theme.mine && (
              <button type="button" onClick={() => navigate(`/profile/themes/${theme.id}`)} className="w-full h-11 rounded-md bg-surface-4 font-medium">Изменить тему</button>
            )}
            {theme.installed && !theme.mine && (
              <button type="button" onClick={remove} disabled={busy} className="w-full h-11 rounded-md bg-surface-4 font-medium text-destructive flex items-center justify-center gap-2 disabled:opacity-50">
                <Trash2 className="w-4 h-4" /> Убрать из моих
              </button>
            )}
            {!theme.mine && (
              <button type="button" onClick={() => setReportOpen(true)} className="w-full h-11 rounded-md text-small text-subtle flex items-center justify-center gap-2">
                <Flag className="w-4 h-4" /> Пожаловаться
              </button>
            )}
          </>
        )}
      </div>
      {reportOpen && theme && (
        <ReportSheet target={{ type: "theme", id: theme.id }} title="Пожаловаться на тему" onClose={() => setReportOpen(false)} />
      )}
    </div>
  );
};

export default ThemePage;
