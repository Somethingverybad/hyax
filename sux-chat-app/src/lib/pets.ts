import { useEffect, useState } from "react";
import { api, type Pet, type PetBrief, type PetMood } from "@/api/client";
import { t } from "@/lib/i18n";
import { onUserMessage } from "@/lib/userSocket";
import { softRumble } from "@/lib/rov";
import { Capacitor } from "@capacitor/core";
import { Haptics, ImpactStyle } from "@capacitor/haptics";

/**
 * Питомцы на клиенте: пак вида (рисунки и поведение) и состояние с сервера.
 *
 * Пак — public/pets/<вид>/manifest.json + по файлу Lottie на позу (формат —
 * design/pets/README.md, пример — design/pets/cat/make_cat.py). Новое животное —
 * новый пак, код не меняется. Пак едет с веб-частью, в том числе по воздуху.
 *
 * Правила (шкала, уход раз в сутки, вайб, напоминания) — на сервере, chat/pets.py.
 */

export type PoseName = "sit" | "purr" | "walk" | "lie" | "sleep" | "belly" | "scratch" | "bury" | "eat" | "sad" | "sick" | "sulk" | (string & {});
export type PetSex = "m" | "f";

export interface PetPose {
  file: string;
  /** Своя анимация у пола (формат 2): { f: "walk-f.json" }; нет — общая file. */
  files?: Partial<Record<PetSex, string>>;
  loop?: boolean;
  /** walk: скорость в CSS-пикселях в секунду при масштабе пака. */
  speed?: number;
  /** Куда смотрит рисунок (для отражения при ходьбе влево). */
  facing?: "left" | "right";
  sound?: string;
}

export interface PetPack {
  format: number;
  species: string;
  rev?: number;
  name: Record<string, string>;
  defaultName: Record<string, string>;
  canvas: [number, number];
  /** Точка опоры на холсте: где питомец касается верхнего края пузыря. */
  anchor: [number, number];
  /** Пикселей на единицу холста в чате. */
  scale: number;
  poses: Partial<Record<PoseName, PetPose>>;
  sounds?: Record<string, string>;
  /** Слоты окраса: деталь → цвет-метка в файлах поз (#rrggbb). */
  palette?: Record<string, string>;
  /** Слоты палитры для кружка окраса: [основной цвет, точка]. Нет — угадываем (coatSwatch). */
  swatch?: [string, string];
  /** Окрасы: что поменять в палитре. Выбирает хозяин (Pet.color). */
  coats?: Record<string, PetCoat>;
  defaultCoat?: string;
  // ---- формат 2 ----
  sexes?: PetSex[];
  /** Имя по умолчанию у пола, если оно не как defaultName (тот — для «m» и старых версий). */
  defaultNameBySex?: Partial<Record<PetSex, Record<string, string>>>;
  /** Украшения: слои acc:<id> в позах; slot — одно на место; sex — кому подходит. */
  accessories?: Record<string, PetAccessory>;
  /** Фразы вида: tap — после ухода тапом («{name} мурчит — +1 к вайбу»), строка или { m, f }. */
  texts?: Record<string, Record<string, string | Partial<Record<PetSex, string>>>>;
  /** Свои «приколы» вида: дополнительные действия по настроению (к общему характеру). */
  extras?: Partial<Record<PetMood, PetAct[]>>;
}

export interface PetAccessory {
  name: Record<string, string>;
  slot: string;
  sex?: PetSex[];
  default?: boolean;
}

export interface PetAct {
  pose: PoseName;
  min: number;
  max: number;
  target: "owner" | "other" | "any";
  w: number;
}

export interface PetCoat {
  name: Record<string, string>;
  colors: Record<string, string>;
}

/** Все виды по порядку витрины (pages/PetCatalog). Новый вид — пак в public/pets и строка здесь и в SPECIES (chat/pets.py). */
export const PET_KINDS = ["cat", "kitty", "rabbit", "bunny", "dog", "frog"] as const;

// От корня приложения, как звуки (/sounds/…): в сборке base: "./", и адрес
// относительно страницы на /profile/pets уходил в /profile/pets/<вид>/… —
// вместо пака приходила страница, на витрине не грузился ни один питомец
// (баг-репорт 76afa590: телефон, компьютер, сайт). В профиле и чатах путь
// случайно совпадал.
const base = () => "/";
const packs = new Map<string, Promise<PetPack>>();
const poses = new Map<string, Promise<unknown>>();

