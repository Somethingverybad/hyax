import { useRef, useState } from "react";
import { createPortal } from "react-dom";
import { toast } from "sonner";
import { Image as ImageIcon, Users, User, Trash2, EyeOff, X, Film } from "lucide-react";
import { api, type Chat } from "@/api/client";
import { getSetting, setSetting } from "@/lib/settings";

/**
 * Обои чата. Общие (видят оба собеседника) и личные (поверх общих, только у
 * меня). Файл — фото, gif или видео: сервер ужмёт и для анимации сделает
 * лёгкий mp4 с постером. «Анимация обоев» — настройка устройства: выключил —
 * вместо видео показывается постер, и так во всех чатах.
 */
const WallpaperSheet = ({ chat, onClose, onChanged }: { chat: Chat; onClose: () => void; onChanged: () => void }) => {
  const fileRef = useRef<HTMLInputElement>(null);
  const scopeRef = useRef<"chat" | "me">("chat");
  const [busy, setBusy] = useState(false);
  const [anim, setAnim] = useState(() => getSetting("wallpaper_anim"));
  const isChannel = chat.kind === "channel";

  const pick = (scope: "chat" | "me") => { scopeRef.current = scope; fileRef.current?.click(); };
  const onFile = async (f?: File | null) => {
    if (!f || busy) return;
    setBusy(true);
    try {
      await api.setChatWallpaper(chat.id, f, scopeRef.current);
      toast.success(scopeRef.current === "chat" ? "Обои поставлены для всех" : "Обои поставлены только у вас");
      onChanged(); onClose();
    } catch (e: any) { toast.error(e?.message || "Не удалось поставить обои"); }
    finally { setBusy(false); }
  };
  const clear = async (scope: "chat" | "me", hide = false) => {
    if (busy) return;
    setBusy(true);
    try {
      await api.clearChatWallpaper(chat.id, scope, hide);
      toast.success(scope === "chat" ? "Обои чата убраны" : hide ? "У вас обоев не будет" : "Снова как у чата");
      onChanged(); onClose();
    } catch (e: any) { toast.error(e?.message || "Не вышло"); }
    finally { setBusy(false); }
  };

  const row = "w-full min-h-12 px-3 rounded-md flex items-center gap-3 text-left bg-surface-4 active:opacity-70 disabled:opacity-50";
  return createPortal(
    <div className="fixed inset-0 z-[80] flex items-end md:items-center md:justify-center" onClick={onClose}>
      <div className="absolute inset-0 bg-black/40" />
      <div className="ui-card relative w-full md:w-[420px] rounded-t-[16px] md:rounded-lg bg-surface-2 p-4 pb-[calc(var(--sab)+20px)] md:pb-4 space-y-2" onClick={(e) => e.stopPropagation()}>
        <div className="md:hidden mx-auto mb-1 h-1 w-9 rounded-full bg-foreground/20" aria-hidden />
        <div className="flex items-center gap-2">
          <ImageIcon className="w-5 h-5 text-primary" />
          <p className="text-h2 flex-1">Обои чата</p>
          <button type="button" onClick={onClose} className="p-1.5 text-subtle" aria-label="Закрыть"><X className="w-4 h-4" /></button>
        </div>
        <p className="text-caption text-subtle">Фото, gif или видео с устройства. Растягиваются на весь экран чата.</p>

        <button type="button" disabled={busy} onClick={() => pick("chat")} className={row}>
          <Users className="w-5 h-5 text-primary shrink-0" />
          <span className="min-w-0 flex-1">
            <span className="block text-body">{isChannel ? "Поставить для канала" : "Поставить для всех"}</span>
            <span className="block text-caption text-subtle">{isChannel ? "Увидят все подписчики" : "Увидит и собеседник"}</span>
          </span>
        </button>
        <button type="button" disabled={busy} onClick={() => pick("me")} className={row}>
          <User className="w-5 h-5 text-primary shrink-0" />
          <span className="min-w-0 flex-1">
            <span className="block text-body">Поставить только для себя</span>
            <span className="block text-caption text-subtle">Поверх общих, у собеседника останутся его</span>
          </span>
        </button>
        {chat.wallpaper && (
          <button type="button" disabled={busy} onClick={() => clear("me", true)} className={row}>
            <EyeOff className="w-5 h-5 text-primary shrink-0" />
            <span className="min-w-0 flex-1"><span className="block text-body">Скрыть обои у себя</span><span className="block text-caption text-subtle">Общие останутся у собеседника</span></span>
          </button>
        )}
        {chat.my_wallpaper && (
          <button type="button" disabled={busy} onClick={() => clear("me")} className={row}>
            <Trash2 className="w-5 h-5 text-primary shrink-0" />
            <span className="min-w-0 flex-1"><span className="block text-body">Убрать свои настройки</span><span className="block text-caption text-subtle">Показывать как у чата</span></span>
          </button>
        )}
        {chat.wallpaper && (
          <button type="button" disabled={busy} onClick={() => clear("chat")} className={row}>
            <Trash2 className="w-5 h-5 text-destructive shrink-0" />
            <span className="min-w-0 flex-1"><span className="block text-body">Убрать обои для всех</span></span>
          </button>
        )}

        <label className="w-full min-h-12 px-3 rounded-md flex items-center gap-3 bg-surface-4">
          <Film className="w-5 h-5 text-primary shrink-0" />
          <span className="min-w-0 flex-1">
            <span className="block text-body">Анимация обоев</span>
            <span className="block text-caption text-subtle">{anim ? "Видео-обои двигаются" : "Вместо видео — неподвижный кадр (экономит батарею)"}</span>
          </span>
          <input type="checkbox" className="w-5 h-5 accent-primary" checked={anim} onChange={(e) => { setAnim(e.target.checked); setSetting("wallpaper_anim", e.target.checked); }} />
        </label>

        {busy && <p className="text-small text-subtle text-center">Загружаю и обрабатываю…</p>}
        <input ref={fileRef} type="file" accept="image/*,video/*,.gif" hidden onChange={(e) => { void onFile(e.target.files?.[0]); e.target.value = ""; }} />
      </div>
    </div>,
    document.body,
  );
};

export default WallpaperSheet;
