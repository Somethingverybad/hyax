import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Capacitor } from "@capacitor/core";
import { Loader2, MapPin, RotateCw, Settings, X, Copy, ExternalLink } from "lucide-react";
import { toast } from "sonner";
import GeoMap from "./GeoMap";
import { getPosition, GeoError, canOpenAppSettings, openAppSettings, mapLinks, formatCoords, type GeoFix } from "@/lib/geo";
import { openExternal } from "@/lib/linkify";

/** «Геопозиция» из меню вложений: определяем место, показываем карту, отправляем по кнопке. */
export function LocationSheet({ onSend, onClose }: { onSend: (fix: GeoFix) => void; onClose: () => void }) {
  const [fix, setFix] = useState<GeoFix | null>(null);
  const [err, setErr] = useState<GeoError | null>(null);
  const [busy, setBusy] = useState(true);
  const boxRef = useRef<HTMLDivElement>(null);
  const [w, setW] = useState(340);
  const locate = async () => {
    setBusy(true); setErr(null);
    try { setFix(await getPosition()); }
    catch (e) { setErr(e instanceof GeoError ? e : new GeoError("unavailable", "Не удалось определить местоположение")); }
    finally { setBusy(false); }
  };
  useEffect(() => { void locate(); }, []);
  useEffect(() => { if (boxRef.current) setW(boxRef.current.clientWidth); }, []);
  return createPortal(
    <div className="fixed inset-0 z-[70] bg-black/50 flex items-end md:items-center justify-center" onClick={onClose}>
      <div className="w-full md:max-w-md bg-surface-2 rounded-t-xl md:rounded-xl border border-border p-4 pb-[calc(var(--sab)+16px)] md:pb-4"
        onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-2 mb-3">
          <MapPin className="w-5 h-5 text-primary" />
          <span className="text-h2 flex-1">Геопозиция</span>
          <button type="button" onClick={onClose} className="p-1.5 -mr-1.5 text-subtle active:text-foreground" aria-label="Закрыть"><X className="w-5 h-5" /></button>
        </div>
        <div ref={boxRef} className="rounded-lg overflow-hidden border border-border bg-surface-3 h-48 flex items-center justify-center">
          {fix ? <GeoMap lat={fix.lat} lng={fix.lng} width={w} height={192} zoom={16} />
            : busy ? <span className="flex items-center gap-2 text-small text-subtle"><Loader2 className="w-4 h-4 animate-spin" />Определяю местоположение…</span>
            : <span className="px-6 text-center text-small text-subtle">{err?.message}</span>}
        </div>
        {fix && (
          <p className="mt-2 text-caption text-subtle tabular-nums">
            {formatCoords(fix.lat, fix.lng)}{fix.accuracy ? ` · точность ±${Math.round(fix.accuracy)} м` : ""}
          </p>
        )}
        {err?.kind === "denied" && !fix && (
          <p className="mt-2 text-caption text-subtle">
            {canOpenAppSettings() ? "Откройте настройки и включите «Геопозиция» для WhoYaX."
              : Capacitor.getPlatform() === "android" ? "Настройки → Приложения → WhoYaX → Разрешения → Местоположение."
              : "Разрешите доступ к местоположению для этого сайта в настройках браузера."}
          </p>
        )}
        <div className="mt-3 flex gap-2">
          {err?.kind === "denied" && !fix && canOpenAppSettings() ? (
            <button type="button" onClick={openAppSettings}
              className="flex-1 h-11 rounded-md bg-surface-4 text-body font-medium flex items-center justify-center gap-2 active:opacity-80">
              <Settings className="w-4 h-4" />Открыть настройки
            </button>
          ) : (
            <button type="button" onClick={() => void locate()} disabled={busy}
              className="flex-1 h-11 rounded-md bg-surface-4 text-body font-medium flex items-center justify-center gap-2 active:opacity-80 disabled:opacity-50">
              <RotateCw className="w-4 h-4" />{fix ? "Уточнить" : "Ещё раз"}
            </button>
          )}
          <button type="button" onClick={() => fix && onSend(fix)} disabled={!fix || busy}
            className="flex-1 h-11 rounded-md bg-primary text-primary-foreground text-body font-medium active:opacity-90 disabled:opacity-50">
            Отправить
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

/** Геопозиция в ленте: карта; тап — выбор, в каких картах открыть. */
export function GeoCard({ lat, lng }: { lat: number; lng: number }) {
  const [menu, setMenu] = useState(false);
  return (
    <div className="relative">
      <button type="button" onClick={(e) => { e.stopPropagation(); setMenu((v) => !v); }}
        className="block rounded-md overflow-hidden active:opacity-90" aria-label="Открыть геопозицию в картах">
        <GeoMap lat={lat} lng={lng} width={240} height={150} />
      </button>
      <p className="mt-1 text-caption opacity-75 flex items-center gap-1"><MapPin className="w-3.5 h-3.5" />Геопозиция</p>
      {menu && (
        <div className="absolute left-0 top-2 z-20 w-56 bg-surface-1 border border-border rounded-lg overflow-hidden text-foreground shadow-lg" onClick={(e) => e.stopPropagation()}>
          {mapLinks(lat, lng).map((l) => (
            <button key={l.label} type="button" onClick={() => { setMenu(false); openExternal(l.url); }}
              className="w-full flex items-center gap-2 px-3 py-2.5 text-sm text-left active:bg-secondary">
              <ExternalLink className="w-4 h-4 text-primary" />{l.label}
            </button>
          ))}
          <button type="button" onClick={() => { setMenu(false); navigator.clipboard?.writeText(formatCoords(lat, lng)).then(() => toast.success("Координаты скопированы")).catch(() => {}); }}
            className="w-full flex items-center gap-2 px-3 py-2.5 text-sm text-left active:bg-secondary">
            <Copy className="w-4 h-4 text-primary" />Скопировать координаты
          </button>
        </div>
      )}
    </div>
  );
}