// Уже загруженные паки — сразу, без ожидания промиса: карточка и рисунок
// показывают окрасы и размер с первой отрисовки.
const loadedPacks = new Map<string, PetPack>();
export const peekPack = (species?: string | null): PetPack | null => (species ? loadedPacks.get(species) ?? null : null);

// Питомец профиля — с прошлого раза, пока идёт запрос: карточка в настройках
// не пропадает и не грузится заново при каждом входе. Свой — ещё и на
// устройстве (между запусками), чужие — только в памяти.
const PET_KEY = "hyax:pet:";
const petMem = new Map<string, Pet | null>();
export function cachedPetOf(profileId: string, persist = false): Pet | null | undefined {
  if (petMem.has(profileId)) return petMem.get(profileId);
  if (!persist) return undefined;
  try {
    const v = localStorage.getItem(PET_KEY + profileId);
    if (v === null) return undefined;
    const p = JSON.parse(v) as Pet | null;
    petMem.set(profileId, p);
    return p;
  } catch { return undefined; }
}
export function storePetOf(profileId: string, pet: Pet | null, persist = false): void {
  petMem.set(profileId, pet);
  if (persist) try { localStorage.setItem(PET_KEY + profileId, JSON.stringify(pet)); } catch { /* без памяти */ }
}

export function loadPack(species: string): Promise<PetPack> {
  let p = packs.get(species);
  if (!p) {
    p = fetch(`${base()}pets/${species}/manifest.json`).then((r) => {
      if (!r.ok) throw new Error(`pet pack ${species}: ${r.status}`);
      return r.json();
    });
    p.then((v) => { loadedPacks.set(species, v); }, () => packs.delete(species));
    packs.set(species, p);
  }
  return p;
}

const hexRgb = (h: string): number[] => {
  const n = parseInt(h.replace("#", ""), 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
};

/**
 * Окрас: цвета-метки палитры пака меняются на цвета окраса. Остальные цвета
 * (сердечки, миска, плед) не трогаем. Метки разных деталей отличаются на 1/255 —
 * сравниваем с допуском меньше этого.
 */
export function recolor(data: unknown, pack: PetPack, coat: string | null | undefined): unknown {
  const c = coat ? pack.coats?.[coat] : undefined;
  const pal = pack.palette;
  if (!c || !pal) return data;
  const pairs = Object.entries(c.colors).filter(([slot]) => pal[slot]).map(([slot, to]) => [hexRgb(pal[slot]), hexRgb(to)] as const);
  if (!pairs.length) return data;
  const same = (a: number[], b: number[]) => Math.abs(a[0] - b[0]) < 0.0015 && Math.abs(a[1] - b[1]) < 0.0015 && Math.abs(a[2] - b[2]) < 0.0015;
  const walk = (o: unknown): unknown => {
    if (Array.isArray(o)) return o.map(walk);
    if (!o || typeof o !== "object") return o;
    const r: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(o)) r[k] = walk(v);
    if (r.ty === "fl" || r.ty === "st") {
      const cc = r.c as { a?: number; k?: number[] } | undefined;
      if (cc && !cc.a && Array.isArray(cc.k)) {
        const hit = pairs.find(([from]) => same(cc.k!, from));
        if (hit) r.c = { ...cc, k: [...hit[1], cc.k[3] ?? 1] };
      }
    }
    return r;
  };
  return walk(data);
}

/** Как выглядит питомец: окрас, пол, надетые украшения (null — по умолчанию для пола). */
export interface PetLook {
  coat?: string | null;
  sex?: PetSex | null;
  acc?: string[] | null;
}

/** Надетые украшения: свои или те, что у пола по умолчанию; чужие полу и неизвестные — мимо. */
export function wornAccessories(pack: PetPack, look: PetLook): string[] {
  const all = pack.accessories || {};
  const sex = look.sex || "m";
  const fits = (id: string) => { const a = all[id]; return !!a && (!a.sex || a.sex.includes(sex)); };
  const list = look.acc ?? Object.keys(all).filter((id) => all[id].default);
  // Одно украшение на место: последнее выигрывает.
  const bySlot = new Map<string, string>();
  for (const id of list) if (fits(id)) bySlot.set(all[id].slot, id);
  return [...bySlot.values()];
}

