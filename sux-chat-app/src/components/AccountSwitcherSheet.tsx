import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Check, LogOut, Sparkles, UserPlus, X } from "lucide-react";
import { toast } from "sonner";
import {
  ACCOUNT_SWITCHER_EVENT,
  MAX_ACCOUNTS,
  logoutAccount,
  switchAccount,
  useAccounts,
  type StoredAccount,
} from "@/lib/accounts";
import { confirmDialog } from "@/lib/confirm";
import { useEscape } from "@/lib/escape";
import { useT } from "@/lib/i18n";
import { useMint } from "@/themes/mint";
import Identicon from "@/components/Identicon";
import { Aura } from "@/components/Aura";
import { cn } from "@/lib/utils";

/**
 * Шторка/диалог быстрого переключения аккаунтов.
 * Живёт в App.tsx и открывается из любого места через openAccountSwitcher()
 * (шапка списка чатов, долгое нажатие на вкладку профиля, экран Профиля).
 */
const AccountSwitcherSheet = () => {
  const t = useT();
  const mint = useMint();
  const navigate = useNavigate();
  const { accounts, activeId, hasPremium, canAdd } = useAccounts();
  const [open, setOpen] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);

  useEffect(() => {
    const onOpen = () => setOpen(true);
    window.addEventListener(ACCOUNT_SWITCHER_EVENT, onOpen);
    return () => window.removeEventListener(ACCOUNT_SWITCHER_EVENT, onOpen);
  }, []);

  useEscape(open, () => setOpen(false));

  if (!open) return null;

  const handleSelect = async (acc: StoredAccount) => {
    if (busyId) return;
    if (acc.id === activeId) {
      setOpen(false);
      return;
    }
    setBusyId(acc.id);
    try {
      setOpen(false);
      await switchAccount(acc.id);
      toast.success(t("Переключено на {name}", { name: acc.username }));
    } finally {
      setBusyId(null);
    }
  };

  const handleLogout = async (e: React.MouseEvent, acc: StoredAccount) => {
    e.stopPropagation();
    if (busyId) return;
    const ok = await confirmDialog(
      t("Выйти из аккаунта «{name}»? Ключи секретных чатов и локальный кэш этого аккаунта будут удалены.", { name: acc.username }),
      { ok: t("Выйти") },
    );
    if (!ok) return;
    setBusyId(acc.id);
    try {
      const wasActive = acc.id === activeId;
      const res = await logoutAccount(acc.id);
      if (wasActive) {
        setOpen(false);
        if (res.switchedTo) {
          toast(t("Переключено на {name}", { name: res.switchedTo.username }));
        } else {
          navigate("/auth", { replace: true });
        }
      } else {
        toast.success(t("Вышли из аккаунта {name}", { name: acc.username }));
      }
    } finally {
      setBusyId(null);
    }
  };

  const handleAdd = () => {
    setOpen(false);
    navigate("/auth?add=1");
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-end md:items-center justify-center bg-black/45 backdrop-blur-[2px] animate-in fade-in duration-150"
      role="dialog"
      aria-modal="true"
      aria-label={t("Аккаунты")}
      onClick={() => setOpen(false)}
    >
      <div
        className={cn(
          "w-full md:max-w-sm overflow-hidden shadow-2xl",
          mint
            ? "mint-card rounded-t-[24px] md:rounded-[24px] border border-border/40"
            : "bg-surface-2 rounded-t-2xl md:rounded-2xl border border-border",
        )}
        style={{ paddingBottom: "max(12px, var(--sab, 0px))" }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-4 pt-4 pb-2.5 border-b border-border/60">
          <div className="min-w-0">
            <h2 className="text-h2 font-semibold truncate">{t("Аккаунты")}</h2>
            <p className="text-caption text-subtle">
              {accounts.length > 1
                ? t("Пуши приходят на активный аккаунт")
                : hasPremium
                  ? t("Можно добавить до {n} аккаунтов", { n: MAX_ACCOUNTS })
                  : t("Больше одного аккаунта доступно с Premium")}
            </p>
          </div>
          <button
            type="button"
            onClick={() => setOpen(false)}
            className="w-9 h-9 -mr-1 rounded-full flex items-center justify-center text-subtle active:bg-surface-3"
            aria-label={t("Закрыть")}
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="max-h-[60vh] overflow-y-auto divide-y divide-border/50">
          {accounts.map((acc) => {
            const isActive = acc.id === activeId;
            return (
              <div
                key={acc.id}
                role="button"
                tabIndex={0}
                onClick={() => void handleSelect(acc)}
                onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); void handleSelect(acc); } }}
                className={cn(
                  "w-full px-4 py-3 flex items-center gap-3 cursor-pointer transition-colors",
                  isActive ? "bg-primary/5" : "hover:bg-surface-3/60 active:bg-surface-3",
                  busyId === acc.id && "opacity-60 pointer-events-none",
                )}
              >
                <Aura active={isActive} owner={acc} size={42}>
                  <Identicon id={acc.id} avatarUrl={acc.avatar_url} className="w-10 h-10" />
                </Aura>
                <div className="min-w-0 flex-1 text-left">
                  <p className="text-body font-medium truncate">{acc.username || "…"}</p>
                  <p className="text-caption text-subtle truncate">
                    {isActive ? t("Активный аккаунт") : `@${acc.username}`}
                  </p>
                </div>
                {isActive && (
                  <span className="w-7 h-7 rounded-full bg-primary/15 text-primary flex items-center justify-center shrink-0" aria-label={t("Активный аккаунт")}>
                    <Check className="w-4 h-4" />
                  </span>
                )}
                <button
                  type="button"
                  onClick={(e) => void handleLogout(e, acc)}
                  disabled={!!busyId}
                  className="w-9 h-9 rounded-full flex items-center justify-center text-subtle hover:text-destructive active:bg-destructive/10 shrink-0"
                  aria-label={t("Выйти из аккаунта {name}", { name: acc.username })}
                  title={t("Выйти")}
                >
                  <LogOut className="w-4 h-4" />
                </button>
              </div>
            );
          })}
        </div>

        <div className="px-4 pt-3 pb-1 border-t border-border/60">
          {canAdd ? (
            <button
              type="button"
              onClick={handleAdd}
              className={cn(
                "w-full h-11 rounded-xl font-medium text-body flex items-center justify-center gap-2 transition-opacity active:opacity-80",
                mint ? "mint-dark-pill" : "bg-primary text-primary-foreground",
              )}
            >
              <UserPlus className="w-4 h-4" />
              <span>{t("Добавить аккаунт")}</span>
            </button>
          ) : !hasPremium ? (
            <div className="rounded-xl bg-primary/10 px-3.5 py-2.5 flex items-center gap-2.5 text-small text-foreground">
              <Sparkles className="w-4 h-4 text-primary shrink-0" />
              <span>{t("Больше одного аккаунта доступно с Premium")}</span>
            </div>
          ) : (
            <p className="text-center text-caption text-subtle py-2">
              {t("Достигнут лимит аккаунтов ({n})", { n: MAX_ACCOUNTS })}
            </p>
          )}
        </div>
      </div>
    </div>
  );
};

export default AccountSwitcherSheet;
