import { useEffect, useState } from "react";
import { readCache, writeCache } from "@/lib/session-cache";
import { api, type Profile } from "@/api/client";

/**
 * Нижнее меню как док на iPhone: какие вкладки и в каком порядке. Хранится в
 * профиле (nav_tabs), поэтому одинаково на всех устройствах; копия — в кеше
 * профиля, перемены разносит hyax:sections (его шлёт writeCache("user")).
 * Не настраивали — порядок темы: у «Мяты» чаты посередине, у остальных первыми.
 * Чаты и профиль убрать нельзя (через профиль открываются настройки). Что
 * убрано из меню, на телефоне показывается строкой в списке чатов.
 */
export type NavTab = "chat" | "wall" | "saved" | "music" | "profile";
export const NAV_TABS: NavTab[] = ["chat", "wall", "saved", "music", "profile"];
export const LOCKED_TABS = new Set<NavTab>(["chat", "profile"]);
const DEFAULTS: Record<"mint" | "plain", NavTab[]> = {
  mint: ["music", "saved", "chat", "wall", "profile"],
  plain: ["chat", "wall", "saved", "music", "profile"],
};

export const defaultTabs = (mint: boolean): NavTab[] => DEFAULTS[mint ? "mint" : "plain"];

function clean(v: unknown): NavTab[] | null {
  if (!Array.isArray(v)) return null;
  const out = v.filter((x, i): x is NavTab => NAV_TABS.includes(x as NavTab) && v.indexOf(x) === i);
  for (const must of LOCKED_TABS) if (!out.includes(must)) out.push(must);
  return out;
}

export const readNavTabs = (): NavTab[] | null => clean(readCache<Partial<Profile>>("user")?.nav_tabs);

/** Вкладки по порядку и настраивал ли их человек. */
export function useNavTabs(mint: boolean): { tabs: NavTab[]; custom: boolean } {
  const [custom, setCustom] = useState<NavTab[] | null>(readNavTabs);
  useEffect(() => {
    const on = () => setCustom(readNavTabs());
    window.addEventListener("hyax:sections", on);
    return () => window.removeEventListener("hyax:sections", on);
  }, []);
  return { tabs: custom || defaultTabs(mint), custom: !!custom };
}

/** Сохранить меню (null — по умолчанию): сразу на экране, затем на сервер; ошибка — откат. */
export async function setNavTabs(tabs: NavTab[] | null): Promise<boolean> {
  const u = readCache<Profile>("user");
  if (!u?.id) return false;
  const prev = u.nav_tabs ?? null;
  const apply = (v: string[] | null) => {
    const cur = readCache<Profile>("user");
    if (cur) writeCache("user", { ...cur, nav_tabs: v });
    window.dispatchEvent(new CustomEvent("hyax:profile-patch", { detail: { nav_tabs: v } }));
  };
  const next = tabs ? clean(tabs) : null;
  apply(next);
  try {
    await api.updateProfile(u.id, { nav_tabs: next });
    return true;
  } catch {
    apply(prev);
    return false;
  }
}
