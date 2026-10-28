import { useEffect, useRef, useState, type MouseEvent, type RefObject } from "react";
import { toast } from "sonner";
import { api, type PetAction, type PetBrief, type PetMood } from "@/api/client";
import { getLang, t } from "@/lib/i18n";
import { isNight, loadPack, petDisplayName, purr, rememberPet, useChatPets, usePetsAvailable, usePetsHidden, warmPurr, type PetPack, type PoseName } from "@/lib/pets";
import PetSprite from "./PetSprite";

/**
 * Питомцы участников в переписке: гуляют по пузырям, спят на них, царапают и
 * закапывают — только анимация поверх ленты, на сами сообщения не влияет.
 *
 * Питомец в чате, куда его позвал хозяин (меню чата → «Позвать питомца»).
 * Кот живёт внутри колонки ленты (feedRef, position: relative) — едет вместе с
 * пузырями при прокрутке. Пузыри — `[id^="msg-"]` с `data-sender-id`, сам
 * пузырь — `.msg-bubble` (картинки и стикеры без пузыря не годятся).
 * Поведение — маленький автомат по настроению с сервера (chat/pets.py mood).
 */

const MAX_PETS = 2;
const DOUBLE_TAP = 320; // мс между тапами — «покормить»
// left/right — где может стоять середина питомца: на ровной части верхнего края, не под соседним сообщением.
type Spot = { msgId: string; own: boolean; left: number; right: number; top: number };
type Act = { pose: PoseName; min: number; max: number; target: "owner" | "other" | "any"; w: number };

// Что делает и где: target — на чьих сообщениях (хозяина / чужих).
const BEHAVIOUR: Record<PetMood, Act[]> = {
  happy: [
    { pose: "sleep", min: 14, max: 40, target: "owner", w: 3 }, { pose: "purr", min: 3, max: 6, target: "owner", w: 2 },
    { pose: "belly", min: 6, max: 14, target: "owner", w: 1 }, { pose: "lie", min: 8, max: 20, target: "owner", w: 2 },
    { pose: "walk", min: 2, max: 4, target: "any", w: 2 },
  ],
  content: [
    { pose: "sit", min: 4, max: 9, target: "any", w: 3 }, { pose: "lie", min: 8, max: 18, target: "owner", w: 2 },
    { pose: "walk", min: 2, max: 4, target: "any", w: 3 }, { pose: "sleep", min: 12, max: 30, target: "owner", w: 1 },
    { pose: "purr", min: 3, max: 5, target: "owner", w: 1 },
  ],
  bored: [
    { pose: "walk", min: 2, max: 5, target: "any", w: 4 }, { pose: "sit", min: 4, max: 8, target: "any", w: 2 },
    { pose: "lie", min: 6, max: 14, target: "any", w: 2 }, { pose: "scratch", min: 2, max: 4, target: "other", w: 1 },
  ],
  hungry: [
    { pose: "scratch", min: 3, max: 6, target: "other", w: 4 }, { pose: "walk", min: 2, max: 4, target: "any", w: 2 },
    { pose: "sad", min: 5, max: 9, target: "owner", w: 1 },
  ],
  lonely: [
    { pose: "bury", min: 3, max: 5, target: "other", w: 3 }, { pose: "sulk", min: 5, max: 10, target: "owner", w: 3 },
    { pose: "walk", min: 2, max: 4, target: "any", w: 1 },
  ],
  sad: [{ pose: "sad", min: 8, max: 16, target: "owner", w: 4 }, { pose: "lie", min: 8, max: 16, target: "owner", w: 2 }],
  sick: [{ pose: "sick", min: 20, max: 40, target: "owner", w: 5 }],
  overfed: [{ pose: "belly", min: 8, max: 18, target: "any", w: 5 }, { pose: "sleep", min: 14, max: 30, target: "any", w: 2 }],
};

