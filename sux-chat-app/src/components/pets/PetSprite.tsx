import { useEffect, useRef, useState } from "react";
import type { AnimationItem } from "lottie-web";
import { loadLottie } from "@/components/chat/StickerView";
import { loadPose, type PetPack, type PetSex, type PoseName } from "@/lib/pets";

/**
 * Поза питомца: Lottie из пака вида (lib/pets). Размер — холст пака × scale;
 * flip — отражение (идёт влево). Анимацию держим одну на позу: сменилась поза —
 * прежняя уничтожается.
 */
export default function PetSprite({ species, pose, coat, sex, acc, scale, flip, paused, className, onPack }: {
  species: string;
  pose: PoseName;
  /** Окрас из пака (Pet.color); пусто — как нарисован. */
  coat?: string | null;
  /** Пол и надетые украшения (null — по умолчанию для пола). */
  sex?: PetSex | null;
  acc?: string[] | null;
  /** Пикселей на единицу холста; по умолчанию — из пака (как в чате). */
  scale?: number;
  flip?: boolean;
  paused?: boolean;
  className?: string;
  onPack?: (pack: PetPack) => void;
}) {
  const box = useRef<HTMLDivElement>(null);
  const anim = useRef<AnimationItem | null>(null);
  const [pack, setPack] = useState<PetPack | null>(null);

  useEffect(() => {
    let off = false;
    void Promise.all([loadPose(species, pose, { coat, sex, acc }), loadLottie()]).then(([{ data, pack: p }, lottie]) => {
      if (off || !box.current) return;
      setPack(p);
      onPack?.(p);
      anim.current?.destroy();
      anim.current = lottie.loadAnimation({
        container: box.current, renderer: "svg", loop: true, autoplay: !paused,
        animationData: data, rendererSettings: { preserveAspectRatio: "xMidYMid meet" },
      });
    }).catch(() => {});
    return () => { off = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [species, pose, coat, sex, acc?.join(",") ?? "-"]);

  useEffect(() => {
    if (!anim.current) return;
    if (paused) anim.current.pause(); else anim.current.play();
  }, [paused]);

  useEffect(() => () => { anim.current?.destroy(); anim.current = null; }, []);

  const k = scale ?? pack?.scale ?? 0.3;
  const [w, h] = pack?.canvas ?? [200, 240];
  return (
    <div ref={box} className={className} aria-hidden
      style={{ width: w * k, height: h * k, transform: flip ? "scaleX(-1)" : undefined }} />
  );
}
