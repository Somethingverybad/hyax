import { useEffect, useRef, useState, type MouseEvent } from "react";
import { toast } from "sonner";
import { Hand, Pencil, Utensils, PawPrint, ChevronRight } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { api, type Pet, type PetAction } from "@/api/client";
import { getLang, t } from "@/lib/i18n";
import { bySex, cachedPetOf, forgetPet, moodInfo, peekPack, storePetOf, packText, petDisplayName, profilePose, rememberPet, tapSound, usePetsAvailable, warmPurr, wornAccessories, type PetPack, type PetSex, type PoseName } from "@/lib/pets";
import { readCache } from "@/lib/session-cache";
import { confirmDialog } from "@/lib/confirm";
import Identicon from "@/components/Identicon";
import PetSprite from "./PetSprite";
import CoatSwatches from "./CoatSwatches";

/** Через сколько снова можно ухаживать: «через 5 ч» / «через 20 мин». */
const DOUBLE_TAP = 320; // мс между тапами — «покормить»
// Виды для проверки админом (как SPECIES в chat/pets.py); в магазине — из каталога.

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
  // С прошлого раза — сразу, свежий придёт запросом ниже (lib/pets cachedPetOf).
  const [pet, setPetState] = useState<Pet | null | undefined>(() => cachedPetOf(profileId, own));
  const setPet = (p: Pet | null) => { setPetState(p); storePetOf(profileId, p, own); };
  const [pack, setPack] = useState<PetPack | null>(() => peekPack(cachedPetOf(profileId, own)?.species));
  const [busy, setBusy] = useState(false);
  const [react, setReact] = useState<PoseName | null>(null);
  const [naming, setNaming] = useState(false);
  const [name, setName] = useState("");
  const [, tick] = useState(0);
  const tapAt = useRef(0);
  const tapTimer = useRef<number | null>(null);
  const available = usePetsAvailable();
  const navigate = useNavigate();

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
  useEffect(() => { if (pet) warmPurr(); }, [pet]);

  // Своего питомца нет — «Добавить питомца» ведёт на витрину (стартовые — всем).
  if (pet === null && own && available) {
    return (
      <div className="rounded-lg bg-surface-4 p-4 flex flex-col items-center text-center gap-1.5">
        <span className="w-12 h-12 rounded-full bg-surface-2 grid place-items-center mb-1"><PawPrint className="w-6 h-6 text-primary" /></span>
        <span className="text-body font-medium">{t("Питомца пока нет")}</span>
        <span className="text-caption text-subtle">{t("Выберите, кто будет жить с вами в чатах")}</span>
        <button type="button" onClick={() => navigate("/profile/pets")} className="mt-2 w-full h-11 rounded-md bg-primary text-primary-foreground text-small font-semibold active:opacity-90">
          {t("Добавить питомца")}
        </button>
      </div>
    );
  }
  if (!pet || !available) return null;
  const lang = getLang();
  const title = petDisplayName(pet, pack, lang);
  const mi = moodInfo(pet.mood, pet.sex);
  const pose: PoseName = react ?? profilePose(pet.mood);

  const doCare = async (action: PetAction, quiet = false) => {
    if (busy || !pet.can_care) return false;
    setBusy(true);
    try {
      const r = await api.carePet(pet.id, action);
      setPet(r.pet);
      rememberPet(r.pet);
      onVibe?.(r.vibe);
      if (!quiet) toast.success(action === "feed"
        ? t(bySex(pet.sex, "{name} накормлен — +{n} к вайбу", "{name} накормлена — +{n} к вайбу"), { name: title, n: r.vibe_gain })
        : t(bySex(pet.sex, "{name} доволен — +{n} к вайбу", "{name} довольна — +{n} к вайбу"), { name: title, n: r.vibe_gain }));
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
  // Тап — мурчит, двойной тап — ест. Состояние улучшает раз в сутки (как кнопки);
  // уход «погладить» ждёт DOUBLE_TAP — вдруг это двойной тап и надо «покормить».
  const tapPet = (e: MouseEvent) => {
    const now = e.timeStamp || performance.now(); // время касания, а не обработки
    if (now - tapAt.current < DOUBLE_TAP) {
      tapAt.current = 0;
      if (tapTimer.current) { window.clearTimeout(tapTimer.current); tapTimer.current = null; }
      showReaction("eat", 3000);
      if (pet.can_care) void doCare("feed");
      return;
    }
    tapAt.current = now;
    tapSound(pack);
    showReaction("purr", 2600);
    tapTimer.current = window.setTimeout(() => {
      tapTimer.current = null;
      if (pet.can_care) void doCare("pet", true).then((ok) => { if (ok) toast.success(t(packText(pack, "tap", lang, pet.sex, "{name} мурчит — +1 к вайбу"), { name: title })); });
    }, DOUBLE_TAP);
  };
  const feed = async () => { if (await doCare("feed")) showReaction("eat", 3000); };
  const pat = async () => { tapSound(pack); if (await doCare("pet")) showReaction("purr", 2600); };

  const saveName = async () => {
    const v = name.trim();
    if (!v) return;
    try { const p = await api.updateMyPet({ name: v }); setPet(p); setNaming(false); }
    catch (e) { toast.error((e as Error).message || t("Не получилось")); }
  };
  // Пол, украшения, вид — как окрас: сразу на экране, сервер догоняет.
  const patchLook = async (patch: { sex?: PetSex; accessories?: string[] | null; species?: string }) => {
    const was = pet;
    setPet({ ...pet, ...patch } as typeof pet);
    try { const p = await api.updateMyPet(patch); setPet(p); rememberPet(p); }
    catch (e) { setPet(was); toast.error((e as Error).message || t("Не получилось")); }
  };
  // Украшение: одно на место — надел новое, прежнее с того же места снялось.
  const toggleAcc = (id: string) => {
    if (!pack?.accessories) return;
    const worn = wornAccessories(pack, { sex: pet.sex, acc: pet.accessories });
    const slot = pack.accessories[id]?.slot;
    const next = worn.includes(id) ? worn.filter((x) => x !== id) : [...worn.filter((x) => pack.accessories![x]?.slot !== slot), id];
    void patchLook({ accessories: next });
  };
  // Окрас — сразу на экране, сервер догоняет; не вышло — вернуть прежний.
  const setCoat = async (color: string) => {
    if (color === (pet.color || pack?.defaultCoat)) return;
    const was = pet;
    setPet({ ...pet, color });
    try { const p = await api.updateMyPet({ color }); setPet(p); rememberPet(p); }
    catch (e) { setPet(was); toast.error((e as Error).message || t("Не получилось")); }
  };
  const goHome = async () => {
    try { const p = await api.updateMyPet({ chat_id: null }); setPet(p); rememberPet(p); toast.success(t(bySex(pet.sex, "{name} ушёл домой", "{name} ушла домой"), { name: title })); }
    catch (e) { toast.error((e as Error).message || t("Не получилось")); }
  };
  // Отпустить насовсем — с подтверждением: «{name} будет скучать».
  const release = async () => {
    const msg = t("{name} будет скучать по вам. Удалить питомца насовсем?", { name: title });
    if (!(await confirmDialog(msg, { ok: t("Удалить"), danger: true }))) return;
    try {
      await api.deleteMyPet();
      forgetPet(pet.id);
      setPet(null);
      toast.success(t(bySex(pet.sex, "{name} ушёл. Мы тоже будем скучать", "{name} ушла. Мы тоже будем скучать"), { name: title }));
    } catch (e) { toast.error((e as Error).message || t("Не получилось")); }
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

      <button type="button" onClick={tapPet} style={{ touchAction: "manipulation" }} className="mt-2 mx-auto block select-none active:scale-[0.98] transition-transform"
        aria-label={t("Погладить {name}", { name: title })}>
        <PetSprite species={pet.species} pose={pose} coat={pet.color} sex={pet.sex} acc={pet.accessories} scale={0.62} onPack={setPack} />
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

      {/* Пол: меняет украшения и фразы (позже — и анимации). */}
      {own && pack?.sexes && pack.sexes.length > 1 && (
        <div className="mt-3 flex items-center gap-3">
          <span className="flex-1 text-small">{t("Пол")}</span>
          <div className="flex rounded-md bg-surface-2 p-0.5">
            {pack.sexes.map((sx) => (
              <button key={sx} type="button" onClick={() => { if ((pet.sex || "m") !== sx) void patchLook({ sex: sx, accessories: null }); }} aria-pressed={(pet.sex || "m") === sx}
                className={`h-8 px-3 rounded text-small font-medium ${(pet.sex || "m") === sx ? "bg-primary text-primary-foreground" : "text-subtle"}`}>
                {sx === "f" ? t("Девочка") : t("Мальчик")}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Украшения своего пола: кнопки-переключатели, одно на место (голова, шея…). */}
      {own && pack?.accessories && (() => {
        const sex = pet.sex || "m";
        const list = Object.entries(pack.accessories).filter(([, a]) => !a.sex || a.sex.includes(sex));
        if (!list.length) return null;
        const worn = wornAccessories(pack, { sex: pet.sex, acc: pet.accessories });
        return (
          <div className="mt-3">
            <span className="block text-small mb-2">{t("Украшения")}</span>
            <div className="flex flex-wrap gap-2">
              {list.map(([id, a]) => {
                const on = worn.includes(id);
                return (
                  <button key={id} type="button" onClick={() => toggleAcc(id)} aria-pressed={on}
                    className={`h-8 px-3 rounded-full text-small font-medium ${on ? "bg-primary text-primary-foreground" : "bg-surface-2 text-foreground"}`}>
                    {a.name[lang] || a.name.ru || id}
                  </button>
                );
              })}
            </div>
          </div>
        );
      })()}

      {/* Вид — витрина «Питомцы» сеткой (pages/PetCatalog). */}
      {own && (
        <button type="button" onClick={() => navigate("/profile/pets")}
          className="mt-3 w-full flex items-center gap-3 text-left active:opacity-80">
          <span className="flex-1 text-small">{t("Вид")}</span>
          <span className="text-small text-subtle">{pack ? pack.name[lang] || pack.name.ru : ""}</span>
          <ChevronRight className="w-4 h-4 text-subtle" />
        </button>
      )}

      {/* Окрас: кружки из пака (manifest.coats), видят все. */}
      {own && pack?.coats && Object.keys(pack.coats).length > 1 && (
        <div className="mt-3">
          <span className="block text-small mb-2">{t("Окрас")}</span>
          <CoatSwatches pack={pack} value={pet.color || pack.defaultCoat || ""} onPick={(id) => void setCoat(id)} />
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

      {own && (
        <button type="button" onClick={() => void release()} className="mt-4 w-full h-10 rounded-md text-small font-medium text-destructive active:bg-destructive/10">
          {t("Удалить питомца")}
        </button>
      )}
    </div>
  );
}