function pick<T extends { w: number }>(list: T[]): T {
  let r = Math.random() * list.reduce((s, x) => s + x.w, 0);
  for (const x of list) { r -= x.w; if (r <= 0) return x; }
  return list[list.length - 1];
}
const rand = (a: number, b: number) => a + Math.random() * (b - a);
const reduceMotion = () => typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

/**
 * Пузыри, видимые в окне ленты, на которые можно сесть. Пузыри идут почти
 * вплотную, и кот на верхнем крае заслоняет сообщение над ним — будто висит
 * между пузырями. Поэтому садимся только туда, где над пузырём свободно:
 * у входящих и исходящих это часть края, не прикрытая соседом сверху.
 * Если свободного места нет нигде — садимся как придётся.
 */
/**
 * Видимая часть ленты на экране. Шапка «Мяты» и панель ввода лежат поверх
 * ленты, и под них она отводит место отступами прокрутки (--glass-h сверху,
 * --compose-h и клавиатура снизу) — эти отступы и вычитаем.
 */
function visibleBand(scroll: HTMLElement): { top: number; bottom: number } {
  const sb = scroll.getBoundingClientRect();
  const cs = getComputedStyle(scroll);
  return { top: sb.top + (parseFloat(cs.paddingTop) || 0), bottom: sb.bottom - (parseFloat(cs.paddingBottom) || 0) };
}

function visibleSpots(feed: HTMLElement, scroll: HTMLElement, ownerId: string, catH: number, halfW: number): Spot[] {
  const fb = feed.getBoundingClientRect();
  const band = visibleBand(scroll);
  const rows = [...feed.querySelectorAll<HTMLElement>(':scope > [id^="msg-"]')];
  // Всё, что видно в ленте и что кот может заслонить: пузыри, картинки, стикеры.
  const blocks = rows.flatMap((row) => [...row.querySelectorAll<HTMLElement>(".msg-bubble, img, video, canvas")]
    .map((e) => ({ row, r: e.getBoundingClientRect() })).filter((b) => b.r.width > 0 && b.r.height > 0));
  const edge = halfW * 1.1; // лапы — на ровной части края, не на скруглении
  const body = halfW * 0.75; // ширина тела от середины
  const free: Spot[] = [], any: Spot[] = [];
  rows.forEach((row) => {
    const bubble = row.querySelector<HTMLElement>(".msg-bubble");
    if (!bubble) return;
    const r = bubble.getBoundingClientRect();
    if (r.width < 96 || r.top - catH < band.top + 4 || r.top > band.bottom - 16) return;
    const base = { msgId: row.id, own: row.dataset.senderId === ownerId, top: r.top - fb.top };
    const lo = r.left + edge, hi = r.right - edge;
    if (hi < lo) return;
    any.push({ ...base, left: lo - fb.left, right: hi - fb.left });
    // Вычесть из [lo, hi] всё, что над пузырём на высоте кота.
    let gaps: [number, number][] = [[lo, hi]];
    for (const b of blocks) {
      if (b.row === row || b.r.bottom <= r.top - catH || b.r.top >= r.top - 1) continue;
      const cutL = b.r.left - body, cutR = b.r.right + body;
      gaps = gaps.flatMap(([g0, g1]) => (cutR <= g0 || cutL >= g1 ? [[g0, g1]] : [[g0, cutL], [cutR, g1]].filter(([x0, x1]) => x1 >= x0) as [number, number][]));
    }
    const best = gaps.sort((x, y) => (y[1] - y[0]) - (x[1] - x[0]))[0];
    if (best) free.push({ ...base, left: best[0] - fb.left, right: best[1] - fb.left });
  });
  return free.length ? free : any;
}

