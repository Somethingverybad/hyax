import { useEffect, useRef, useState } from "react";
import { Capacitor } from "@capacitor/core";
import { Mic, Square } from "lucide-react";
import { toast } from "sonner";
import ScreenHeader from "@/components/ScreenHeader";
import { getMicSettings, micConstraints, micKey, setMicSettings, type MicSettings } from "@/lib/micSettings";
import { useT } from "@/lib/i18n";

type Device = { id: string; label: string };

/**
 * Настройки → Микрофон: обработка звука в звонках и (в браузере и на
 * компьютере) выбор микрофона с проверкой. Настройки — этого устройства.
 */
const ProfileMicrophone = () => {
  const t = useT();
  const native = Capacitor.isNativePlatform();
  const [s, setS] = useState<MicSettings>(getMicSettings);
  const [devices, setDevices] = useState<Device[] | null>(null);
  const [labelsHidden, setLabelsHidden] = useState(false);
  const [testing, setTesting] = useState(false);
  const [monitor, setMonitor] = useState(false);
  const bar = useRef<HTMLDivElement>(null);

  const save = (patch: Partial<MicSettings>) => setS(setMicSettings(patch));

  // Список микрофонов. Названия браузер отдаёт только после доступа к микрофону.
  const loadDevices = async () => {
    try {
      const all = await navigator.mediaDevices.enumerateDevices();
      const mics = all.filter((d) => d.kind === "audioinput" && d.deviceId !== "default" && d.deviceId !== "communications");
      setLabelsHidden(mics.some((d) => !d.label));
      setDevices(mics.map((d, i) => ({ id: d.deviceId, label: d.label || t("Микрофон {n}", { n: i + 1 }) })));
    } catch { setDevices([]); }
  };
  useEffect(() => {
    if (native || !navigator.mediaDevices?.enumerateDevices) return;
    void loadDevices();
    const md = navigator.mediaDevices;
    const h = () => void loadDevices();
    md.addEventListener?.("devicechange", h);
    return () => md.removeEventListener?.("devicechange", h);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [native]);

  const allowAccess = async () => {
    try {
      const st = await navigator.mediaDevices.getUserMedia({ audio: true });
      st.getTracks().forEach((x) => x.stop());
      await loadDevices();
    } catch { toast.error(t("Нет доступа к микрофону")); }
  };

  // Проверка: уровень с теми же настройками, что в звонке; поменяли настройку —
  // проверка перезапускается с новой. «Слышать себя» — звук прямо в динамик.
  const key = micKey(s);
  useEffect(() => {
    if (!testing) return;
    let stream: MediaStream | null = null;
    let ctx: AudioContext | null = null;
    let raf = 0;
    let stopped = false;
    (async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({ audio: micConstraints(s), video: false });
      } catch {
        toast.error(t("Нет доступа к микрофону"));
        setTesting(false);
        return;
      }
      if (stopped) { stream.getTracks().forEach((x) => x.stop()); return; }
      void loadDevices();
      ctx = new AudioContext();
      const src = ctx.createMediaStreamSource(stream);
      const an = ctx.createAnalyser();
      an.fftSize = 1024;
      src.connect(an);
      if (monitor) src.connect(ctx.destination);
      const buf = new Uint8Array(an.fftSize);
      let shown = 0;
      const tick = () => {
        an.getByteTimeDomainData(buf);
        let peak = 0;
        for (let i = 0; i < buf.length; i++) peak = Math.max(peak, Math.abs(buf[i] - 128));
        shown = Math.max(peak / 128, shown * 0.9);
        if (bar.current) bar.current.style.width = `${Math.min(100, Math.round(Math.sqrt(shown) * 100))}%`;
        raf = requestAnimationFrame(tick);
      };
      tick();
    })();
    return () => {
      stopped = true;
      cancelAnimationFrame(raf);
      stream?.getTracks().forEach((x) => x.stop());
      void ctx?.close().catch(() => {});
      if (bar.current) bar.current.style.width = "0%";
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [testing, key, monitor]);

  const toggles: { k: "noiseSuppression" | "echoCancellation" | "autoGainControl"; label: string; hint: string }[] = [
    { k: "noiseSuppression", label: t("Шумоподавление"), hint: t("Убирает фоновый шум микрофона. Выключите, если голос звучит глухо или нужна музыка") },
    { k: "echoCancellation", label: t("Эхоподавление"), hint: t("Чтобы собеседник не слышал себя из вашего динамика. Выключайте только в наушниках") },
    { k: "autoGainControl", label: t("Автогромкость"), hint: t("Выравнивает громкость голоса. Выключите для музыки или если громкость прыгает") },
  ];

  return (
    <div className="h-screen flex flex-col bg-background">
      <ScreenHeader title={t("Микрофон")} />
      <div className="flex-1 overflow-y-auto px-4 py-4">
        <p className="px-1 pb-2 text-small text-subtle">{t("Обработка звука в звонках")}</p>
        <div className="ui-card rounded-lg bg-surface-2 border border-border divide-y divide-border">
          {toggles.map(({ k, label, hint }) => (
            <label key={k} className="flex items-center gap-3 px-4 py-3 cursor-pointer">
              <span className="flex-1 min-w-0">
                <span className="block text-body">{label}</span>
                <span className="block text-caption text-subtle">{hint}</span>
              </span>
              <input type="checkbox" className="w-5 h-5 accent-primary shrink-0" checked={s[k]} onChange={(e) => save({ [k]: e.target.checked })} aria-label={label} />
            </label>
          ))}
        </div>
        <p className="text-caption text-subtle px-1 mt-3">
          {native
            ? t("Настройки этого устройства, действуют со следующего звонка. Телефон обрабатывает голос и сам, поэтому шум и эхо приглушаются даже с выключенными настройками.")
            : t("Настройки этого устройства. В идущем звонке применяются сразу.")}
        </p>

        {!native && (
          <>
            <p className="px-1 pt-5 pb-2 text-small text-subtle">{t("Микрофон")}</p>
            <div className="ui-card rounded-lg bg-surface-2 border border-border divide-y divide-border">
              <label className="flex items-center gap-3 px-4 py-3">
                <span className="text-body shrink-0">{t("Устройство")}</span>
                <select value={s.deviceId || ""} onChange={(e) => save({ deviceId: e.target.value || null })}
                  className="flex-1 min-w-0 h-9 px-2 rounded-md bg-surface-4 text-body outline-none truncate">
                  <option value="">{t("Как в системе")}</option>
                  {(devices || []).map((d) => <option key={d.id} value={d.id}>{d.label}</option>)}
                  {s.deviceId && devices && !devices.some((d) => d.id === s.deviceId) && <option value={s.deviceId}>{t("Отключён")}</option>}
                </select>
              </label>
              {labelsHidden && (
                <button type="button" onClick={() => void allowAccess()} className="w-full px-4 py-3 text-left text-body text-primary">
                  {t("Разрешить доступ, чтобы увидеть названия микрофонов")}
                </button>
              )}
              <div className="px-4 py-3 space-y-3">
                <div className="flex items-center gap-3">
                  <button type="button" onClick={() => setTesting((v) => !v)}
                    className="h-9 px-3 rounded-md bg-primary text-primary-foreground text-small font-semibold inline-flex items-center gap-1.5 shrink-0">
                    {testing ? <><Square className="w-4 h-4" /> {t("Стоп")}</> : <><Mic className="w-4 h-4" /> {t("Проверить")}</>}
                  </button>
                  <div className="flex-1 h-2 rounded-full bg-surface-4 overflow-hidden" aria-hidden>
                    <div ref={bar} className="h-full w-0 bg-primary transition-[width] duration-75" />
                  </div>
                </div>
                <label className="flex items-center gap-3 cursor-pointer">
                  <input type="checkbox" className="w-5 h-5 accent-primary shrink-0" checked={monitor} onChange={(e) => setMonitor(e.target.checked)} />
                  <span className="text-small">{t("Слышать себя — только в наушниках, иначе засвистит")}</span>
                </label>
              </div>
            </div>
            <p className="text-caption text-subtle px-1 mt-3">{t("Скажите что-нибудь: полоска покажет громкость с текущими настройками. Со «Слышать себя» можно сравнить звук с шумоподавлением и без.")}</p>
          </>
        )}
      </div>
    </div>
  );
};

export default ProfileMicrophone;
