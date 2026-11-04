/**
 * Права админа группы (сервер — chat/grouprights.py). Владелец (создатель)
 * может всё; админ — то, что ему выдали; остальные — ничего.
 */
export type GroupRight = "info" | "add" | "remove" | "delete" | "admins";

/** Порядок, подписи и пояснения (ключи перевода). */
export const GROUP_RIGHTS: { key: GroupRight; label: string; hint?: string }[] = [
  { key: "info", label: "Изменять группу", hint: "Название, фото, звук и питомцы" },
  { key: "add", label: "Добавлять участников" },
  { key: "remove", label: "Удалять участников", hint: "Кроме владельца и других админов" },
  { key: "delete", label: "Удалять чужие сообщения", hint: "У всех участников" },
  { key: "admins", label: "Назначать админов", hint: "Только с теми правами, что есть у него самого" },
];

export const ALL_GROUP_RIGHTS: GroupRight[] = GROUP_RIGHTS.map((r) => r.key);

/** Мои права в группе: владелец — все, иначе то, что отдал сервер (my_rights). */
export function myGroupRights(group: { creator?: string | null; my_rights?: string[] | null } | null | undefined, userId?: string | null): GroupRight[] {
  if (!group) return [];
  if (userId && String(group.creator ?? "") === String(userId)) return ALL_GROUP_RIGHTS;
  return (group.my_rights || []).filter((r): r is GroupRight => (ALL_GROUP_RIGHTS as string[]).includes(r));
}
