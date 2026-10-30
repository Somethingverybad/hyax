import { useEffect, useState } from "react";
import { Navigate, useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { Check } from "lucide-react";
import ScreenHeader from "@/components/ScreenHeader";
import PetSprite from "@/components/pets/PetSprite";
import CoatSwatches from "@/components/pets/CoatSwatches";
import { api, type Pet } from "@/api/client";
import { getLang, t } from "@/lib/i18n";
import { loadPack, PET_KINDS, rememberMyPet, type PetPack, type PetSex } from "@/lib/pets";
import { readCache } from "@/lib/session-cache";
import { cn } from "@/lib/utils";

/**
 * «Питомцы» — витрина видов сеткой, как подарки в Telegram: в каждой карточке
 * живой питомец, имя и сколько окрасов. Нажатие — шторка с крупным питомцем,
 * где можно примерить пол и окрас. Пока экран только для админа (он же
 * заводит питомцев, chat/pets.py); остальных возвращает в профиль.
 */
const PetCatalog = () => {
  const navigate = useNavigate();
  const lang = getLang();
  const me = readCache<{ id?: string; is_admin?: boolean }>("user");
  const admin = !!me?.is_admin;
  const [packs, setPacks] = useState<Record<string, PetPack>>({});
  const [pet, setPet] = useState<Pet | null>(null);
  const [open, setOpen] = useState<string | null>(null);

  useEffect(() => {
    for (const sp of PET_KINDS) loadPack(sp).then((p) => setPacks((m) => ({ ...m, [sp]: p }))).catch(() => {});
    if (me?.id) api.getPetOf(me.id).then(setPet).catch(() => setPet(null));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const name = (p?: PetPack) => (p ? p.name[lang] || p.name.ru : "");

  // Пока витрина только для админа (решение пользователя 30.10): остальным —
  // обратно в профиль, даже если открыли адрес напрямую.
  if (!admin) return <Navigate to="/profile" replace />;

  return (
    <div className="h-screen flex flex-col bg-background nav-rail-pad">
      <ScreenHeader title={t("Питомцы")} />
      <div className="flex-1 overflow-y-auto px-4 pt-3 pb-8">
        <p className="px-1 pb-3 text-small text-subtle">
          {admin ? t("Нажмите на питомца, чтобы примерить пол и окрас и выбрать его.") : t("Все питомцы WYX. Скоро их можно будет завести и подарить.")}
        </p>
        <div className="grid grid-cols-3 gap-2.5">
          {PET_KINDS.map((sp) => {
            const p = packs[sp];
            const mine = pet?.species === sp;
            return (
              <button key={sp} type="button" onClick={() => setOpen(sp)}
                className={cn("relative rounded-[18px] bg-surface-2 pt-2 pb-2.5 flex flex-col items-center gap-1 active:scale-[0.97] transition-transform overflow-hidden",
                  mine && "ring-2 ring-primary")}>
                <span aria-hidden className="absolute inset-x-0 top-0 h-2/3 bg-[radial-gradient(circle_at_50%_60%,hsl(var(--primary)/0.14),transparent_70%)]" />
                {mine && <span className="absolute top-1.5 right-1.5 px-1.5 h-[18px] rounded-full bg-primary text-primary-foreground text-[10px] font-semibold leading-[18px]">{t("Сейчас")}</span>}
                <div className="relative h-[92px] flex items-end justify-center">
                  <PetSprite species={sp} pose="sit" scale={0.38} />
                </div>
                <span className="relative text-small font-semibold truncate max-w-full px-2">{name(p) || "…"}</span>
                {p?.coats && <span className="relative text-[11px] text-subtle">{t("Окрасов: {n}", { n: Object.keys(p.coats).length })}</span>}
              </button>
            );
          })}
        </div>
      </div>
      {open && packs[open] && (
        <PetSheet species={open} pack={packs[open]} pet={pet} admin={admin} onClose={() => setOpen(null)}
          onChosen={(p) => { setPet(p); rememberMyPet(p); setOpen(null); toast.success(t("Теперь у вас {name}", { name: name(packs[open]) })); navigate(-1); }} />
      )}
    </div>
  );
};

/** Шторка вида: крупный питомец мурчит, пол и окрас меняют его на глазах. */
const PetSheet = ({ species, pack, pet, admin, onClose, onChosen }: {
  species: string; pack: PetPack; pet: Pet | null; admin: boolean;
  onClose: () => void; onChosen: (p: Pet) => void;
}) => {
  const lang = getLang();
  const sexes: PetSex[] = pack.sexes?.length ? pack.sexes : ["m"];
  const [sex, setSex] = useState<PetSex>(pet?.species === species && pet.sex && sexes.includes(pet.sex as PetSex) ? (pet.sex as PetSex) : sexes[0]);
  const [coat, setCoat] = useState<string>(pet?.species === species && pet.color ? pet.color : pack.defaultCoat || Object.keys(pack.coats || {})[0] || "");
  const [busy, setBusy] = useState(false);
  const title = pack.name[lang] || pack.name.ru;
  const defaultName = (sex === "f" ? pack.defaultNameBySex?.f : undefined) || pack.defaultName;

  const choose = async () => {
    setBusy(true);
    try {
      // Питомца ещё нет — заводим (пока только админ), затем пол и окрас.
      if (!pet) {
        const me = readCache<{ id?: string }>("user");
        if (!me?.id) throw new Error(t("Не получилось"));
        await api.grantPet(me.id, species);
      }
      // Новый вид — свои украшения: сбрасываем на «по умолчанию для пола».
      onChosen(await api.updateMyPet({ species, sex, color: coat, accessories: null }));
    } catch (e) {
      toast.error((e as Error)?.message || t("Не удалось сохранить"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[80] bg-black/50 flex items-end md:items-center md:justify-center" onClick={onClose}>
      <div className="w-full md:w-[420px] bg-surface-1 rounded-t-[24px] md:rounded-[24px] p-5 pb-[calc(var(--sab,0px)+20px)] md:pb-5 space-y-4" onClick={(e) => e.stopPropagation()}>
        <div className="mx-auto w-10 h-1 rounded-full bg-foreground/20 md:hidden" aria-hidden />
        <div className="relative h-[190px] rounded-[20px] bg-surface-2 flex items-end justify-center overflow-hidden">
          <span aria-hidden className="absolute inset-0 bg-[radial-gradient(circle_at_50%_65%,hsl(var(--primary)/0.18),transparent_65%)]" />
          <div className="relative pb-2"><PetSprite key={`${sex}-${coat}`} species={species} pose="purr" sex={sex} coat={coat} scale={0.72} /></div>
        </div>
        <div className="text-center">
          <p className="text-h2 font-semibold">{title}</p>
          <p className="text-small text-subtle">{t("Зовут по умолчанию: {name}", { name: defaultName?.[lang] || defaultName?.ru || title })}</p>
        </div>
        {sexes.length > 1 && (
          <div className="flex rounded-md bg-surface-2 p-0.5">
            {sexes.map((s) => (
              <button key={s} type="button" onClick={() => setSex(s)} aria-pressed={sex === s}
                className={cn("flex-1 h-9 rounded text-small font-medium", sex === s ? "bg-primary text-primary-foreground" : "text-subtle")}>
                {s === "f" ? t("Девочка") : t("Мальчик")}
              </button>
            ))}
          </div>
        )}
        {pack.coats && Object.keys(pack.coats).length > 1 && (
          <CoatSwatches pack={pack} value={coat} onPick={setCoat} />
        )}
        {admin ? (
          <button type="button" disabled={busy} onClick={() => void choose()}
            className="w-full h-12 rounded-md bg-primary text-primary-foreground font-semibold flex items-center justify-center gap-2 disabled:opacity-60 active:opacity-90">
            <Check className="w-5 h-5" />{!pet ? t("Завести") : pet.species === species ? t("Сохранить пол и окрас") : t("Выбрать")}
          </button>
        ) : (
          <p className="text-center text-caption text-subtle">{t("Завести такого питомца пока нельзя — скоро")}</p>
        )}
      </div>
    </div>
  );
};

export default PetCatalog;
