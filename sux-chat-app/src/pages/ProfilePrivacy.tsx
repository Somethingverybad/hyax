import ScreenHeader from "@/components/ScreenHeader";
import { Lock } from "lucide-react";

/**
 * Конфиденциальность. Раздел заведён, но настроек в нём пока нет — экран
 * честно об этом говорит, чтобы строка в профиле не вела в пустоту.
 */
const ProfilePrivacy = () => (
  <div className="h-screen flex flex-col bg-background">
    <ScreenHeader title="Конфиденциальность" />

    <div className="flex-1 overflow-y-auto px-4 py-4">
      <div className="rounded-lg bg-surface-2 border border-border p-6 flex flex-col items-center text-center">
        <span className="w-12 h-12 rounded-full bg-surface-3 flex items-center justify-center">
          <Lock className="w-6 h-6 text-primary" />
        </span>
        <p className="mt-3 text-h2">Пока в разработке</p>
        <p className="mt-1.5 text-small text-subtle max-w-[28rem]">
          Здесь появится управление тем, кто видит твой профиль, обложку и время
          последнего входа, а также чёрный список. Сейчас настройки не меняются.
        </p>
      </div>
    </div>
  </div>
);

export default ProfilePrivacy;
