import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Minus, Plus, RotateCcw } from "lucide-react";
import { t } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { SettingsCard, SettingsTitle } from "@/components/settings";
import { TAB_DEFS, MINT_PROFILE } from "@/components/BottomNav";
import { LOCKED_TABS, NAV_TABS, setNavTabs, useNavTabs, type NavTab } from "@/lib/navTabs";
import { useSections } from "@/lib/sections";
import { useMint, MintIcon } from "@/themes/mint";
import { useIsMobile } from "@/hooks/use-mobile";

/**
 * «Нижнее меню» во «Внешнем виде» — как док на iPhone: вкладки тянутся
 * пальцем (соседи разъезжаются, остальные покачиваются), «−» убирает вкладку
 * в лоток ниже, «+» в лотке возвращает. Чаты и профиль — всегда на месте.
 * Сохраняется в профиль (lib/navTabs) сразу после каждого изменения.
 */
const DockEditor = () => {
  const mint = useMint();
  const isMobile = useIsMobile();
  const mintIsland = mint && isMobile !== false;
  const sections = useSections();
  const { tabs, custom } = useNavTabs(mintIsland);
  const visible = (list: NavTab[]) => list.filter((id) => id !== "wall" || sections.wall);
  const [order, setOrder] = useState<NavTab[]>(() => visible(tabs));
  const [drag, setDrag] = useState<{ id: NavTab; x: number } | null>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  const gesture = useRef<{ id: NavTab; startX: number; grab: number; moved: boolean } | null>(null);

  // Пришло с сервера или с другого экрана — показываем, если сейчас не тянем.
  useEffect(() => { if (!gesture.current) setOrder(visible(tabs)); }, [tabs.join(","), sections.wall]); // eslint-disable-line react-hooks/exhaustive-deps

  const save = async (next: NavTab[]) => {
    // Выключенная Стена в меню остаётся на своём месте — вернётся вместе с разделом.
    const full = !sections.wall && tabs.includes("wall") ? [...next.slice(0, tabs.indexOf("wall")), "wall" as NavTab, ...next.slice(tabs.indexOf("wall"))] : next;
    if (!(await setNavTabs(full))) toast.error(t("Не удалось сохранить"));
  };

  const slotW = () => (boxRef.current?.clientWidth || 300) / Math.max(order.length, 1);

  const onDown = (e: React.PointerEvent, id: NavTab) => {
    const box = boxRef.current;
    if (!box) return;
    const left = box.getBoundingClientRect().left;
    const i = order.indexOf(id);
    gesture.current = { id, startX: e.clientX, grab: e.clientX - left - i * slotW(), moved: false };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  };
  const onMove = (e: React.PointerEvent) => {
    const g = gesture.current, box = boxRef.current;
    if (!g || !box) return;
    if (!g.moved && Math.abs(e.clientX - g.startX) < 6) return;
    g.moved = true;
    const w = slotW();
    const x = Math.max(0, Math.min(box.clientWidth - w, e.clientX - box.getBoundingClientRect().left - g.grab));
    setDrag({ id: g.id, x });
    const to = Math.max(0, Math.min(order.length - 1, Math.floor((x + w / 2) / w)));
    const from = order.indexOf(g.id);
    if (to !== from) {
      const next = order.filter((v) => v !== g.id);
      next.splice(to, 0, g.id);
      setOrder(next);
    }
  };
  const onUp = () => {
    const g = gesture.current;
    gesture.current = null;
    setDrag(null);
    if (g?.moved && order.join(",") !== visible(tabs).join(",")) void save(order);
  };

  const remove = (id: NavTab) => { const next = order.filter((v) => v !== id); setOrder(next); void save(next); };
  const add = (id: NavTab) => {
    // Как в доке: в конец, но перед профилем, если он замыкает меню.
    const next = [...order];
    next.splice(next[next.length - 1] === "profile" ? next.length - 1 : next.length, 0, id);
    setOrder(next);
    void save(next);
  };
  const reset = async () => { if (!(await setNavTabs(null))) toast.error(t("Не удалось сохранить")); };

  const look = (id: NavTab) => {
    const d = TAB_DEFS[id];
    const label = id === "profile" && mintIsland ? MINT_PROFILE.label : d.label;
    const icon = mint
      ? <MintIcon name={id === "profile" && mintIsland ? MINT_PROFILE.mint : d.mint} size={id === "profile" && mintIsland ? MINT_PROFILE.size : d.size} />
      : <d.icon className="w-6 h-6" />;
    return { label: t(label), icon };
  };
  const tray = NAV_TABS.filter((id) => !order.includes(id) && (id !== "wall" || sections.wall));
  const w = 100 / Math.max(order.length, 1);

  return (
    <>
      <SettingsTitle>{t("Нижнее меню")}</SettingsTitle>
      <SettingsCard>
        <div className="p-3 space-y-3">
          <div ref={boxRef} className="relative h-[76px] rounded-[22px] bg-surface-3 select-none" style={{ touchAction: "pan-y" }}>
            {order.map((id, i) => {
              const { label, icon } = look(id);
              const dragging = drag?.id === id;
              return (
                <div key={id}
                  onPointerDown={(e) => onDown(e, id)} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp}
                  className={cn("absolute top-0 h-full flex flex-col items-center justify-center gap-1 cursor-grab", dragging ? "z-10 cursor-grabbing" : "transition-[left] duration-200 ease-out", drag && !dragging && "dock-wiggle")}
                  style={{ width: `${w}%`, left: dragging ? `${drag!.x}px` : `${i * w}%`, touchAction: "none" }}
                  aria-label={label}>
                  <div className={cn("relative w-12 h-12 rounded-[14px] bg-surface-1 flex items-center justify-center text-foreground transition-transform", dragging && "scale-110 shadow-xl")}>
                    {icon}
                    {!LOCKED_TABS.has(id) && (
                      <button type="button" aria-label={t("Убрать из меню: {name}", { name: label })}
                        onPointerDown={(e) => e.stopPropagation()} onClick={() => remove(id)}
                        className="absolute -top-1.5 -left-1.5 w-5 h-5 rounded-full bg-foreground/70 text-background flex items-center justify-center">
                        <Minus className="w-3 h-3" strokeWidth={3} />
                      </button>
                    )}
                  </div>
                  <span className="text-[10.5px] leading-none text-subtle truncate max-w-full px-1">{label}</span>
                </div>
              );
            })}
          </div>
          <p className="px-1 text-caption text-subtle">{t("Перетащите вкладку, чтобы поменять порядок. Чаты и профиль убрать нельзя; убранное — строкой в списке чатов.")}</p>
          {tray.length > 0 && (
            <div className="space-y-2">
              <p className="px-1 text-small font-medium">{t("Можно добавить")}</p>
              <div className="flex flex-wrap gap-2">
                {tray.map((id) => {
                  const { label, icon } = look(id);
                  return (
                    <button key={id} type="button" onClick={() => add(id)}
                      className="h-11 pl-2 pr-3 rounded-full bg-surface-3 flex items-center gap-2 text-small active:opacity-80">
                      <span className="w-7 h-7 flex items-center justify-center [&_svg]:w-5 [&_svg]:h-5">{icon}</span>
                      {label}
                      <Plus className="w-4 h-4 text-primary" />
                    </button>
                  );
                })}
              </div>
            </div>
          )}
          {!sections.wall && <p className="px-1 text-caption text-subtle">{t("Стена выключена в «Разделах» ниже — её вкладки нет.")}</p>}
          {custom && (
            <button type="button" onClick={() => void reset()} className="h-9 px-3 rounded-md bg-surface-4 text-small font-medium inline-flex items-center gap-1.5">
              <RotateCcw className="w-4 h-4" />{t("Как было")}
            </button>
          )}
        </div>
      </SettingsCard>
    </>
  );
};

export default DockEditor;
