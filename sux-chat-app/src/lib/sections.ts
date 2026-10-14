import { useEffect, useState } from "react";
import { readCache, writeCache } from "@/lib/session-cache";
import { api, type Profile } from "@/api/client";

/**
 * Разделы, которые можно скрыть: «Стена» (вкладка внизу и строка в чатах) и
 * «Долгий ящик» (строка в чатах). Хранятся в профиле — wall_enabled и
 * ideabox_enabled, поэтому переезжают между устройствами; копия — в кеше
 * профиля. Перемены разносит событие hyax:sections: его шлёт writeCache("user")
 * (профиль пришёл с сервера или его поправили), а setSection дополнительно
 * шлёт hyax:profile-patch — страница чатов держит свою копию профиля и иначе
 * записала бы в кеш старое значение.
 */
export type SectionKey = "wall" | "ideabox";
export type Sections = Record<SectionKey, boolean>;
const FIELD = { wall: "wall_enabled", ideabox: "ideabox_enabled" } as const;

export function readSections(): Sections {
  const u = readCache<Partial<Profile>>("user");
  return { wall: u?.wall_enabled !== false, ideabox: u?.ideabox_enabled !== false };
}

export function useSections(): Sections {
  const [s, setS] = useState<Sections>(readSections);
  useEffect(() => {
    const on = () => setS(readSections());
    window.addEventListener("hyax:sections", on);
    return () => window.removeEventListener("hyax:sections", on);
  }, []);
  return s;
}

/** Показать или скрыть раздел: сразу на экране, затем на сервер; ошибка — откат. */
export async function setSection(key: SectionKey, on: boolean): Promise<boolean> {
  const u = readCache<Profile>("user");
  if (!u?.id) return false;
  const field = FIELD[key];
  const prev = u[field];
  const apply = (v: boolean | undefined) => {
    const cur = readCache<Profile>("user");
    if (cur) writeCache("user", { ...cur, [field]: v });
    window.dispatchEvent(new CustomEvent("hyax:profile-patch", { detail: { [field]: v } }));
  };
  apply(on);
  try {
    await api.updateProfile(u.id, { [field]: on });
    return true;
  } catch {
    apply(prev);
    return false;
  }
}
