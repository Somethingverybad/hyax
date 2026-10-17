import { useNavigate } from "react-router-dom";
import { EyeOff } from "lucide-react";
import { t } from "@/lib/i18n";
import { canEnableAdult } from "@/lib/device";

/** Метка «18+» рядом с названием пака. */
export const AdultBadge = () => (
  <span className="ml-2 align-middle inline-block px-1.5 py-0.5 rounded bg-destructive/15 text-destructive text-caption font-semibold">18+</span>
);

/**
 * Заглушка вместо содержимого пака 18+, когда показ выключен: сервер в этом
 * случае не отдаёт ни звуки, ни стикеры, а добавить пак нельзя. На iPhone
 * включить показ негде — там без отсылки к настройкам.
 */
const AdultLock = () => {
  const navigate = useNavigate();
  if (!canEnableAdult()) return (
    <div className="ui-card rounded-lg bg-surface-2 border border-border p-4 space-y-3">
      <p className="text-body font-medium flex items-center gap-2"><EyeOff className="w-4 h-4" /> {t("Пак для взрослых")}</p>
      <p className="text-small text-subtle">{t("Автор или модератор отметил его как пак для взрослых — здесь такие паки не показываются.")}</p>
    </div>
  );
  return (
    <div className="ui-card rounded-lg bg-surface-2 border border-border p-4 space-y-3">
      <p className="text-body font-medium flex items-center gap-2"><EyeOff className="w-4 h-4" /> {t("Пак для взрослых")}</p>
      <p className="text-small text-subtle">
        {t("Автор или модератор пометил его 18+. Чтобы открыть и добавить такой пак, включите «Показывать 18+» в настройках.")}
      </p>
      <button
        type="button"
        onClick={() => navigate("/profile/privacy")}
        className="w-full h-10 rounded-md bg-surface-4 text-small font-medium active:opacity-90"
      >
        {t("Открыть настройки")}
      </button>
    </div>
  );
};

export default AdultLock;
