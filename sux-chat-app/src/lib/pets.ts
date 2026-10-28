import { useEffect, useState } from "react";
import { Capacitor } from "@capacitor/core";
import { App } from "@capacitor/app";
import { api, type Pet, type PetBrief, type PetMood } from "@/api/client";
import { t } from "@/lib/i18n";
import { onUserMessage } from "@/lib/userSocket";

/**
 * Питомцы на клиенте: пак вида (рисунки и поведение) и состояние с сервера.
 *
 * Пак — public/pets/<вид>/manifest.json + по файлу Lottie на позу (формат —
 * design/pets/README.md, пример — design/pets/cat/make_cat.py). Новое животное —
 * новый пак, код не меняется. Пак едет с веб-частью, в том числе по воздуху.
 *
 * Правила (шкала, уход раз в сутки, вайб, напоминания) — на сервере, chat/pets.py.
 */

export type PoseName = "sit" | "purr" | "walk" | "lie" | "sleep" | "belly" | "scratch" | "bury" | "eat" | "sad" | "sick" | "sulk";

export interface PetPose {
  file: string;
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
}

const base = () => (import.meta.env.BASE_URL || "/").replace(/\/?$/, "/");
const packs = new Map<string, Promise<PetPack>>();
const poses = new Map<string, Promise<unknown>>();

export function loadPack(species: string): Promise<PetPack> {
  let p = packs.get(species);
  if (!p) {
    p = fetch(`${base()}pets/${species}/manifest.json`).then((r) => {
      if (!r.ok) throw new Error(`pet pack ${species}: ${r.status}`);
      return r.json();
    });
    p.catch(() => packs.delete(species));
    packs.set(species, p);
  }
  return p;
}

/** Данные Lottie позы (кэш на весь сеанс). Нет такой позы в паке — «сидит». */
export async function loadPose(species: string, pose: PoseName): Promise<{ data: unknown; pose: PetPose; pack: PetPack }> {
  const pack = await loadPack(species);
  const meta = pack.poses[pose] || pack.poses.sit!;
  const key = `${species}/${meta.file}`;
  let d = poses.get(key);
  if (!d) {
    d = fetch(`${base()}pets/${species}/${meta.file}${pack.rev ? `?r=${pack.rev}` : ""}`).then((r) => r.json());
    d.catch(() => poses.delete(key));
    poses.set(key, d);
  }
  return { data: await d, pose: meta, pack };
}

export function petDisplayName(pet: { name?: string | null }, pack?: PetPack | null, lang = "ru"): string {
  return pet.name || pack?.defaultName?.[lang] || pack?.defaultName?.ru || t("Питомец");
}

/** Подпись и цвет настроения. */
export function moodInfo(m: PetMood): { label: string; color: string } {
  switch (m) {
    case "happy": return { label: t("Счастлив"), color: "#2BB673" };
    case "content": return { label: t("Доволен"), color: "#5FB44E" };
    case "bored": return { label: t("Скучает"), color: "#C9A227" };
    case "hungry": return { label: t("Голоден"), color: "#E08A2E" };
    case "lonely": return { label: t("Обиделся"), color: "#D9733B" };
    case "sad": return { label: t("Грустит"), color: "#C8553D" };
    case "sick": return { label: t("Приболел"), color: "#B23A48" };
    case "overfed": return { label: t("Объелся"), color: "#8E7CC3" };
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

// ---------- питомцы участников чатов: общий кэш и обновления по сокету ----------
type Brief = PetBrief;
const byOwner = new Map<string, { pet: Brief | null; at: number }>();
const listeners = new Set<() => void>();
const TTL = 5 * 60_000;
const emit = () => listeners.forEach((f) => f());

export function rememberPet(pet: Brief | Pet): void {
  byOwner.set(pet.owner_id, { pet, at: Date.now() });
  emit();
}

let socketBound = false;
function bindSocket() {
  if (socketBound) return;
  socketBound = true;
  onUserMessage((msg: { type?: string; data?: { type?: string; pet?: Brief } }) => {
    if (msg?.type === "notification" && msg.data?.type === "pet" && msg.data.pet) rememberPet(msg.data.pet);
  });
}

/** Питомцы этих людей, которых показывают в переписке (не чаще раза в 5 минут на человека). */
export function useChatPets(ownerIds: string[]): Brief[] {
  const key = ownerIds.filter(Boolean).sort().join(",");
  const [, bump] = useState(0);
  useEffect(() => {
    bindSocket();
    const f = () => bump((n) => n + 1);
    listeners.add(f);
    return () => { listeners.delete(f); };
  }, []);
  useEffect(() => {
    const ids = key ? key.split(",") : [];
    const stale = ids.filter((id) => { const c = byOwner.get(id); return !c || Date.now() - c.at > TTL; });
    if (!stale.length) return;
    let off = false;
    api.getPets(stale).then((list) => {
      if (off) return;
      const now = Date.now();
      for (const id of stale) byOwner.set(id, { pet: list.find((p) => p.owner_id === id) ?? null, at: now });
      emit();
    }).catch(() => {});
    return () => { off = true; };
  }, [key]);
  return (key ? key.split(",") : []).map((id) => byOwner.get(id)?.pet).filter((p): p is Brief => !!p && p.show_in_chats);
}

// ---------- «Питомцы в чатах» у смотрящего (своя настройка, на этом устройстве) ----------
const HIDE_KEY = "hyax:pets-hidden";
/**
 * На iPhone питомцы — крупная новая функция, и по правилам Apple она приезжает
 * сборкой через TestFlight, а не по воздуху: в сборках до IOS_MIN_BUILD их нет
 * (ни в профиле, ни в чатах, ни в настройках). Android, компьютеры и сайт — сразу.
 */
const IOS_MIN_BUILD = 197;
let available: boolean | null = Capacitor.getPlatform() === "ios" ? null : true;
const availWaiters = new Set<() => void>();
if (available === null) {
  App.getInfo()
    .then((i) => { available = (parseInt(i.build, 10) || 0) >= IOS_MIN_BUILD; })
    .catch(() => { available = false; })
    .finally(() => availWaiters.forEach((f) => f()));
}
export const petsAvailable = () => available === true;
export function usePetsAvailable(): boolean {
  const [v, setV] = useState(petsAvailable);
  useEffect(() => {
    if (available !== null) { setV(petsAvailable()); return; }
    const f = () => setV(petsAvailable());
    availWaiters.add(f);
    return () => { availWaiters.delete(f); };
  }, []);
  return v;
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
export function purr(volume = 0.22): void {
  if (Date.now() - purring < 1400) return;
  purring = Date.now();
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