/**
 * Слои по виду: acc:<id> — только надетые украшения, sex:<пол> — только своего пола.
 * Остальные группы не трогаем. Работает и для групп фигур, и для слоёв Lottie.
 */
export function filterLayers(data: unknown, worn: string[], sex: PetSex): unknown {
  const keep = (nm: unknown) => {
    if (typeof nm !== "string") return true;
    if (nm.startsWith("acc:")) return worn.includes(nm.slice(4));
    if (nm.startsWith("sex:")) return nm.slice(4) === sex;
    return true;
  };
  const walk = (o: unknown): unknown => {
    if (Array.isArray(o)) return o.filter((x) => !(x && typeof x === "object" && "nm" in x && !keep((x as { nm: unknown }).nm))).map(walk);
    if (!o || typeof o !== "object") return o;
    const r: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(o)) r[k] = walk(v);
    return r;
  };
  return walk(data);
}

/** Данные Lottie позы в нужном виде (кэш на весь сеанс). Нет такой позы в паке — «сидит». */
export async function loadPose(species: string, pose: PoseName, look: PetLook = {}): Promise<{ data: unknown; pose: PetPose; pack: PetPack }> {
  const pack = await loadPack(species);
  const meta = pack.poses[pose] || pack.poses.sit!;
  const sex: PetSex = look.sex || "m";
  const file = meta.files?.[sex] || meta.file;
  const key = `${species}/${file}`;
  let d = poses.get(key);
  if (!d) {
    d = fetch(`${base()}pets/${species}/${file}${pack.rev ? `?r=${pack.rev}` : ""}`).then((r) => r.json());
    d.catch(() => poses.delete(key));
    poses.set(key, d);
  }
  const coat = look.coat && pack.coats?.[look.coat] && look.coat !== pack.defaultCoat ? look.coat : "";
  const worn = wornAccessories(pack, look);
  const layered = (pack.format ?? 1) >= 2;
  const ck = `${key}#${coat}#${layered ? `${sex}:${worn.join(",")}` : ""}`;
  let cd = poses.get(ck);
  if (!cd) {
    cd = d.then((raw) => {
      const shaped = layered ? filterLayers(raw, worn, sex) : raw;
      return coat ? recolor(shaped, pack, coat) : shaped;
    });
    poses.set(ck, cd);
  }
  return { data: await cd, pose: meta, pack };
}

/** Род во фразах: «накормлен / накормлена». */
export const bySex = (sex: string | null | undefined, m: string, f: string) => (sex === "f" ? f : m);

/** Фраза вида из пака (texts[key]) на языке и для пола; нет — запасная. */
export function packText(pack: PetPack | null | undefined, key: string, lang: string, sex: string | null | undefined, fallback: string): string {
  const byLang = pack?.texts?.[key];
  const v = byLang?.[lang] ?? byLang?.ru;
  if (!v) return fallback;
  if (typeof v === "string") return v;
  return v[(sex as PetSex) || "m"] || v.m || fallback;
}

/** Цвет меха окраса — для кружков выбора. */
/** Какие слоты палитры показывать в кружке окраса. У кота это fur и tip, но у
 *  жабы — skin и spot, у пса — fur и spot: раньше брались только fur/tip, и у
 *  жабы все кружки были одинаково белыми. Можно задать в манифесте (swatch),
 *  иначе основной — fur или skin, а точка — tip или слот, который окрасы
 *  меняют чаще всего (контур, глаза и блики не в счёт). */
const SWATCH_SKIP = new Set(["ink", "eye", "glint", "mouth", "teeth"]);
function swatchSlots(pack: PetPack): [string, string] {
  if (pack.swatch?.length === 2) return pack.swatch;
  const pal = Object.keys(pack.palette || {});
  const used: Record<string, number> = {};
  for (const c of Object.values(pack.coats || {})) for (const k of Object.keys(c.colors || {})) used[k] = (used[k] || 0) + 1;
  const ranked = pal.filter((k) => !SWATCH_SKIP.has(k)).sort((a, b) => (used[b] || 0) - (used[a] || 0));
  const main = pal.includes("fur") ? "fur" : pal.includes("skin") ? "skin" : ranked[0] || "fur";
  const dot = pal.includes("tip") ? "tip" : ranked.find((k) => k !== main && used[k]) || "tip";
  return [main, dot];
}

