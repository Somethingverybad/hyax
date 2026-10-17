import { t, tn } from "@/lib/i18n";
import { confirmDialog } from "@/lib/confirm";
import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { shareEmojiPack, shareStickerPack } from "@/lib/share";
import { readCache } from "@/lib/session-cache";
import { ChevronRight, Link2, Sticker as StickerIcon, Share2, Trash2 } from "lucide-react";
import ScreenHeader from "@/components/ScreenHeader";
import { SettingsCard, SettingsRow } from "@/components/settings";
import { api, mediaUrl } from "@/api/client";

type Pack = { id: string; name: string; stickers_count: number; author?: { id?: string; username?: string } | null; cover?: string | null; kind?: string };

/**
 * Стикерпаки: свои и сохранённые, плюс импорт набора из Telegram по ссылке.
 * Раньше импорт был только в студии на сайте — с телефона это значило уйти в
 * браузер и заново войти.
 */
const ProfileStickerPacks = () => {
  const navigate = useNavigate();
  const [packs, setPacks] = useState<Pack[] | null>(null);
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<{ name: string; done: number; total: number } | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const load = () => {
    api.getMyStickerPacks()
      .then((rows) => setPacks((rows || []).map((r: any) => r.pack || r)))
      .catch(() => setPacks([]));
  };
  useEffect(() => { load(); return () => clearTimeout(timer.current); }, []);

  const importPack = async () => {
    const link = url.trim();
    if (!link || busy) return;
    setBusy(true);
    try {
      const started = await api.importTelegramStickers(link);
      setUrl("");
      setProgress({ name: started.name, done: started.done || 0, total: started.total || 0 });
      // Стикеры качаются на сервере пачкой: опрашиваем, пока не закончит.
      const poll = async () => {
        try {
          const p = await api.telegramImportProgress(started.pack_id);
          setProgress({ name: started.name, done: p.done || 0, total: p.total || 0 });
          if (!p.finished) { timer.current = setTimeout(poll, 900); return; }
          setProgress(null);
          setBusy(false);
          load();
          toast.success(p.failed
            ? t("Набор «{name}» добавлен, не скачалось: {failed}", { name: started.name, failed: p.failed })
            : started.kind === "emoji"
              ? t("Набор эмодзи «{name}» добавлен — он во вкладке «Эмодзи» панели стикеров", { name: started.name })
              : t("Набор «{name}» добавлен", { name: started.name }));
          navigate(`/stp/${started.pack_id}`);
        } catch {
          setProgress(null); setBusy(false); load();
        }
      };
      timer.current = setTimeout(poll, 900);
    } catch (e: any) {
      toast.error(e?.message || t("Не удалось импортировать"));
      setBusy(false);
    }
  };

  const meId = readCache<{ id: string }>("user")?.id;
  const isMine = (p: { author?: { id?: string } | null }) => !!meId && p.author?.id === meId;
  const sharePack = async (p: { id: string; name: string; kind?: string }) => {
    const r = await (p.kind === "emoji" ? shareEmojiPack : shareStickerPack)(p.name, p.id);
    if (r === "copied") toast.success(t("Ссылка скопирована"));
    else if (r === "error") toast.error(t("Не удалось поделиться"));
  };
  /** Свой набор — удалить у всех; чужой — убрать из моих. */
  const removePack = async (p: { id: string; name: string; author?: { id?: string } | null }) => {
    const mine = isMine(p);
    if (!(await confirmDialog(mine ? t("Удалить набор «{name}» у всех, кто его сохранил? Это необратимо.", { name: p.name }) : t("Убрать «{name}» из моих наборов?", { name: p.name })))) return;
    try {
      if (mine) await api.deleteStickerPack(p.id); else await api.unsaveStickerPack(p.id);
      setPacks((prev) => (prev || []).filter((x) => x.id !== p.id));
      toast.success(mine ? t("Набор удалён") : t("Убрано из моих"));
    } catch (e: any) { toast.error(e?.message || t("Не получилось")); }
  };

  return (
    <div className="h-screen flex flex-col bg-background">
      <ScreenHeader title={t("Стикерпаки")} />
      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-3">
        <p className="px-1 text-small text-subtle flex items-center gap-2"><Link2 className="w-4 h-4" /> {t("Набор по ссылке")}</p>
        <SettingsCard>
          <div className="px-4 py-3 space-y-2.5">
            <input
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") importPack(); }}
              placeholder={t("Ссылка на набор стикеров или эмодзи")}
              autoCapitalize="off"
              autoCorrect="off"
              spellCheck={false}
              className="w-full h-11 px-3 rounded-md bg-surface-3 border border-border text-body outline-none focus:border-amber"
            />
            <button
              type="button"
              onClick={importPack}
              disabled={!url.trim() || busy}
              className="w-full h-11 rounded-md bg-primary text-primary-foreground font-semibold disabled:opacity-40"
            >
              {busy ? t("Импортирую…") : t("Добавить набор")}
            </button>
            {progress && (
              <div className="space-y-1.5">
                <p className="text-caption text-subtle truncate">
                  {t("«{name}» — {done} из {total}", { name: progress.name, done: progress.done, total: progress.total || "?" })}
                </p>
                <div className="h-1.5 rounded-full bg-surface-4 overflow-hidden">
                  <div
                    className="h-full bg-primary transition-[width] duration-300"
                    style={{ width: `${progress.total ? Math.round((progress.done / progress.total) * 100) : 5}%` }}
                  />
                </div>
              </div>
            )}
            <p className="text-caption text-subtle">
              {t("Вставьте ссылку на набор стикеров или эмодзи — он появится в ваших наборах: стикеры — в панели стикеров, эмодзи — во вкладке «Эмодзи». Анимированные тоже играют.")}
            </p>
          </div>
        </SettingsCard>

        <p className="px-1 pt-2 text-small text-subtle">{t("Мои наборы")}</p>
        <SettingsCard>
          {packs === null ? (
            <div className="px-4 py-4 text-small text-subtle">{t("Загрузка…")}</div>
          ) : packs.length === 0 ? (
            <div className="px-4 py-4 text-small text-subtle">{t("Пока пусто. Добавьте набор по ссылке или сохраните чужой.")}</div>
          ) : packs.map((p) => (
            <SettingsRow
              key={p.id}
              leading={
                p.cover
                  ? <img src={mediaUrl(p.cover)} alt="" className="w-9 h-9 rounded-md object-contain shrink-0" />
                  : <StickerIcon className="w-5 h-5 text-primary shrink-0" />
              }
              label={p.name}
              hint={`${(p.kind === "emoji" ? tn(p.stickers_count, "{n} эмодзи", "{n} эмодзи", "{n} эмодзи") : tn(p.stickers_count, "{n} стикер", "{n} стикера", "{n} стикеров"))}${p.author?.username ? ` · ${p.author.username}` : ""}`}
              onClick={() => navigate(`/stp/${p.id}`)}
              trailing={
                <span className="flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
                  <button type="button" aria-label={t("Поделиться набором")} onClick={() => void sharePack(p)}
                    className="w-9 h-9 rounded-full flex items-center justify-center text-subtle active:bg-surface-4">
                    <Share2 className="w-4 h-4" />
                  </button>
                  <button type="button" aria-label={isMine(p) ? t("Удалить набор") : t("Убрать из моих")} onClick={() => void removePack(p)}
                    className="w-9 h-9 rounded-full flex items-center justify-center text-subtle active:bg-surface-4 active:text-destructive">
                    <Trash2 className="w-4 h-4" />
                  </button>
                  <ChevronRight className="w-4 h-4 text-subtle" />
                </span>
              }
            />
          ))}
        </SettingsCard>
      </div>
    </div>
  );
};

export default ProfileStickerPacks;
