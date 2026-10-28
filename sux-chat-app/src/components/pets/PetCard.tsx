import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Hand, Pencil, Utensils, PawPrint } from "lucide-react";
import { api, type Pet, type PetAction } from "@/api/client";
import { getLang, t } from "@/lib/i18n";
import { moodInfo, petDisplayName, profilePose, purr, rememberPet, usePetsAvailable, type PetPack, type PoseName } from "@/lib/pets";
import Identicon from "@/components/Identicon";
import PetSprite from "./PetSprite";

/** Через сколько снова можно ухаживать: «через 5 ч» / «через 20 мин». */
function untilText(iso: string | null): string {
  if (!iso) return "";
  const ms = new Date(iso).getTime() - Date.now();
  if (ms <= 0) return "";
  const h = Math.floor(ms / 3_600_000);
  return h >= 1 ? t("через {n} ч", { n: h }) : t("через {n} мин", { n: Math.max(1, Math.round(ms / 60_000)) });
}

/**
 * Питомец в профиле. Гость и хозяин: «Покормить» / «Погладить» — одно действие
 * в сутки от человека (+1 к вайбу, chat/pets.py). Тап по питомцу — мурчит;
 * первый тап за сутки — тоже уход («погладить»), дальше только анимация и звук.
 * Хозяин даёт кличку и решает, гулять ли питомцу по его чатам.
 */
