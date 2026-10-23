import ScreenHeader from "@/components/ScreenHeader";
import { ReactionGlyph, ReactionGrid, useQuickReaction } from "@/components/chat/Reactions";
import { reactionLabel, setQuickReaction, type ReactionPick } from "@/lib/reactions";
import { useT } from "@/lib/i18n";

/** Профиль → Быстрая реакция: какая реакция ставится двойным тапом по
 *  сообщению. Сетка та же, что в шторке реакций (обычные и свои наборы);
 *  выбор применяется сразу и хранится на устройстве (lib/reactions). */
const ProfileQuickReaction = () => {
  const t = useT();
  const quick = useQuickReaction();
  const pick = (_key: string, p?: ReactionPick) => { if (p) setQuickReaction(p); };
  return (
    <div className="h-screen flex flex-col bg-background">
      <ScreenHeader title={t("Быстрая реакция")} />
      <div className="flex-1 overflow-y-auto px-4 py-4">
        <div className="ui-card rounded-lg bg-surface-2 border border-border px-4 py-3 flex items-center gap-3">
          <span className="w-12 h-12 rounded-full bg-primary/15 flex items-center justify-center shrink-0">
            <ReactionGlyph pick={quick} size={30} />
          </span>
          <div className="min-w-0">
            <div className="text-body">{t("Двойной тап по сообщению")}</div>
            <div className="text-caption text-subtle truncate">{t(reactionLabel(quick)) || quick.emoji}</div>
          </div>
        </div>
        <p className="px-1 pt-5 pb-2 text-small text-subtle">{t("Выберите реакцию")}</p>
        <div className="ui-card rounded-lg bg-surface-2 border border-border p-4">
          <ReactionGrid onPick={pick} selectedKey={quick.key} />
        </div>
        <p className="text-caption text-subtle px-1 mt-3">{t("Второй тап по тому же сообщению ставит её, повторный двойной тап — снимает. Остальные реакции — в меню сообщения.")}</p>
      </div>
    </div>
  );
};

export default ProfileQuickReaction;
