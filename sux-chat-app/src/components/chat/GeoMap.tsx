import { useMemo } from "react";
import { MapPin } from "lucide-react";
import { useTheme } from "@/lib/theme";

/**
 * Статичная карта вокруг точки — мозаика тайлов OpenStreetMap в оформлении
 * CARTO (светлая или тёмная под тему). Без библиотек и ключей: считаем, какие
 * тайлы закрывают рамку, и ставим их абсолютно. Атрибуция обязательна.
 */
const TILE = 256;
const SUB = "abcd";

function project(lat: number, lng: number, z: number) {
  const n = TILE * 2 ** z;
  const s = Math.sin((Math.max(-85.05, Math.min(85.05, lat)) * Math.PI) / 180);
  return { x: ((lng + 180) / 360) * n, y: (0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) * n };
}

export default function GeoMap({ lat, lng, width, height, zoom = 15, className }: {
  lat: number; lng: number; width: number; height: number; zoom?: number; className?: string;
}) {
  const dark = useTheme().base === "dark";
  const tiles = useMemo(() => {
    const c = project(lat, lng, zoom);
    const left = c.x - width / 2, top = c.y - height / 2;
    const max = 2 ** zoom;
    const out: { key: string; src: string; x: number; y: number }[] = [];
    for (let tx = Math.floor(left / TILE); tx <= Math.floor((left + width) / TILE); tx++) {
      for (let ty = Math.floor(top / TILE); ty <= Math.floor((top + height) / TILE); ty++) {
        if (ty < 0 || ty >= max) continue;
        const wx = ((tx % max) + max) % max;
        const sub = SUB[(wx + ty) % SUB.length];
        const style = dark ? "dark_all" : "rastertiles/voyager";
        out.push({ key: `${tx}:${ty}`, src: `https://${sub}.basemaps.cartocdn.com/${style}/${zoom}/${wx}/${ty}@2x.png`, x: tx * TILE - left, y: ty * TILE - top });
      }
    }
    return out;
  }, [lat, lng, width, height, zoom, dark]);
  return (
    <div className={`relative overflow-hidden ${dark ? "bg-[#1b1d22]" : "bg-[#e8e4dc]"} ${className || ""}`} style={{ width, height }}>
      {tiles.map((t) => (
        <img key={t.key} src={t.src} alt="" draggable={false} loading="lazy"
          className="absolute max-w-none select-none pointer-events-none" style={{ left: t.x, top: t.y, width: TILE, height: TILE }} />
      ))}
      <MapPin className="absolute w-9 h-9 text-primary drop-shadow-md" style={{ left: width / 2 - 18, top: height / 2 - 34 }} fill="currentColor" stroke="white" strokeWidth={1.5} />
      <span className="absolute right-1 bottom-0.5 text-[9px] leading-tight text-black/60 bg-white/60 px-1 rounded-sm pointer-events-none">© OpenStreetMap · © CARTO</span>
    </div>
  );
}
