import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { Music2, Play, Square, Share2, Check, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import ScreenHeader from "@/components/ScreenHeader";
import { SettingsCard } from "@/components/settings";
import { api, mediaUrl, type SoundPackInfo } from "@/api/client";
import { soundPackLink } from "@/lib/share";
import { packCover } from "@/lib/packCover";
import { syncNotificationSounds } from "@/lib/notificationSounds";
import AdultLock, { AdultBadge } from "@/components/AdultLock";

/**
 * Пак звуков по ссылке /sp/<id> — как /u/<ник> для профиля. Отсюда пак
 * добавляют себе; после этого его звуки появляются в пикере «Мой звук».
 * Прослушивание — прямо здесь, чтобы не добавлять кота в мешке.
 */
const SoundPackPage = () => {
  const { id = "" } = useParams();
  const navigate = useNavigate();
  const [pack, setPack] = useState<SoundPackInfo | null | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  const [playing, setPlaying] = useState<string | null>(null);
  const [audio] = useState(() => new Audio());

  useEffect(() => {
    let alive = true;
    api.getSoundPack(id).then((p) => alive && setPack(p)).catch(() => alive && setPack(null));
    return () => { alive = false; audio.pause(); };
  }, [id, audio]);

  useEffect(() => {
    const onEnd = () => setPlaying(null);
    audio.addEventListener("ended", onEnd);
    return () => audio.removeEventListener("ended", onEnd);
  }, [audio]);

  const toggle = (s: { id: string; url: string }) => {
    if (playing === s.id) { audio.pause(); setPlaying(null); return; }
    audio.src = mediaUrl(s.url);
    audio.play().then(() => setPlaying(s.id)).catch(() => toast.error("Не удалось воспроизвести"));
  };

  const act = async () => {
    if (!pack || busy) return;
    setBusy(true);
    try {
      if (pack.added) { await api.removeSoundPack(pack.id); toast.success("Пак убран"); }
      else { await api.addSoundPack(pack.id); toast.success("Пак добавлен — звуки появятся в «Мой звук»"); }
      setPack({ ...pack, added: !pack.added });
      // Каталог изменился — докачиваем/убираем файлы на устройстве.
      void syncNotificationSounds().catch(() => {});
    } catch (e: any) {
      toast.error(e?.message || "Не получилось");
    } finally {
      setBusy(false);
    }
  };

  const share = async () => {
    try { await navigator.clipboard.writeText(soundPackLink(id)); toast.success("Ссылка скопирована"); }
    catch { toast.error("Не удалось скопировать"); }
  };

  return (
    <div className="h-screen flex flex-col bg-background">
      <ScreenHeader
        title="Пак звуков"
        onBack={() => (window.history.length > 1 ? navigate(-1) : navigate("/chat", { replace: true }))}
        right={
          <button type="button" onClick={share} className="w-10 h-10 flex items-center justify-center text-subtle active:opacity-60" aria-label="Поделиться">
            <Share2 className="w-5 h-5" />
          </button>
        }
      />
      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-3">
        {pack === undefined ? (
          <p className="py-10 text-center text-small text-subtle">Загрузка…</p>
        ) : pack === null ? (
          <p className="py-10 text-center text-small text-subtle">Пак не найден или приватный</p>
        ) : (
          <>
            <div className="flex items-center gap-4">
              <span className="ui-card w-16 h-16 rounded-lg bg-surface-3 overflow-hidden shrink-0">
                <img src={packCover(pack.cover_url)} alt="" className="w-full h-full object-cover" />
              </span>
              <div className="min-w-0">
                <p className="text-[22px] leading-tight font-semibold truncate">{pack.name}{pack.is_adult && <AdultBadge />}</p>
                <p className="mt-1 text-small text-subtle truncate">
                  {pack.is_default ? "Стандартный пак" : pack.creator ? `Автор: ${pack.creator}` : "Без автора"} · {pack.sounds_count ?? pack.sounds.length} звуков
                </p>
              </div>
            </div>

            {pack.adult_locked && <AdultLock />}

            {!pack.is_default && !pack.mine && !pack.adult_locked && (
              <button
                type="button"
                onClick={act}
                disabled={busy}
                className={`w-full h-11 rounded-md font-medium flex items-center justify-center gap-2 active:opacity-90 disabled:opacity-50 ${pack.added ? "bg-surface-4 text-foreground" : "bg-primary text-primary-foreground"}`}
              >
                {pack.added ? <><Trash2 className="w-4 h-4" /> Убрать из моих</> : <><Plus className="w-4 h-4" /> Добавить себе</>}
              </button>
            )}
            {pack.mine && <p className="px-1 text-small text-subtle flex items-center gap-1.5"><Check className="w-4 h-4 text-primary" /> Это твой пак — он уже у тебя</p>}
            {pack.is_default && <p className="px-1 text-small text-subtle flex items-center gap-1.5"><Check className="w-4 h-4 text-primary" /> Стандартный пак — он есть у всех</p>}

            {!pack.adult_locked && <SettingsCard>
              {pack.sounds.map((s) => (
                <button key={s.id} type="button" onClick={() => toggle(s)} className="w-full h-12 px-4 flex items-center gap-3 text-left active:bg-surface-3">
                  <span className="w-8 h-8 rounded-full bg-surface-4 flex items-center justify-center shrink-0">
                    {playing === s.id ? <Square className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5" />}
                  </span>
                  <span className="flex-1 text-body truncate">{s.name}</span>
                </button>
              ))}
            </SettingsCard>}
          </>
        )}
      </div>
    </div>
  );
};

export default SoundPackPage;
