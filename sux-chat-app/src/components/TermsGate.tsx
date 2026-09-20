import { useState } from "react";
import { toast } from "sonner";
import { api, type Profile } from "@/api/client";
import { APP_NAME } from "@/lib/brand";
import { LegalView, type LegalKind } from "@/pages/Legal";

/**
 * Экран согласия для тех, кто завёл аккаунт до появления правил (или со
 * старой сборки без галочки). Новые принимают их при регистрации.
 * Показывается, только когда сервер явно прислал terms_accepted_at: null —
 * undefined означает старый сервер, и запирать приложение тогда нельзя.
 */
const TermsGate = ({ onAccepted, onLogout }: { onAccepted: (p: Profile) => void; onLogout: () => void }) => {
  const [busy, setBusy] = useState(false);
  const [legal, setLegal] = useState<LegalKind | null>(null);

  const accept = async () => {
    setBusy(true);
    try { onAccepted(await api.acceptTerms()); }
    catch (e: any) { toast.error(e?.message || "Не получилось"); }
    finally { setBusy(false); }
  };

  if (legal) {
    return (
      <div className="fixed inset-0 z-[70]">
        <LegalView kind={legal} onClose={() => setLegal(null)} />
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-[70] bg-background flex items-center justify-center px-6 pad-safe-top">
      <div className="w-full max-w-sm space-y-4">
        <h1 className="text-[22px] leading-tight font-semibold">Правила {APP_NAME}</h1>
        <p className="text-body text-muted-foreground">
          У нас появились правила и политика конфиденциальности. Коротко: недопустимый контент,
          угрозы и оскорбления запрещены, на любое сообщение или человека можно пожаловаться,
          а нарушителей модераторы блокируют в течение суток.
        </p>
        <p className="text-small text-subtle">
          Полный текст:{" "}
          <button type="button" className="text-primary underline" onClick={() => setLegal("terms")}>правила</button>
          {" "}и{" "}
          <button type="button" className="text-primary underline" onClick={() => setLegal("privacy")}>политика конфиденциальности</button>.
        </p>
        <button
          type="button"
          onClick={accept}
          disabled={busy}
          className="w-full h-12 rounded-md bg-primary text-primary-foreground font-semibold active:opacity-90 disabled:opacity-50"
        >
          {busy ? "Сохраняю…" : "Мне есть 17, принимаю"}
        </button>
        <button type="button" onClick={onLogout} className="w-full h-11 text-body text-subtle active:opacity-60">
          Не принимаю — выйти
        </button>
      </div>
    </div>
  );
};

export default TermsGate;
