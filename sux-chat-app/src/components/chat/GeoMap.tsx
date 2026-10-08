import { useMemo } from "react";
import { MapPin } from "lucide-react";
import { useTheme } from "@/lib/theme";
import { PUBLIC_ORIGIN } from "@/lib/share";

/**
 * Статичная карта вокруг точки — мозаика тайлов OpenStreetMap (через наш
 * nginx с кэшем, /tiles/ в nginx/conf.d/sux.conf). Без библиотек
 * и ключей: считаем, какие тайлы закрывают рамку, и ставим их абсолютно.
 * Чёткость на ретине — тайлы следующего масштаба в половину размера. Тёмная
 * тема — фильтр поверх светлых тайлов. Атрибуция OSM обязательна.
 */
const TILE = 128; // экранный размер тайла (сам тайл 256 px — на ретине чётко)

function project(lat: number, lng: number, z: number) {
  const n = TILE * 2 ** z;
  const s = Math.sin((Math.max(-85.05, Math.min(85.05, lat)) * Math.PI) / 180);
  return { x: ((lng + 180) / 360) * n, y: (0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) * n };
}

export default function GeoMap({ lat, lng, width, height, zoom = 15, className }: {
  lat: number; lng: number; width: number; height: number; zoom?: number; className?: string;
}) {
  const dark = useTheme().base === "dark";
  const z = Math.min(19, zoom + 1);
  const tiles = useMemo(() => {
    const c = project(lat, lng, z);
    const left = c.x - width / 2, top = c.y - height / 2;
    const max = 2 ** z;
    const out: { key: string; src: string; x: number; y: number }[] = [];
    for (let tx = Math.floor(left / TILE); tx <= Math.floor((left + width) / TILE); tx++) {
      for (let ty = Math.floor(top / TILE); ty <= Math.floor((top + height) / TILE); ty++) {
        if (ty < 0 || ty >= max) continue;
        const wx = ((tx % max) + max) % max;
        out.push({ key: `${tx}:${ty}`, src: `${PUBLIC_ORIGIN}/tiles/${z}/${wx}/${ty}.png`, x: tx * TILE - left, y: ty * TILE - top });
      }
    }
    return out;
  }, [lat, lng, width, height, z]);
  return (
    <div className={`relative overflow-hidden bg-[#e8e4dc] ${className || ""}`} style={{ width, height }}>
      <div className="absolute inset-0" style={dark ? { filter: "invert(1) hue-rotate(180deg) brightness(0.85) contrast(0.9)" } : undefined}>
        {tiles.map((t) => (
          <img key={t.key} src={t.src} alt="" draggable={false} loading="lazy" referrerPolicy="strict-origin-when-cross-origin"
            className="absolute max-w-none select-none pointer-events-none" style={{ left: t.x, top: t.y, width: TILE, height: TILE }} />
        ))}
      </div>
      <MapPin className="absolute w-9 h-9 text-primary drop-shadow-md" style={{ left: width / 2 - 18, top: height / 2 - 34 }} fill="currentColor" stroke="white" strokeWidth={1.5} />
      <span className="absolute right-1 bottom-0.5 text-[9px] leading-tight text-black/70 bg-white/70 px-1 rounded-sm pointer-events-none">© OpenStreetMap</span>
    </div>
  );
}
