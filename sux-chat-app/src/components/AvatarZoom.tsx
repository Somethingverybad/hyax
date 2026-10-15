import { useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import ImageViewer from "@/components/ImageViewer";
import { cn } from "@/lib/utils";
import { t } from "@/lib/i18n";

/**
 * Аватар в чужом профиле: по нажатию открывается крупно — тем же
 * просмотрщиком, что и фото в переписке (щипок, свайп вниз — закрыть).
 * Без аватара (identicon) — просто обёртка, нажимать нечего.
 *
 * Просмотрщик — порталом в body: профиль бывает шторкой со свайпом вниз и
 * закрытием по тапу на фон, жесты просмотра не должны до них доходить.
 */
export default function AvatarZoom({ url, name, children, className }: {
  url?: string | null;
  name?: string;
  children: ReactNode;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  if (!url) return <>{children}</>;
  const stop = (e: { stopPropagation: () => void }) => e.stopPropagation();
  return (
    <>
      <button
        type="button"
        onClick={(e) => { e.stopPropagation(); setOpen(true); }}
        className={cn("shrink-0 rounded-lg active:opacity-80 transition-opacity", className)}
        aria-label={t("Открыть аватар")}
      >
        {children}
      </button>
      {open && createPortal(
        <div onClick={stop} onPointerDown={stop} onTouchStart={stop} onTouchMove={stop} onTouchEnd={stop}>
          <ImageViewer
            items={[{ raw: url, name: `${name || "avatar"}.jpg`, messageId: "avatar" }]}
            index={0}
            onIndex={() => {}}
            onClose={() => setOpen(false)}
            actions={[]}
          />
        </div>,
        document.body,
      )}
    </>
  );
}
