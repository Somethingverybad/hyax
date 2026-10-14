import { t } from "@/lib/i18n";
import { useEffect, useRef, useState } from "react";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import { toast } from "sonner";
import QRCode from "qrcode";
import { KeyRound, Smartphone, Send } from "lucide-react";
import ScreenHeader from "@/components/ScreenHeader";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { api } from "@/api/client";
import { PUBLIC_ORIGIN } from "@/lib/share";
import {
  secretSupported, transferKeyPair, transferCode, exportChatKeys, importChatKeys, sealKeys, openKeys,
} from "@/lib/secret";

/**
 * Перенос ключей секретных чатов между своими устройствами
 * (backend/chat/keytransfer.py). «Сюда» — это устройство новое: показывает QR
 * и код, ждёт запечатанные ключи. «Отсюда» — на этом устройстве ключи есть:
 * вводим код (или пришли по QR-ссылке /kt/<id>#<pub>), сверяем код проверки,
 * отправляем. Ключи в открытом виде ни по сети, ни в QR не ходят.
 */
type Session = { id: string; code: string; pub: string; expires_at: string };

const ProfileSecretTransfer = () => {
  const navigate = useNavigate();
  const { id: linkId } = useParams();
  const location = useLocation();
  const linkPub = linkId ? decodeURIComponent((location.hash || "").replace(/^#/, "")) : "";
  // Из секретного чата: ?give=1&chat=<id> — отдать ключ только этого чата;
  // ?receive=1 — сразу показать QR (ключ этого чата на другом устройстве).
  const params = new URLSearchParams(location.search);
  const onlyChat = params.get("chat") || "";
  const autoReceive = params.get("receive") === "1";
  const [mode, setMode] = useState<"pick" | "receive" | "give">(linkId || params.get("give") === "1" ? "give" : "pick");

  // ---- новое устройство ----
  const [session, setSession] = useState<Session | null>(null);
  const [qr, setQr] = useState("");
  const [check, setCheck] = useState("");
  const [expired, setExpired] = useState(false);
  const privRef = useRef<CryptoKey | null>(null);
  const [busy, setBusy] = useState(false);

  const startReceive = async () => {
    if (!secretSupported()) { toast.error("На этом устройстве секретные чаты не поддерживаются"); return; }
    setBusy(true); setExpired(false);
    try {
      const kp = await transferKeyPair();
      privRef.current = kp.priv;
      const s = await api.createKeyTransfer(kp.pub);
      setSession(s);
      setCheck(await transferCode(kp.pub));
      const link = `${PUBLIC_ORIGIN}/kt/${s.id}#${encodeURIComponent(kp.pub)}`;
      setQr(await QRCode.toDataURL(link, { margin: 1, width: 260, errorCorrectionLevel: "M" }));
      setMode("receive");
    } catch (e: any) { toast.error(e?.message || "Не удалось открыть сеанс"); }
    finally { setBusy(false); }
  };

  useEffect(() => { if (autoReceive) void startReceive(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);

  // Опрос: пришли ли ключи. Сеанс живёт 10 минут.
  useEffect(() => {
    if (mode !== "receive" || !session || expired) return;
    let stop = false;
    const tick = async () => {
      if (stop) return;
      if (Date.parse(session.expires_at) < Date.now()) { setExpired(true); return; }
      try {
        const r = await api.pollKeyTransfer(session.id);
        if (r.ready && r.blob && r.old_pub && privRef.current) {
          stop = true;
          if (r.pub && r.pub !== session.pub) { toast.error("Ключ сеанса не совпадает — перенос отменён"); setExpired(true); return; }
          const list = await openKeys(session.id, privRef.current, r.old_pub, r.blob);
          const n = await importChatKeys(list);
          toast.success(n ? `Перенесено секретных чатов: ${n}` : "Ключей для переноса не нашлось");
          navigate("/chat", { replace: true });
          return;
        }
      } catch (e: any) {
        stop = true; setExpired(true); toast.error(e?.message || "Сеанс истёк");
        return;
      }
      setTimeout(tick, 3000);
    };
    const t = setTimeout(tick, 2000);
    return () => { stop = true; clearTimeout(t); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, session, expired]);

  // ---- старое устройство ----
  const [code, setCode] = useState("");
  const [target, setTarget] = useState<Session | null>(null);
  const [targetCheck, setTargetCheck] = useState("");
  const [sent, setSent] = useState<{ n: number; skipped: number } | null>(null);

  const lookup = async (ref: string) => {
    setBusy(true);
    try {
      const s = await api.lookupKeyTransfer(ref);
      if (linkPub && s.pub !== linkPub) throw new Error("Ключ в QR не совпадает с сеансом — перенос отменён");
      setTarget(s);
      setTargetCheck(await transferCode(s.pub));
    } catch (e: any) { toast.error(e?.message || "Сеанс не найден"); }
    finally { setBusy(false); }
  };
  useEffect(() => { if (linkId) void lookup(linkId); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [linkId]);

  const give = async () => {
    if (!target || busy) return;
    setBusy(true);
    try {
      const all = await exportChatKeys();
      const keys = onlyChat ? all.keys.filter((k) => k.chatId === onlyChat) : all.keys;
      const skipped = onlyChat ? (keys.length ? 0 : 1) : all.skipped;
      const kp = await transferKeyPair();
      const blob = await sealKeys(target.id, kp.priv, target.pub, keys);
      await api.sendKeyTransferBlob(target.id, blob, kp.pub, keys.map((k) => k.chatId));
      setSent({ n: keys.length, skipped });
    } catch (e: any) { toast.error(e?.message || "Не удалось отправить ключи"); }
    finally { setBusy(false); }
  };

  const inputCls = "h-12 bg-surface-2 border-transparent rounded-md text-body focus:border-amber focus-visible:ring-0";
  const card = "ui-card rounded-lg bg-surface-2 border border-border p-4 space-y-3";

  return (
    <div className="h-screen flex flex-col bg-background">
      <ScreenHeader title="Перенос секретных чатов" />
      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4">
        {mode === "pick" && (
          <>
            <div className={card}>
              <p className="text-body font-medium flex items-center gap-2"><KeyRound className="w-4 h-4" /> Ключи живут только на устройствах</p>
              <p className="text-small text-subtle">
                Секретный чат читается там, где его создали или приняли. Чтобы продолжить его на другом своём устройстве,
                ключи переносятся запечатанными: сервер видит только шифротекст, а QR и код нужны лишь для проверки.
              </p>
            </div>
            <button type="button" onClick={startReceive} disabled={busy} className={`${card} w-full text-left active:opacity-80`}>
              <p className="text-body font-medium flex items-center gap-2"><Smartphone className="w-4 h-4" /> Получить ключи на это устройство</p>
              <p className="text-small text-subtle">Это устройство новое. Покажем QR и код, которые нужно открыть там, где чаты уже читаются.</p>
            </button>
            <button type="button" onClick={() => setMode("give")} className={`${card} w-full text-left active:opacity-80`}>
              <p className="text-body font-medium flex items-center gap-2"><Send className="w-4 h-4" /> Отправить ключи с этого устройства</p>
              <p className="text-small text-subtle">Здесь чаты читаются. Введите код с нового устройства или отсканируйте его QR камерой телефона.</p>
            </button>
          </>
        )}

        {mode === "receive" && session && (
          <div className={card}>
            {expired ? (
              <>
                <p className="text-body">Сеанс истёк: ключи не пришли за 10 минут.</p>
                <Button type="button" className="w-full h-12" onClick={startReceive} disabled={busy}>Начать заново</Button>
              </>
            ) : (
              <>
                <p className="text-small text-subtle">На устройстве, где секретные чаты читаются: Конфиденциальность → Перенести секретные чаты → «Отправить ключи». Отсканируйте QR камерой телефона или введите код.</p>
                {qr && <img src={qr} alt="QR для переноса" className="mx-auto rounded-lg bg-white p-2" width={260} height={260} />}
                <p className="text-center text-small text-subtle">Код сеанса</p>
                <p className="text-center text-[28px] font-semibold tracking-[0.3em] font-mono">{session.code}</p>
                <p className="text-center text-small text-subtle">Код проверки — должен совпасть на обоих экранах</p>
                <p className="text-center text-xl font-mono tracking-[0.2em]">{check}</p>
                <p className="text-center text-caption text-subtle">Ждём ключи…</p>
              </>
            )}
          </div>
        )}

        {mode === "give" && !target && (
          <form onSubmit={(e) => { e.preventDefault(); void lookup(code); }} className={card}>
            <p className="text-small text-subtle">{onlyChat ? "Переносим ключ этого чата. " : ""}Код сеанса с нового устройства — 6 цифр под его QR. На нём: Конфиденциальность → Перенести секретные чаты → «Получить ключи», или откройте там этот чат.</p>
            <Input inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))} placeholder="000000"
              className={`${inputCls} tracking-[0.3em] text-center text-lg`} />
            <Button type="submit" className="w-full h-12" disabled={busy || code.length < 6}>{busy ? "Ищу…" : "Найти сеанс"}</Button>
          </form>
        )}

        {mode === "give" && target && !sent && (
          <div className={card}>
            <p className="text-small text-subtle">Сверьте код проверки с экраном нового устройства. Если он другой — не отправляйте: кто-то подменил сеанс.</p>
            <p className="text-center text-xl font-mono tracking-[0.2em]">{targetCheck}</p>
            {linkPub && <p className="text-center text-caption text-subtle">Ключ пришёл из QR — совпадение проверено автоматически.</p>}
            <Button type="button" className="w-full h-12" disabled={busy} onClick={give}>{busy ? "Отправляю…" : "Совпадает — отправить ключи"}</Button>
            <button type="button" className="w-full text-small text-subtle py-2" onClick={() => { setTarget(null); setCode(""); if (linkId) navigate("/profile/secret-transfer", { replace: true }); }}>{t("Отмена")}</button>
          </div>
        )}

        {sent && (
          <div className={card}>
            <p className="text-body">{onlyChat ? (sent.n ? "Ключ чата отправлен." : "Ключ этого чата отдать нельзя.") : `Отправлено секретных чатов: ${sent.n}.`}</p>
            {sent.skipped > 0 && <p className="text-small text-subtle">Не перенеслись: {sent.skipped}. Это чаты, созданные до обновления — их ключи устройство отдать не может. Создайте такой чат заново.</p>}
            <p className="text-small text-subtle">Собеседникам ушло сообщение, что вы добавили устройство. Новое устройство подхватит чаты само.</p>
            <Button type="button" className="w-full h-12" onClick={() => navigate(-1)}>{t("Готово")}</Button>
          </div>
        )}
      </div>
    </div>
  );
};

export default ProfileSecretTransfer;
