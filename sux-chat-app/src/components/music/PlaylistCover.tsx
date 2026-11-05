import { ListMusic, Music2 } from "lucide-react";
import { mediaUrl } from "@/api/client";
import { useCachedImage } from "@/lib/imageCache";
import { cn } from "@/lib/utils";

/**
 * Обложка плейлиста: картинка владельца (Playlist.cover_url) или, пока её
 * нет, плитка со значком — как было раньше. className задаёт размер и
 * скругление, iconClass — размер значка в плитке.
 */
const PlaylistCover = ({ url, isDefault, className, iconClass = "w-5 h-5" }: {
  url?: string | null;
  isDefault?: boolean;
  className?: string;
  iconClass?: string;
}) => {
  const src = useCachedImage(url ? mediaUrl(url) : null);
  if (url) {
    // Пока картинка грузится — пустая плитка того же размера, без прыжка значка.
    return src
      ? <img src={src} alt="" draggable={false} className={cn("object-cover bg-surface-4 shrink-0", className)} />
      : <span className={cn("block bg-surface-4 shrink-0", className)} aria-hidden />;
  }
  const Icon = isDefault ? Music2 : ListMusic;
  return (
    <span className={cn("bg-surface-4 text-primary flex items-center justify-center shrink-0", className)} aria-hidden>
      <Icon className={iconClass} />
    </span>
  );
};

export default PlaylistCover;
