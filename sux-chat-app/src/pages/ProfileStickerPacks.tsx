import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { ChevronRight, Link2, Sticker as StickerIcon } from "lucide-react";
import ScreenHeader from "@/components/ScreenHeader";
import { SettingsCard, SettingsRow } from "@/components/settings";
import { api, mediaUrl } from "@/api/client";

type Pack = { id: string; name: string; stickers_count: number; author?: { username?: string } | null; cover?: string | null };

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
          toast.success(`Набор «${started.name}» добавлен${p.failed ? `, не скачалось: ${p.failed}` : ""}`);
          navigate(`/stp/${started.pack_id}`);
        } catch {
          setProgress(null); setBusy(false); load();
        }
      };
      timer.current = setTimeout(poll, 900);
    } catch (e: any) {
      toast.error(e?.message || "Не удалось импортировать");
      setBusy(false);
    }
  };

  return (
    <div className="h-screen flex flex-col bg-background">
      <ScreenHeader title="Стикерпаки" />
      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-3">
        <p className="px-1 text-small text-subtle flex items-center gap-2"><Link2 className="w-4 h-4" /> Набор из Telegram</p>
        <SettingsCard>
          <div className="px-4 py-3 space-y-2.5">
            <input
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") importPack(); }}
              placeholder="t.me/addstickers/…"
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
              {busy ? "Импортирую…" : "Добавить набор"}
            </button>
            {progress && (
              <div className="space-y-1.5">
                <p className="text-caption text-subtle truncate">
                  «{progress.name}» — {progress.done} из {progress.total || "?"}
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
              Откройте набор в Telegram, нажмите «Поделиться» и вставьте ссылку сюда. Анимированные стикеры станут картинками.
            </p>
          </div>
        </SettingsCard>

        <p className="px-1 pt-2 text-small text-subtle">Мои наборы</p>
        <SettingsCard>
          {packs === null ? (
            <div className="px-4 py-4 text-small text-subtle">Загрузка…</div>
          ) : packs.length === 0 ? (
            <div className="px-4 py-4 text-small text-subtle">Пока пусто. Добавьте набор из Telegram или сохраните чужой по ссылке.</div>
          ) : packs.map((p) => (
            <SettingsRow
              key={p.id}
              leading={
                p.cover
                  ? <img src={mediaUrl(p.cover)} alt="" className="w-9 h-9 rounded-md object-contain shrink-0" />
                  : <StickerIcon className="w-5 h-5 text-primary shrink-0" />
              }
              label={p.name}
              hint={`${p.stickers_count} стикеров${p.author?.username ? ` · ${p.author.username}` : ""}`}
              onClick={() => navigate(`/stp/${p.id}`)}
              trailing={<ChevronRight className="w-4 h-4 text-subtle" />}
            />
          ))}
        </SettingsCard>
      </div>
    </div>
  );
};

export default ProfileStickerPacks;