function PetActor({ pet, feedRef, scrollRef }: { pet: PetBrief; feedRef: RefObject<HTMLDivElement>; scrollRef: RefObject<HTMLDivElement> }) {
  const [pack, setPack] = useState<PetPack | null>(null);
  const [pose, setPose] = useState<PoseName>("sit");
  const [pos, setPos] = useState<{ x: number; y: number; flip: boolean; dur: number; shown: boolean }>({ x: 0, y: 0, flip: false, dur: 0, shown: false });
  const spot = useRef<string | null>(null);
  const timer = useRef<number | null>(null);
  const el = useRef<HTMLButtonElement>(null);
  const tapLock = useRef(0);
  const doing = useRef<PoseName>("sit");
  const lastTap = useRef(0);
  const pendingCare = useRef<number | null>(null);
  // Текущее положение — для шагов автомата (таймеры живут дольше одной отрисовки).
  const posRef = useRef(pos);
  posRef.current = pos;

  useEffect(() => { void loadPack(pet.species).then(setPack).catch(() => {}); warmPurr(); }, [pet.species]);

  useEffect(() => {
    if (!pack) return;
    let alive = true;
    const k = pack.scale;
    const catH = pack.canvas[1] * k * 0.8;
    const halfW = (pack.canvas[0] * k) / 2;
    const still = reduceMotion();

    const place = (s: Spot, x: number, dur: number, flip: boolean) => {
      spot.current = s.msgId;
      setPos({ x, y: s.top, flip, dur, shown: true });
    };
    const clampX = (s: Spot, x: number) => Math.min(s.right, Math.max(s.left, x));

    const step = () => {
      if (!alive) return;
      const feed = feedRef.current, scroll = scrollRef.current;
      if (!feed || !scroll || document.hidden) { timer.current = window.setTimeout(step, 3000); return; }
      const spots = visibleSpots(feed, scroll, pet.owner_id, catH, halfW);
      if (!spots.length) { setPos((p) => ({ ...p, shown: false })); timer.current = window.setTimeout(step, 2500); return; }
      const acts = BEHAVIOUR[pet.mood] ?? BEHAVIOUR.content;
      const night = isNight() && (pet.mood === "happy" || pet.mood === "content" || pet.mood === "bored");
      let act = night && Math.random() < 0.7 ? { pose: "sleep" as PoseName, min: 20, max: 50, target: "owner" as const, w: 1 } : pick(acts);
      if (still && act.pose === "walk") act = { ...act, pose: "sit" };
      const wanted = spots.filter((s) => act.target === "any" || (act.target === "owner" ? s.own : !s.own));
      const pool = wanted.length ? wanted : spots;
      const cur = spots.find((s) => s.msgId === spot.current);
      // Чаще остаёмся на том же пузыре — переходим, если там «не то» или пора прогуляться.
      const target = cur && (!wanted.length || wanted.includes(cur)) && Math.random() < 0.55 ? cur : pool[Math.floor(Math.random() * pool.length)];
      const fromX = posRef.current.shown && cur ? posRef.current.x : null;
      let x = rand(target.left, target.right);
      if (act.pose === "walk" && cur === target && fromX !== null) {
        // Прогулка по тому же пузырю — в другой конец свободного места.
        x = fromX < (target.left + target.right) / 2 ? target.right : target.left;
      }
      x = clampX(target, x);
      const speed = pack.poses.walk?.speed ?? 34;
      if (fromX === null || still) {
        place(target, x, 0, false);
        setPose(act.pose === "walk" ? "sit" : act.pose);
      } else if (cur === target) {
        const d = Math.abs(x - fromX);
        const flip = x < fromX;
        setPose(d > 6 ? "walk" : act.pose);
        place(target, x, d / speed, flip);
        // Дошёл — делает задуманное (а если это была прогулка — садится).
        if (d > 6) window.setTimeout(() => { if (alive) setPose(act.pose === "walk" ? "sit" : act.pose); }, (d / speed) * 1000);
      } else {
        // Другой пузырь — прыжок дугой: по горизонтали плавно, по вертикали — через верх.
        const flip = x < fromX;
        setPose("walk");
        place(target, x, 0.55, flip);
        el.current?.animate([{ translate: "0 0" }, { translate: "0 -34px" }, { translate: "0 0" }], { duration: 550, easing: "ease-out" });
        window.setTimeout(() => { if (alive) setPose(act.pose === "walk" ? "sit" : act.pose); }, 560);
      }
      doing.current = act.pose === "walk" ? "sit" : act.pose;
      timer.current = window.setTimeout(step, rand(act.min, act.max) * 1000);
    };

    // Пузырь уезжает за край экрана (листают, пришли новые сообщения) — кот не
    // едет с ним под шапку или под панель ввода, а перепрыгивает на ближайшее
    // видимое сообщение: уходит вверх — на то, что ниже, вниз — на то, что выше.
    let lastHop = 0;
    const curBubble = () => {
      const feed = feedRef.current;
      return feed && spot.current ? feed.querySelector<HTMLElement>(`#${CSS.escape(spot.current)} .msg-bubble`) : null;
    };
    const hopAway = (dir: "down" | "up") => {
      const feed = feedRef.current, scroll = scrollRef.current;
      if (!feed || !scroll) return;
      const from = posRef.current;
      const spots = visibleSpots(feed, scroll, pet.owner_id, catH, halfW)
        .filter((s) => s.msgId !== spot.current && (dir === "down" ? s.top > from.y : s.top < from.y))
        .sort((a, b) => (dir === "down" ? a.top - b.top : b.top - a.top));
      const target = spots[0];
      if (!target) { spot.current = null; setPos((p) => ({ ...p, shown: false })); return; }
      const x = clampX(target, from.x);
      const band = visibleBand(scroll);
      if (still || Math.abs(target.top - from.y) > (band.bottom - band.top) * 0.8) {
        // Далеко (пролистали) — не летит через весь экран: исчез и появился.
        spot.current = target.msgId;
        setPos((p) => ({ ...p, shown: false }));
        window.setTimeout(() => { if (alive && spot.current === target.msgId) setPos({ x, y: target.top, flip: from.flip, dur: 0, shown: true }); }, 260);
        return;
      }
      setPose("walk");
      place(target, x, 0.55, x < from.x);
      el.current?.animate([{ translate: "0 0" }, { translate: "0 -30px" }, { translate: "0 0" }], { duration: 550, easing: "ease-out" });
      window.setTimeout(() => { if (alive) setPose(doing.current); }, 560);
    };
    const checkEdges = () => {
      const scroll = scrollRef.current, row = curBubble();
      if (!alive || !scroll || !row || !posRef.current.shown || Date.now() - lastHop < 650) return;
      const band = visibleBand(scroll);
      const r = row.getBoundingClientRect();
      const dir = r.top - catH * 0.6 < band.top ? "down" : r.top > band.bottom - 10 ? "up" : null;
      if (!dir) return;
      lastHop = Date.now();
      hopAway(dir);
    };
    let raf = 0;
    const onScroll = () => { if (!raf) raf = requestAnimationFrame(() => { raf = 0; checkEdges(); }); };
    const scrollEl = scrollRef.current;
    scrollEl?.addEventListener("scroll", onScroll, { passive: true });

    // Пузырь мог уехать (новые сообщения, клавиатура) — держимся за него.
    const follow = window.setInterval(() => {
      const feed = feedRef.current;
      if (!feed || !spot.current) return;
      const row = curBubble();
      if (!row) { setPos((p) => ({ ...p, shown: false })); return; }
      const fb = feed.getBoundingClientRect();
      const r = row.getBoundingClientRect();
      const top = r.top - fb.top;
      setPos((p) => (Math.abs(p.y - top) > 1 ? { ...p, y: top, dur: 0 } : p));
      checkEdges();
    }, 700);

    timer.current = window.setTimeout(step, 600);
    return () => {
      alive = false; window.clearInterval(follow); if (timer.current) window.clearTimeout(timer.current);
      scrollEl?.removeEventListener("scroll", onScroll); if (raf) cancelAnimationFrame(raf);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pack, pet.mood, pet.owner_id]);

  // Уход раз в сутки от человека (chat/pets.py); дальше — только анимация.
  const careOnce = (action: PetAction) => {
    const key = `hyax:pet-cared:${pet.id}`;
    let until = 0;
    try { until = Number(localStorage.getItem(key) || 0); } catch { /* без памяти */ }
    if (Date.now() < until || Date.now() - tapLock.current < 3000) return;
    tapLock.current = Date.now();
    const name = petDisplayName(pet, pack, getLang());
    api.carePet(pet.id, action).then((r) => {
      rememberPet(r.pet);
      try { localStorage.setItem(key, String(Date.now() + 24 * 3600_000)); } catch { /* */ }
      toast.success(action === "feed" ? t("{name} накормлен — +{n} к вайбу", { name, n: r.vibe_gain }) : t("{name} мурчит — +1 к вайбу", { name }));
    }).catch((e: { nextCareAt?: string }) => {
      if (e?.nextCareAt) { try { localStorage.setItem(key, String(new Date(e.nextCareAt).getTime())); } catch { /* */ } }
    });
  };
  // Тап — мурчит (и «погладить»), двойной тап — ест (и «покормить»). Мурчание
  // начинается сразу, а уход «погладить» ждёт DOUBLE_TAP: вдруг это двойной.
  const tap = (e: MouseEvent) => {
    // Время самого касания, а не обработки: телефон мог задуматься между тапами.
    const now = e.timeStamp || performance.now();
    if (now - lastTap.current < DOUBLE_TAP) {
      lastTap.current = 0;
      if (pendingCare.current) { window.clearTimeout(pendingCare.current); pendingCare.current = null; }
      setPose("eat");
      window.setTimeout(() => setPose((p) => (p === "eat" ? doing.current : p)), 3200);
      careOnce("feed");
      return;
    }
    lastTap.current = now;
    purr();
    setPose("purr");
    window.setTimeout(() => setPose((p) => (p === "purr" ? doing.current : p)), 2600);
    pendingCare.current = window.setTimeout(() => { pendingCare.current = null; careOnce("pet"); }, DOUBLE_TAP);
  };

  if (!pack) return null;
  const k = pack.scale;
  const [ax, ay] = pack.anchor;
  return (
    <button
      ref={el}
      type="button"
      onClick={tap}
      aria-label={t("Погладить {name}", { name: petDisplayName(pet, pack, getLang()) })}
      className="absolute z-[5] p-0 bg-transparent border-0 outline-none select-none"
      style={{
        left: 0, top: 0,
        transform: `translate(${pos.x - ax * k}px, ${pos.y - ay * k}px)`,
        transition: pos.dur ? `transform ${pos.dur}s linear, opacity .3s` : "opacity .3s",
        opacity: pos.shown ? 1 : 0,
        pointerEvents: pos.shown ? "auto" : "none",
        touchAction: "manipulation", // двойной тап — «покормить», а не увеличение страницы
      }}
    >
      <PetSprite species={pet.species} pose={pose} coat={pet.color} flip={pos.flip} paused={reduceMotion()} />
    </button>
  );
}

export default function ChatPets({ chatId, feedRef, scrollRef, active }: {
  chatId: string | null | undefined;
  feedRef: RefObject<HTMLDivElement>;
  scrollRef: RefObject<HTMLDivElement>;
  active: boolean;
}) {
  const hidden = usePetsHidden();
  const available = usePetsAvailable();
  const pets = useChatPets(available ? chatId : null).slice(0, MAX_PETS);
  if (hidden || !available || !active || !pets.length) return null;
  return <>{pets.map((p) => <PetActor key={p.id} pet={p} feedRef={feedRef} scrollRef={scrollRef} />)}</>;
}