export function coatSwatch(pack: PetPack, coat: string): { fur: string; tip: string } {
  const pal = pack.palette || {};
  const c = pack.coats?.[coat]?.colors || {};
  const [main, dot] = swatchSlots(pack);
  return { fur: c[main] || pal[main] || "#FFFFFF", tip: c[dot] || pal[dot] || "#1E1E1E" };
}

export function petDisplayName(pet: { name?: string | null; sex?: string | null }, pack?: PetPack | null, lang = "ru"): string {
  const bySexName = pet.sex === "f" ? pack?.defaultNameBySex?.f : undefined;
  return pet.name || bySexName?.[lang] || bySexName?.ru || pack?.defaultName?.[lang] || pack?.defaultName?.ru || t("Питомец");
}

/** Подпись и цвет настроения. */
export function moodInfo(m: PetMood, sex?: string | null): { label: string; color: string } {
  const g = (mm: string, f: string) => t(bySex(sex, mm, f));
  switch (m) {
    case "happy": return { label: g("Счастлив", "Счастлива"), color: "#2BB673" };
    case "content": return { label: g("Доволен", "Довольна"), color: "#5FB44E" };
    case "bored": return { label: t("Скучает"), color: "#C9A227" };
    case "hungry": return { label: g("Голоден", "Голодна"), color: "#E08A2E" };
    case "lonely": return { label: g("Обиделся", "Обиделась"), color: "#D9733B" };
    case "sad": return { label: t("Грустит"), color: "#C8553D" };
    case "sick": return { label: g("Приболел", "Приболела"), color: "#B23A48" };
    case "overfed": return { label: g("Объелся", "Объелась"), color: "#8E7CC3" };
  }
}

/** Ночь у смотрящего — питомец больше спит (часового пояса хозяина сервер не знает). */
export const isNight = (d = new Date()) => d.getHours() >= 23 || d.getHours() < 7;

/** Поза для карточки профиля по настроению. */
export function profilePose(m: PetMood): PoseName {
  if (isNight() && (m === "happy" || m === "content" || m === "bored")) return "sleep";
  switch (m) {
    case "happy": return "purr";
    case "content": return "sit";
    case "bored": return "lie";
    case "hungry": return "sad";
    case "lonely": return "sulk";
    case "sad": return "sad";
    case "sick": return "sick";
    case "overfed": return "belly";
  }
}

// ---------- где питомцы: у каждого один чат (chat/pets.py move) ----------
// Один запрос на все мои чаты (/api/pets/here/), дальше — события сокета:
// pet_moved (позвали, ушёл домой) и pet (покормили — шкала и настроение).
type Brief = PetBrief;
const inChats = new Map<string, Brief>(); // id питомца → он в одном из моих чатов
let hereAt = 0;
let hereLoading: Promise<void> | null = null;
let myPet: Brief | Pet | null | undefined; // undefined — ещё не спрашивали
let myPetFor = "";
const listeners = new Set<() => void>();
const TTL = 5 * 60_000;
const emit = () => listeners.forEach((f) => f());

export function rememberPet(pet: Brief | Pet): void {
  if (pet.chat_id) inChats.set(pet.id, { ...inChats.get(pet.id), ...pet });
  else inChats.delete(pet.id);
  if (myPet && myPet.id === pet.id) myPet = { ...myPet, ...pet };
  emit();
}

/** Завёл питомца (витрина): он и есть «мой питомец» — меню чата сразу его знает. */
export function rememberMyPet(pet: Pet): void {
  myPet = pet;
  rememberPet(pet);
}

/** Питомца удалили: убрать из чатов и из «моего питомца». */
export function forgetPet(id: string): void {
  inChats.delete(id);
  if (myPet && myPet.id === id) myPet = null;
  emit();
}

