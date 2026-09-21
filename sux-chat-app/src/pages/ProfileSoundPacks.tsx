import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Music2, Link2, ChevronRight } from "lucide-react";
import { packCover } from "@/lib/packCover";
import { toast } from "sonner";
import ScreenHeader from "@/components/ScreenHeader";
import { SettingsCard, SettingsRow } from "@/components/settings";
import { api, type SoundPackInfo } from "@/api/client";
import { syncNotificationSounds } from "@/lib/notificationSounds";
import { PUBLIC_ORIGIN } from "@/lib/share";

/**
 * Паки звуков, добавленные по ссылке. Базовые и свои здесь не показываем:
 * первые есть у всех, вторые правятся в студии.
 */
const ProfileSoundPacks = () => {
  const navigate = useNavigate();
  const [packs, setPacks] = useState<SoundPackInfo[] | null>(null);
  const [link, setLink] = useState("");

  useEffect(() => { api.listAddedSoundPacks().then(setPacks).catch(() => setPacks([])); }, []);

  const remove = async (p: SoundPackInfo) => {
    try {
      await api.removeSoundPack(p.id);
      setPacks((l) => (l || []).filter((x) => x.id !== p.id));
      toast.success(`«${p.name}» убран`);
      void syncNotificationSounds().catch(() => {});
    } catch (e: any) { toast.error(e?.message || "Не получилось"); }
  };

  /** Вставленная ссылка вида …/sp/<id> — открываем карточку пака. */
  const openLink = () => {
    const m = link.trim().match(/\/sp\/([0-9a-f-]{36})/i);
    if (!m) { toast.error("Нужна ссылка вида " + PUBLIC_ORIGIN + "/sp/…"); return; }
    navigate(`/sp/${m[1]}`);
  };

  return (
    <div className="h-screen flex flex-col bg-background">
      <ScreenHeader title="Паки звуков" />
      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-3">
        <div className="ui-card rounded-lg bg-surface-2 border border-border p-4 space-y-2">
          <p className="text-small text-subtle flex items-center gap-2"><Link2 className="w-4 h-4" /> Добавить по ссылке</p>
          <div className="flex gap-2">
            <input
              value={link}
              onChange={(e) => setLink(e.target.value)}
              placeholder={`${PUBLIC_ORIGIN}/sp/…`}
              className="flex-1 h-10 rounded-md bg-surface-4 border border-transparent px-3 text-body outline-none focus:border-amber"
            />
            <button type="button" onClick={openLink} className="h-10 px-4 rounded-md bg-primary text-primary-foreground font-medium active:opacity-90">Открыть</button>
          </div>
        </div>

        <p className="px-1 text-small text-subtle">Добавленные</p>
        <SettingsCard>
          {packs === null ? (
            <div className="px-4 py-4 text-small text-subtle">Загрузка…</div>
          ) : packs.length === 0 ? (
            <div className="px-4 py-4 text-small text-subtle">Пока ничего. Базовые звуки уже у тебя; чужие паки добавляются по ссылке, которой делится автор.</div>
          ) : packs.map((p) => (
            <SettingsRow
              key={p.id}
              // Обложка вместо значка: своя у пака либо заготовка по теме.
              leading={<img src={packCover(p.cover_url)} alt="" className="ui-card w-9 h-9 rounded-md object-cover shrink-0" />}
              label={p.name}
              hint={`${p.sounds.length} звуков${p.creator ? ` · ${p.creator}` : ""}`}
              onClick={() => navigate(`/sp/${p.id}`)}
              trailing={
                <span className="flex items-center gap-2">
                  <button type="button" onClick={(e) => { e.stopPropagation(); remove(p); }} className="text-small text-primary active:opacity-60">Убрать</button>
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

export default ProfileSoundPacks;
