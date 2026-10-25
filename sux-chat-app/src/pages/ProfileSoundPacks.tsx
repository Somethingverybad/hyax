import { t, tn } from "@/lib/i18n";
import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Link2, ChevronRight, Plus, Share2 } from "lucide-react";
import { packCover } from "@/lib/packCover";
import { toast } from "sonner";
import ScreenHeader from "@/components/ScreenHeader";
import { SettingsCard, SettingsRow, SettingsTitle } from "@/components/settings";
import { api, type SoundPackInfo } from "@/api/client";
import { syncNotificationSounds } from "@/lib/notificationSounds";
import { LINK_ORIGIN, shareSoundPack } from "@/lib/share";

/**
 * Паки звуков: свои (созданные здесь или в студии) — чтобы делиться ими, и
 * добавленные по ссылке. Базовые не показываем — они есть у всех.
 */
const ProfileSoundPacks = () => {
  const navigate = useNavigate();
  const [packs, setPacks] = useState<SoundPackInfo[] | null>(null);
  const [mine, setMine] = useState<SoundPackInfo[] | null>(null);
  const [link, setLink] = useState("");

  useEffect(() => { api.listAddedSoundPacks().then(setPacks).catch(() => setPacks([])); }, []);
  useEffect(() => { api.listMySoundPacks().then(setMine).catch(() => setMine([])); }, []);

  const share = async (p: SoundPackInfo) => {
    const r = await shareSoundPack(p.name, p.id);
    if (r === "copied") toast.success(t("Ссылка скопирована"));
    else if (r === "error") toast.error(t("Не удалось поделиться"));
  };
  const shareBtn = (p: SoundPackInfo) => (
    <button type="button" onClick={(e) => { e.stopPropagation(); void share(p); }} aria-label={t("Поделиться паком")}
      className="w-9 h-9 -my-1 flex items-center justify-center rounded-md text-primary active:bg-surface-3">
      <Share2 className="w-4 h-4" />
    </button>
  );

  const remove = async (p: SoundPackInfo) => {
    try {
      await api.removeSoundPack(p.id);
      setPacks((l) => (l || []).filter((x) => x.id !== p.id));
      toast.success(t("«{name}» убран", { name: p.name }));
      void syncNotificationSounds().catch(() => {});
    } catch (e: any) { toast.error(e?.message || t("Не получилось")); }
  };

  /** Вставленная ссылка вида …/sp/<id> — открываем карточку пака. */
  const openLink = () => {
    const m = link.trim().match(/\/sp\/([0-9a-f-]{36})/i);
    if (!m) { toast.error(t("Нужна ссылка вида {url}", { url: LINK_ORIGIN + "/sp/…" })); return; }
    navigate(`/sp/${m[1]}`);
  };

  return (
    <div className="h-screen flex flex-col bg-background">
      <ScreenHeader title={t("Паки звуков")} />
      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-3">
        <div className="ui-card rounded-lg bg-surface-2 border border-border p-4 space-y-2">
          <p className="text-small text-subtle flex items-center gap-2"><Link2 className="w-4 h-4" /> {t("Добавить по ссылке")}</p>
          <div className="flex gap-2">
            <input
              value={link}
              onChange={(e) => setLink(e.target.value)}
              placeholder={`${LINK_ORIGIN}/sp/…`}
              className="flex-1 h-10 rounded-md bg-surface-4 border border-transparent px-3 text-body outline-none focus:border-amber"
            />
            <button type="button" onClick={openLink} className="h-10 px-4 rounded-md bg-primary text-primary-foreground font-medium active:opacity-90">{t("Открыть")}</button>
          </div>
        </div>

        <button
          type="button"
          onClick={() => navigate("/profile/soundpacks/new")}
          className="w-full h-11 rounded-md bg-primary text-primary-foreground font-semibold flex items-center justify-center gap-2 active:opacity-90"
        >
          <Plus className="w-5 h-5" /> {t("Создать свой пак")}
        </button>

        {mine && mine.length > 0 && (
          <>
            <SettingsTitle>{t("Мои паки")}</SettingsTitle>
            <SettingsCard>
              {mine.map((p) => (
                <SettingsRow
                  key={p.id}
                  leading={<img src={packCover(p.cover_url)} alt="" className="ui-card w-9 h-9 rounded-md object-cover shrink-0" />}
                  label={p.name}
                  hint={`${tn(p.sounds.length, "{n} звук", "{n} звука", "{n} звуков")} · ${t("правка в студии")}`}
                  onClick={() => navigate(`/sp/${p.id}`)}
                  trailing={<span className="flex items-center gap-1">{shareBtn(p)}<ChevronRight className="w-4 h-4 text-subtle" /></span>}
                />
              ))}
            </SettingsCard>
          </>
        )}

        <SettingsTitle>{t("Добавленные")}</SettingsTitle>
        <SettingsCard>
          {packs === null ? (
            <div className="px-4 py-4 text-small text-subtle">{t("Загрузка…")}</div>
          ) : packs.length === 0 ? (
            <div className="px-4 py-4 text-small text-subtle">{t("Пока ничего. Базовые звуки уже у тебя; чужие паки добавляются по ссылке, которой делится автор.")}</div>
          ) : packs.map((p) => (
            <SettingsRow
              key={p.id}
              // Обложка вместо значка: своя у пака либо заготовка по теме.
              leading={<img src={packCover(p.cover_url)} alt="" className="ui-card w-9 h-9 rounded-md object-cover shrink-0" />}
              label={p.name}
              hint={`${tn(p.sounds.length, "{n} звук", "{n} звука", "{n} звуков")}${p.creator ? ` · ${p.creator}` : ""}`}
              onClick={() => navigate(`/sp/${p.id}`)}
              trailing={
                <span className="flex items-center gap-2">
                  {shareBtn(p)}
                  <button type="button" onClick={(e) => { e.stopPropagation(); remove(p); }} className="text-small text-primary active:opacity-60">{t("Убрать")}</button>
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
