import { t, getLang } from "@/lib/i18n";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Smartphone, Monitor, Globe, Tablet, LogOut } from "lucide-react";
import ScreenHeader from "@/components/ScreenHeader";
import { Button } from "@/components/ui/button";
import { api, type DeviceSession } from "@/api/client";
import { confirmDialog } from "@/lib/confirm";

/**
 * Устройства с действующим входом (backend/chat/devices.py). «Выйти» на чужом
 * устройстве отзывает его токены и шлёт ему команду стереть кэш; «Выйти со
 * всех остальных» гасит и старые входы без паспорта устройства.
 */
const Icon = ({ platform }: { platform: string }) =>
  platform === "ios" || platform === "android" ? <Smartphone className="w-5 h-5" />
  : platform === "desktop" ? <Monitor className="w-5 h-5" />
  : platform === "ipad" ? <Tablet className="w-5 h-5" /> : <Globe className="w-5 h-5" />;

const LOCALE = { ru: "ru-RU", en: "en-US", ko: "ko-KR" } as const;

/** Вызывать только в рендере: фразы и формат даты — на текущем языке. */
const when = (iso: string) => {
  const d = new Date(iso); const diff = (Date.now() - d.getTime()) / 60000;
  if (diff < 2) return t("только что");
  if (diff < 60) return t("{n} мин назад", { n: Math.round(diff) });
  if (diff < 60 * 24) return t("{n} ч назад", { n: Math.round(diff / 60) });
  const loc = LOCALE[getLang()] || "ru-RU";
  return d.toLocaleDateString(loc, { day: "numeric", month: "short" }) + " " + d.toLocaleTimeString(loc, { hour: "2-digit", minute: "2-digit" });
};

/** Имя устройства клиент собирает по-русски («Mac · приложение», «Компьютер ·
 *  браузер») и оно так и лежит на сервере — части переводим при показе. */
const deviceLabel = (d: DeviceSession) => (d.name || d.platform).split(" · ").map((part) => t(part)).join(" · ");

const ProfileDevices = () => {
  const [list, setList] = useState<DeviceSession[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = () => api.listDevices().then((r) => setList(r.devices)).catch(() => { setList([]); toast.error(t("Не удалось загрузить устройства")); });
  useEffect(() => { void load(); }, []);

  const revoke = async (d: DeviceSession) => {
    if (!(await confirmDialog(t("Выйти на устройстве «{name}»? Переписка и кэш там будут стёрты.", { name: deviceLabel(d) }), { ok: t("Выйти") }))) return;
    setBusy(d.device_id);
    try { await api.revokeDevice(d.device_id); setList((l) => (l || []).filter((x) => x.device_id !== d.device_id)); toast.success(t("Сеанс завершён")); }
    catch (e: any) { toast.error(e?.message || t("Не получилось")); }
    finally { setBusy(null); }
  };
  const revokeOthers = async () => {
    if (!(await confirmDialog(t("Выйти со всех устройств, кроме этого? На них сотрётся кэш переписки."), { ok: t("Выйти везде") }))) return;
    setBusy("all");
    try { const r = await api.revokeOtherDevices(); toast.success(r.revoked ? t("Завершено сеансов: {n}", { n: r.revoked }) : t("Других сеансов не было")); void load(); }
    catch (e: any) { toast.error(e?.message || t("Не получилось")); }
    finally { setBusy(null); }
  };

  const current = (list || []).find((d) => d.current);
  const others = (list || []).filter((d) => !d.current);

  return (
    <div className="h-screen flex flex-col bg-background">
      <ScreenHeader title={t("Устройства")} />
      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4">
        {list === null ? <p className="text-center text-small text-subtle py-8">{t("Загрузка…")}</p> : (
          <>
            <div className="ui-card rounded-lg bg-surface-2 border border-border divide-y divide-border">
              <p className="px-4 pt-3 pb-1 text-caption text-subtle">{t("Это устройство")}</p>
              {current ? (
                <div className="flex items-center gap-3 px-4 py-3">
                  <Icon platform={current.platform} />
                  <div className="min-w-0 flex-1">
                    <p className="text-body truncate">{deviceLabel(current)}</p>
                    <p className="text-small text-subtle">WYX {current.app_version} · {t("сейчас")}</p>
                  </div>
                </div>
              ) : (
                <p className="px-4 py-3 text-small text-subtle">{t("Вход сделан до появления списка устройств. Выйдите и войдите снова, чтобы оно здесь появилось.")}</p>
              )}
            </div>

            <div className="ui-card rounded-lg bg-surface-2 border border-border divide-y divide-border">
              <p className="px-4 pt-3 pb-1 text-caption text-subtle">{t("Другие устройства")}</p>
              {others.length === 0 && <p className="px-4 py-3 text-small text-subtle">{t("Других входов нет.")}</p>}
              {others.map((d) => (
                <div key={d.device_id} className="flex items-center gap-3 px-4 py-3">
                  <Icon platform={d.platform} />
                  <div className="min-w-0 flex-1">
                    <p className="text-body truncate">{deviceLabel(d)}</p>
                    <p className="text-small text-subtle">WYX {d.app_version} · {when(d.last_seen)}</p>
                  </div>
                  <button type="button" disabled={busy === d.device_id} onClick={() => revoke(d)}
                    className="shrink-0 h-9 px-3 rounded-md bg-surface-4 text-small font-medium flex items-center gap-1.5 active:opacity-80 disabled:opacity-50">
                    <LogOut className="w-4 h-4" />{t("Выйти")}</button>
                </div>
              ))}
            </div>

            <Button type="button" variant="secondary" className="w-full h-12" disabled={busy === "all"} onClick={revokeOthers}>{t("Выйти со всех остальных устройств")}</Button>
            <p className="text-caption text-subtle px-1">
              {t("На отозванном устройстве приложение само выходит и стирает кэш переписки, ключи секретных чатов и файлы. Если оно офлайн — сделает это при следующем запуске.")}
            </p>
          </>
        )}
      </div>
    </div>
  );
};

export default ProfileDevices;
