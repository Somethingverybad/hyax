import { useEffect, useState } from "react";
import { api } from "@/api/client";

/**
 * Кого я заблокировал — общий список на всё приложение. Сервер новые сообщения
 * и посты заблокированного уже не отдаёт, но то, что загружено раньше (лента,
 * кэш переписки), иначе висело бы до перезагрузки. По правилу App Store 1.2
 * блокировка убирает контент сразу — ленты фильтруют по этому списку.
 */
let blocked = new Set<string>();
let loaded = false;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((f) => f());

function load() {
  if (loaded) return;
  loaded = true;
  api.listBlocks().then((list) => { blocked = new Set(list.map((b) => b.id)); emit(); }).catch(() => { loaded = false; });
}

export function setBlockedLocal(profileId: string, on: boolean) {
  const next = new Set(blocked);
  if (on) next.add(profileId); else next.delete(profileId);
  blocked = next;
  emit();
}

export const isBlockedLocal = (profileId?: string | null) => !!profileId && blocked.has(profileId);

export function useBlocked(): Set<string> {
  const [v, setV] = useState(blocked);
  useEffect(() => {
    const f = () => setV(blocked);
    listeners.add(f);
    load();
    f();
    return () => { listeners.delete(f); };
  }, []);
  return v;
}