let socketBound = false;
function bindSocket() {
  if (socketBound) return;
  socketBound = true;
  onUserMessage((msg: { type?: string; data?: { type?: string; pet?: Brief; gone?: boolean } }) => {
    if (msg?.type !== "notification" || !msg.data?.pet) return;
    if (msg.data.type === "pet_moved" && msg.data.gone) forgetPet(msg.data.pet.id);
    else if (msg.data.type === "pet" || msg.data.type === "pet_moved") rememberPet(msg.data.pet);
  });
}

function loadHere(force = false): void {
  if (hereLoading || (!force && Date.now() - hereAt < TTL)) return;
  hereLoading = api.getPetsHere().then((list) => {
    hereAt = Date.now();
    inChats.clear();
    for (const p of list) if (p.chat_id) inChats.set(p.id, p);
    emit();
  }).catch(() => {}).finally(() => { hereLoading = null; });
}

function useStore(): void {
  const [, bump] = useState(0);
  useEffect(() => {
    bindSocket();
    const f = () => bump((n) => n + 1);
    listeners.add(f);
    loadHere();
    return () => { listeners.delete(f); };
  }, []);
}

/** Питомцы, которые сейчас в этом чате. */
export function useChatPets(chatId: string | null | undefined): Brief[] {
  useStore();
  if (!chatId) return [];
  return [...inChats.values()].filter((p) => p.chat_id === chatId);
}

/** Чаты, где сейчас есть питомец — лапка в списке чатов. */
export function usePetChats(): Set<string> {
  useStore();
  return new Set([...inChats.values()].map((p) => p.chat_id!).filter(Boolean));
}

/** Мой питомец (null — нет): позвать в чат из меню чата. */
export function useMyPet(userId: string | null | undefined): Brief | Pet | null {
  useStore();
  useEffect(() => {
    if (!userId || (myPet !== undefined && myPetFor === userId)) return;
    myPetFor = userId;
    api.getPetOf(userId).then((p) => { myPet = p; if (p) rememberPet(p); else emit(); }).catch(() => {});
  }, [userId]);
  return myPetFor === userId ? myPet ?? null : null;
}

// ---------- «Питомцы в чатах» у смотрящего (своя настройка, на этом устройстве) ----------
const HIDE_KEY = "hyax:pets-hidden";
/**
 * Питомцы есть везде, где есть веб-часть, в том числе на iPhone по воздуху:
 * правила Apple (DPLA 3.3.1(B)) разрешают загружать JS, если не меняется
 * назначение приложения. Сначала на iPhone они ждали сборки 197, по
 * решению пользователя ограничение снято. Выключатель оставлен: понадобится
 * спрятать питомцев на какой-то платформе — достаточно поменять здесь.
 */
export const petsAvailable = () => true;
export function usePetsAvailable(): boolean {
  return petsAvailable();
}

export const petsHidden = () => { try { return localStorage.getItem(HIDE_KEY) === "1"; } catch { return false; } };
export function setPetsHidden(on: boolean) {
  try { localStorage.setItem(HIDE_KEY, on ? "1" : "0"); } catch { /* без памяти */ }
  window.dispatchEvent(new CustomEvent("hyax:pets-hidden"));
}
export function usePetsHidden(): boolean {
  const [v, setV] = useState(petsHidden);
  useEffect(() => {
    const f = () => setV(petsHidden());
    window.addEventListener("hyax:pets-hidden", f);
    return () => window.removeEventListener("hyax:pets-hidden", f);
  }, []);
  return v;
}

// ---------- мурчание: синтез, без звуковых файлов ----------
let actx: AudioContext | null = null;
let purring = 0;

/** Мурлыканье ~1,6 с: шум в низких частотах, «пульс» ~26 раз в секунду. Тихо. */
/**
 * Звук — заранее, в простое, когда питомец показался. Первый new AudioContext
 * будит звуковое устройство и держит страницу сотни миллисекунд (на стенде —
 * 340 мс): на тапе это и тормозило, и съедало двойной тап. Созданный без жеста
 * контекст стоит на паузе — purr будит его resume() уже в обработчике тапа.
 */
export function warmPurr(): void {
  if (actx) return;
  const run = () => {
    if (actx) return;
    try {
      const AC = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (AC) actx = new AC();
    } catch { /* без звука */ }
  };
  const ric = (window as unknown as { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number }).requestIdleCallback;
  if (ric) ric(run, { timeout: 4000 }); else window.setTimeout(run, 1500);
}

