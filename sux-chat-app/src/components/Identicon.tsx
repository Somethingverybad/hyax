import { mediaUrl } from "@/api/client";

/**
 * Аватар пользователя. Если фото нет — геометрическая фигура в духе
 * супрематизма, детерминированно выведенная из id: хеш выбирает фигуру и
 * цвет, поэтому «выданная» комбинация закреплена за пользователем навсегда
 * и одинакова на всех устройствах — без хранения и синхронизации.
 */

// Плоские цвета фигур — из референсов: красный, зелёный, синий, белый, охра.
const PALETTE = [
  "#bc1c15", // красный
  "#299248", // зелёный
  "#f2f2f2", // белый
  "#d97b19", // охра
  "#244cb6", // синий
  "#8a8a8a", // серый
];

type Shape = "square" | "circle" | "triangle" | "diamond" | "bar" | "cross";
const SHAPES: Shape[] = ["square", "circle", "triangle", "diamond", "bar", "cross"];

function hash(str: string): number {
  let h = 5381;
  for (let i = 0; i < str.length; i++) h = ((h << 5) + h + str.charCodeAt(i)) >>> 0;
  return h;
}

function ShapeSvg({ shape, color }: { shape: Shape; color: string }) {
  // Фигура занимает ~55% плитки и слегка повёрнута — как элемент композиции,
  // а не иконка по центру.
  const common = { fill: color } as const;
  switch (shape) {
    case "circle":
      return <circle cx="50" cy="48" r="26" {...common} />;
    case "triangle":
      return <polygon points="50,22 78,72 22,72" {...common} />;
    case "diamond":
      return <rect x="30" y="30" width="40" height="40" transform="rotate(45 50 50)" {...common} />;
    case "bar":
      return <rect x="24" y="40" width="52" height="18" transform="rotate(-18 50 50)" {...common} />;
    case "cross":
      return (
        <g {...common}>
          <rect x="42" y="22" width="16" height="56" />
          <rect x="22" y="42" width="56" height="16" />
        </g>
      );
    default:
      return <rect x="27" y="27" width="46" height="46" transform="rotate(-8 50 50)" {...common} />;
  }
}

interface IdenticonProps {
  id: string;
  avatarUrl?: string | null;
  className?: string;
}

const Identicon = ({ id, avatarUrl, className = "w-10 h-10" }: IdenticonProps) => {
  if (avatarUrl) {
    return (
      <img
        src={mediaUrl(avatarUrl)}
        alt=""
        className={`${className} rounded-md object-cover shrink-0 select-none`}
        draggable={false}
      />
    );
  }
  const h = hash(id || "?");
  const shape = SHAPES[h % SHAPES.length];
  const color = PALETTE[Math.floor(h / SHAPES.length) % PALETTE.length];
  return (
    <div className={`${className} rounded-md shrink-0 bg-surface-3 overflow-hidden`} aria-hidden>
      <svg viewBox="0 0 100 100" className="w-full h-full">
        <ShapeSvg shape={shape} color={color} />
      </svg>
    </div>
  );
};

export default Identicon;
