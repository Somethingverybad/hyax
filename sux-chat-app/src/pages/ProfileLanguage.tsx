import { useState } from "react";
import { Check } from "lucide-react";
import { toast } from "sonner";
import ScreenHeader from "@/components/ScreenHeader";
import { api, type Profile } from "@/api/client";
import { readCache, writeCache } from "@/lib/session-cache";
import { getLang, setLang, LANGS, LANG_NAMES, useT, type Lang } from "@/lib/i18n";

/** Профиль → Язык: список языков с галочкой. Применяется сразу, в профиль —
 *  чтобы переводы знали, на какой язык переводить. */
const ProfileLanguage = () => {
  const t = useT();
  const [cur, setCur] = useState<Lang>(getLang());
  const pick = async (l: Lang) => {
    setCur(l); setLang(l);
    const me = readCache<Profile>("user");
    if (!me?.id) return;
    try { const upd = await api.updateProfile(me.id, { language: l }); writeCache("user", { ...me, ...upd }); }
    catch { toast.error(t("Не удалось сохранить")); }
  };
  return (
    <div className="h-screen flex flex-col bg-background">
      <ScreenHeader title={t("Язык")} />
      <div className="flex-1 overflow-y-auto px-4 py-4">
        <div className="ui-card rounded-lg bg-surface-2 border border-border divide-y divide-border">
          {LANGS.map((l) => (
            <button key={l} type="button" onClick={() => void pick(l)} className="w-full h-14 px-4 flex items-center justify-between text-body active:bg-surface-3">
              <span>{LANG_NAMES[l]}</span>
              {cur === l && <Check className="w-5 h-5 text-primary" />}
            </button>
          ))}
        </div>
        <p className="text-caption text-subtle px-1 mt-3">{t("Язык интерфейса. Поменять можно в профиле.")}</p>
      </div>
    </div>
  );
};

export default ProfileLanguage;