/** Лёгкий «тык» на каждое нажатие, как у вкладок внизу: мурчание — мягкий гул
 *  (softRumble 0,2) и раз в секунду, рукой его почти не слышно. */
function tapHaptic(): void {
  if (Capacitor.isNativePlatform()) { Haptics.impact({ style: ImpactStyle.Light }).catch(() => {}); return; }
  try { navigator.vibrate?.(12); } catch { /* нет вибрации */ }
}

/**
 * Звук на тап по виду (manifest.sounds.tap): synth:purr — мурчание кота,
 * synth:chatter — довольный скрип зубами кролика. Вибрация — в обоих.
 * Пак без звука (пёс) — только вибрация, а не чужое мурчание; пак ещё не
 * загрузился — мурчание, как раньше.
 */
export function tapSound(pack: PetPack | null | undefined): void {
  tapHaptic();
  const s = pack?.sounds?.tap || pack?.sounds?.purr || (pack ? "" : "synth:purr");
  if (s === "synth:chatter") chatter();
  else if (s === "synth:purr") purr();
  else softRumble(500, 0.12);
}

/** Кролик доволен — мелко «скрипит» зубами: частые мягкие щелчки около 2 кГц. */
export function chatter(volume = 0.16): void {
  if (Date.now() - purring < 1100) return;
  purring = Date.now();
  softRumble(700, 0.14);
  try {
    const AC = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AC) return;
    actx ??= new AC();
    const ctx = actx;
    void ctx.resume().catch(() => {});
    const t0 = ctx.currentTime;
    const n = 11;
    for (let i = 0; i < n; i++) {
      const at = t0 + i * 0.075 + (Math.random() * 0.02);
      const len = 0.018;
      const buf = ctx.createBuffer(1, Math.ceil(ctx.sampleRate * len), ctx.sampleRate);
      const ch = buf.getChannelData(0);
      for (let j = 0; j < ch.length; j++) ch[j] = (Math.random() * 2 - 1) * (1 - j / ch.length);
      const src = ctx.createBufferSource();
      src.buffer = buf;
      const band = ctx.createBiquadFilter();
      band.type = "bandpass";
      band.frequency.value = 1800 + Math.random() * 600;
      band.Q.value = 4;
      const g = ctx.createGain();
      g.gain.value = volume * (0.7 + Math.random() * 0.3) * (i < 2 || i > n - 3 ? 0.6 : 1);
      src.connect(band).connect(g).connect(ctx.destination);
      src.start(at); src.stop(at + len);
    }
  } catch { /* без звука */ }
}

export function purr(volume = 0.22): void {
  if (Date.now() - purring < 1400) return;
  purring = Date.now();
  softRumble(1300, 0.2);
  try {
    const AC = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AC) return;
    actx ??= new AC();
    const ctx = actx;
    void ctx.resume().catch(() => {});
    const dur = 1.6;
    const buf = ctx.createBuffer(1, Math.ceil(ctx.sampleRate * dur), ctx.sampleRate);
    const ch = buf.getChannelData(0);
    for (let i = 0; i < ch.length; i++) ch[i] = Math.random() * 2 - 1;
    const src = ctx.createBufferSource();
    src.buffer = buf;
    const band = ctx.createBiquadFilter();
    band.type = "lowpass";
    band.frequency.value = 340;
    const pulse = ctx.createGain();
    pulse.gain.value = 0.5;
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 26;
    const lfoGain = ctx.createGain();
    lfoGain.gain.value = 0.5;
    lfo.connect(lfoGain).connect(pulse.gain);
    const env = ctx.createGain();
    const t0 = ctx.currentTime;
    env.gain.setValueAtTime(0.0001, t0);
    env.gain.exponentialRampToValueAtTime(volume, t0 + 0.18);
    env.gain.setValueAtTime(volume, t0 + dur - 0.45);
    env.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    src.connect(band).connect(pulse).connect(env).connect(ctx.destination);
    lfo.start(t0); src.start(t0);
    lfo.stop(t0 + dur); src.stop(t0 + dur);
  } catch { /* без звука */ }
}