export default function PetCard({ profileId, own, onVibe }: { profileId: string; own?: boolean; onVibe?: (vibe: number) => void }) {
  const [pet, setPet] = useState<Pet | null | undefined>(undefined);
  const [pack, setPack] = useState<PetPack | null>(null);
  const [busy, setBusy] = useState(false);
  const [react, setReact] = useState<PoseName | null>(null);
  const [naming, setNaming] = useState(false);
  const [name, setName] = useState("");
  const [, tick] = useState(0);
  const available = usePetsAvailable();

  useEffect(() => {
    if (!available) return;
    let off = false;
    api.getPetOf(profileId).then((p) => { if (!off) setPet(p); }).catch(() => { if (!off) setPet(null); });
    return () => { off = true; };
  }, [profileId, available]);
  // «через N ч» — пересчитать раз в минуту.
  useEffect(() => { const id = setInterval(() => tick((n) => n + 1), 60_000); return () => clearInterval(id); }, []);
  // Своему без клички — сразу предложить назвать.
  useEffect(() => { if (own && pet && !pet.name) setNaming(true); }, [own, pet]);

  if (!pet || !available) return null;
  const lang = getLang();
  const title = petDisplayName(pet, pack, lang);
  const mi = moodInfo(pet.mood);
  const pose: PoseName = react ?? profilePose(pet.mood);

  const doCare = async (action: PetAction, quiet = false) => {
    if (busy || !pet.can_care) return false;
    setBusy(true);
    try {
      const r = await api.carePet(pet.id, action);
      setPet(r.pet);
      rememberPet(r.pet);
      onVibe?.(r.vibe);
      if (!quiet) toast.success(action === "feed" ? t("{name} накормлен — +{n} к вайбу", { name: title, n: r.vibe_gain }) : t("{name} доволен — +{n} к вайбу", { name: title, n: r.vibe_gain }));
      return true;
    } catch (e) {
      const err = e as Error & { pet?: Pet };
      if (err.pet) setPet(err.pet);
      if (!quiet) toast.error(err.message || t("Не получилось"));
      return false;
    } finally { setBusy(false); }
  };

  const showReaction = (p: PoseName, ms: number) => {
    setReact(p);
    window.setTimeout(() => setReact((cur) => (cur === p ? null : cur)), ms);
  };
  // Тап по питомцу: мурчит всегда, а состояние улучшает раз в сутки (как «Погладить»).
  const tapPet = () => {
    purr();
    showReaction("purr", 2600);
    if (pet.can_care) void doCare("pet", true).then((ok) => { if (ok) toast.success(t("{name} мурчит — +1 к вайбу", { name: title })); });
  };
  const feed = async () => { if (await doCare("feed")) showReaction("eat", 3000); };
  const pat = async () => { purr(); if (await doCare("pet")) showReaction("purr", 2600); };

  const saveName = async () => {
    const v = name.trim();
    if (!v) return;
    try { const p = await api.updateMyPet({ name: v }); setPet(p); setNaming(false); }
    catch (e) { toast.error((e as Error).message || t("Не получилось")); }
  };
  const goHome = async () => {
    try { const p = await api.updateMyPet({ chat_id: null }); setPet(p); rememberPet(p); toast.success(t("{name} ушёл домой", { name: title })); }
    catch (e) { toast.error((e as Error).message || t("Не получилось")); }
  };
  const later = untilText(pet.next_care_at);

  return (
    <div className="rounded-lg bg-surface-4 p-4">
      <div className="flex items-center gap-2">
        <PawPrint className="w-4 h-4 text-primary shrink-0" />
        <span className="text-h2 flex-1 truncate">{title}</span>
        {own && !naming && (
          <button type="button" onClick={() => { setName(pet.name); setNaming(true); }} className="p-1 text-subtle" aria-label={t("Переименовать")} title={t("Переименовать")}>
            <Pencil className="w-4 h-4" />
          </button>
        )}
        <span className="px-2 h-6 rounded-full text-caption font-semibold flex items-center"
          style={{ color: mi.color, background: `color-mix(in srgb, ${mi.color} 16%, transparent)` }}>{mi.label}</span>
      </div>

      {naming && own && (
        <div className="mt-3 flex gap-2">
          <input autoFocus value={name} onChange={(e) => setName(e.target.value)} maxLength={40}
            onKeyDown={(e) => { if (e.key === "Enter") void saveName(); if (e.key === "Escape" && pet.name) setNaming(false); }}
            placeholder={t("Как назовёте?")} className="flex-1 min-w-0 h-10 px-3 rounded-md bg-surface-2 outline-none text-body" />
          <button type="button" onClick={() => void saveName()} disabled={!name.trim()}
            className="h-10 px-3 rounded-md bg-primary text-primary-foreground text-small font-medium disabled:opacity-50">{t("Готово")}</button>
        </div>
      )}

      <button type="button" onClick={tapPet} className="mt-2 mx-auto block select-none active:scale-[0.98] transition-transform"
        aria-label={t("Погладить {name}", { name: title })}>
        <PetSprite species={pet.species} pose={pose} scale={0.62} onPack={setPack} />
      </button>

      {/* Шкала состояния */}
      <div className="h-2 rounded-full bg-surface-2" aria-label={t("Состояние: {n}%", { n: pet.level })}>
        <div className="h-full rounded-full transition-[width] duration-500" style={{ width: `${Math.max(3, pet.level)}%`, background: mi.color }} />
      </div>

      <div className="mt-3 grid grid-cols-2 gap-2">
        <button type="button" onClick={() => void feed()} disabled={busy || !pet.can_care}
          className="h-10 rounded-md bg-primary text-primary-foreground text-small font-medium flex items-center justify-center gap-2 active:opacity-90 disabled:opacity-50">
          <Utensils className="w-4 h-4" />{t("Покормить")}
        </button>
        <button type="button" onClick={() => void pat()} disabled={busy || !pet.can_care}
          className="h-10 rounded-md bg-surface-2 text-foreground text-small font-medium flex items-center justify-center gap-2 active:opacity-80 disabled:opacity-50">
          <Hand className="w-4 h-4" />{t("Погладить")}
        </button>
      </div>
      <p className="mt-2 text-caption text-subtle">
        {pet.can_care ? t("Одно действие в сутки — и +1 к вайбу") : later ? t("Сегодня вы уже ухаживали — снова {when}", { when: later }) : t("Сегодня вы уже ухаживали")}
      </p>

      {pet.today.length > 0 && (
        <div className="mt-3 flex items-center gap-2">
          <div className="flex -space-x-2">
            {pet.today.slice(0, 6).map((c) => (
              <div key={c.who.id + c.at} className="w-7 h-7 rounded-full ring-2 ring-surface-4 overflow-hidden" title={c.who.username}>
                <Identicon id={c.who.id} avatarUrl={c.who.avatar_url} className="w-full h-full" />
              </div>
            ))}
          </div>
          <span className="text-caption text-subtle truncate">{t("Сегодня ухаживали: {n}", { n: pet.today.length })}</span>
        </div>
      )}

      {/* Где сейчас: в одном чате (позвать — в меню чата) или дома. */}
      {own && (
        <div className="mt-3 flex items-center gap-3">
          <span className="flex-1 min-w-0">
            <span className="block text-small truncate">{pet.chat ? t("Сейчас в чате: {title}", { title: pet.chat.title || t("Чат") }) : t("Сейчас дома")}</span>
            <span className="block text-caption text-subtle">{pet.chat ? t("Его видят все в этом чате — спит на сообщениях, царапает их, если голоден") : t("Позвать в чат — в меню чата: «Позвать питомца»")}</span>
          </span>
          {pet.chat && (
            <button type="button" onClick={() => void goHome()} className="h-9 px-3 rounded-md bg-surface-2 text-small font-medium shrink-0 active:opacity-80">{t("Домой")}</button>
          )}
        </div>
      )}
    </div>
  );
}
