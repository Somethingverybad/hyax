import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Capacitor } from "@capacitor/core";
import { App } from "@capacitor/app";
import { Bug, Camera, FileText, X } from "lucide-react";
import { toast } from "sonner";
import ScreenHeader from "@/components/ScreenHeader";
import { api } from "@/api/client";
import { compressImage } from "@/lib/compressImage";
import { dumpLog } from "@/lib/applog";
import { APP_VERSION, APP_BUILD } from "@/lib/appVersion";

/**
 * «Сообщить о проблеме»: описание, скриншот и лог текущей сессии одним
 * письмом. Лог собирается автоматически и показывается пользователю до
 * отправки — он должен видеть, что именно уезжает, и иметь возможность
 * отправить без него.
 */
const ProfileBugReport = () => {
  const navigate = useNavigate();
  const fileRef = useRef<HTMLInputElement>(null);
  const [text, setText] = useState("");
  const [shot, setShot] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [withLog, setWithLog] = useState(true);
  const [logOpen, setLogOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [nativeBuild, setNativeBuild] = useState<string | null>(null);

  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return;
    App.getInfo().then((i) => setNativeBuild(i.build)).catch(() => {});
  }, []);

  useEffect(() => {
    if (!shot) { setPreview(null); return; }
    const url = URL.createObjectURL(shot);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [shot]);

  const pick = async (f: File | null) => {
    if (!f) return;
    try {
      // Скриншот телефона — несколько мегабайт; для разбора хватит 1600 px.
      setShot(await compressImage(f, 1600, 0.85));
    } catch {
      setShot(f);
    } finally {
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  const log = withLog ? dumpLog() : "";
  const logLines = log ? log.split("\n").length : 0;

  const send = async () => {
    if (busy) return;
    if (!text.trim() && !shot) { toast.error("Опиши проблему или приложи скриншот"); return; }
    setBusy(true);
    try {
      const fd = new FormData();
      fd.append("description", text.trim());
      if (shot) fd.append("screenshot", shot, shot.name || "screenshot.jpg");
      if (withLog) fd.append("log", log);
      fd.append("meta", JSON.stringify({
        platform: Capacitor.getPlatform(),
        app_version: APP_VERSION,
        app_build: APP_BUILD,
        native_build: nativeBuild,
        device: navigator.userAgent,
        screen: `${window.innerWidth}×${window.innerHeight} @${window.devicePixelRatio}`,
        lang: navigator.language,
        online: navigator.onLine,
      }));
      await api.sendBugReport(fd);
      toast.success("Спасибо, репорт ушёл");
      navigate(-1);
    } catch (e: any) {
      toast.error(e?.message || "Не удалось отправить");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="h-screen flex flex-col bg-background">
      <ScreenHeader
        title="Сообщить о проблеме"
        right={
          <button type="button" onClick={send} disabled={busy} className="px-2 h-10 text-body font-medium text-primary active:opacity-60 disabled:opacity-40">
            {busy ? "Отправляю…" : "Отправить"}
          </button>
        }
      />

      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-3">
        <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={(e) => pick(e.target.files?.[0] || null)} />

        <div className="ui-card rounded-lg bg-surface-2 border border-border p-4 space-y-1.5">
          <label className="text-small text-subtle" htmlFor="bug-text">Что случилось</label>
          <textarea
            id="bug-text"
            value={text}
            onChange={(e) => setText(e.target.value.slice(0, 4000))}
            rows={5}
            placeholder="Что делал, что ожидал, что произошло"
            className="w-full rounded-md bg-surface-4 border border-transparent px-3 py-2 text-body outline-none resize-none focus:border-amber"
          />
        </div>

        <div className="ui-card rounded-lg bg-surface-2 border border-border p-4">
          <p className="text-small text-subtle mb-2">Скриншот</p>
          {preview ? (
            <div className="relative inline-block">
              <img src={preview} alt="" className="max-h-64 rounded-md border border-border" />
              <button type="button" onClick={() => setShot(null)} className="absolute -top-2 -right-2 w-7 h-7 rounded-full bg-black/60 text-white flex items-center justify-center" aria-label="Убрать скриншот">
                <X className="w-4 h-4" />
              </button>
            </div>
          ) : (
            <button type="button" onClick={() => fileRef.current?.click()} className="w-full h-24 rounded-md bg-surface-4 border border-dashed border-border flex flex-col items-center justify-center gap-1 text-small text-subtle active:opacity-80">
              <Camera className="w-5 h-5" />
              Выбрать из галереи
            </button>
          )}
        </div>

        <div className="ui-card rounded-lg bg-surface-2 border border-border">
          <label className="min-h-14 px-4 py-2.5 flex items-center gap-3">
            <FileText className="w-5 h-5 text-primary shrink-0" />
            <span className="min-w-0 flex-1">
              <span className="block text-body">Приложить лог приложения</span>
              <span className="block text-caption text-subtle truncate">
                {withLog ? `${logLines} строк за эту сессию · без текстов сообщений и паролей` : "Без лога разобраться сложнее"}
              </span>
            </span>
            <input type="checkbox" className="w-5 h-5 accent-primary shrink-0" checked={withLog} onChange={(e) => setWithLog(e.target.checked)} />
          </label>
          {withLog && (
            <button type="button" onClick={() => setLogOpen((v) => !v)} className="w-full h-11 px-4 border-t border-border flex items-center text-small text-subtle active:bg-surface-3">
              {logOpen ? "Скрыть лог" : "Посмотреть, что уйдёт"}
            </button>
          )}
          {withLog && logOpen && (
            <pre className="px-4 py-3 border-t border-border text-[11px] leading-[14px] text-muted-foreground whitespace-pre-wrap break-all max-h-72 overflow-y-auto select-text">
              {log || "(пока пусто)"}
            </pre>
          )}
        </div>

        <p className="px-1 text-caption text-subtle flex gap-2">
          <Bug className="w-4 h-4 shrink-0" />
          Репорт увидят только разработчики. Вместе с ним уходят версия {APP_VERSION} (сборка {APP_BUILD}{nativeBuild && nativeBuild !== APP_BUILD ? `, ${nativeBuild}` : ""}), платформа и модель устройства.
        </p>
      </div>
    </div>
  );
};

export default ProfileBugReport;
