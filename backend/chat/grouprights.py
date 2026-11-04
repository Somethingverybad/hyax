"""Админы группы и их права (как в Telegram).

Владелец группы — её создатель (Chat.creator): может всё и один удаляет
группу. Админы — участники с ChatParticipant.role = "admin" и списком прав
ChatParticipant.rights:
  • info   — название, фото, звук и питомцы группы (ChatViewSet.configure);
  • add    — добавлять участников;
  • remove — удалять участников (не владельца и не других админов);
  • delete — удалять чужие сообщения у всех;
  • admins — назначать админов и менять их права, но только в пределах своих.
Группа без владельца (старые) — как было: настраивать и добавлять людей
может любой участник, удалять людей и чужие сообщения — никто.
"""
from __future__ import annotations

GROUP_RIGHTS = ("info", "add", "remove", "delete", "admins")
# Группа без владельца: права каждого участника.
NO_OWNER_RIGHTS = ("info", "add")


def is_group_chat(chat) -> bool:
    """Группа, а не канал и не служебный чат. Личка, в которую добавили третьего,
    становится группой с kind="direct" (ChatViewSet.add_participants)."""
    return bool(getattr(chat, "is_group", False)) and getattr(chat, "kind", "") in ("group", "direct")


def clean_rights(raw) -> list[str]:
    """Только известные права, в порядке GROUP_RIGHTS."""
    want = {str(r) for r in (raw or []) if isinstance(r, str)}
    return [r for r in GROUP_RIGHTS if r in want]


def rights_from(chat, profile_id, role: str | None, rights) -> set[str]:
    """Права по уже известной роли участника (без запроса в базу).
    role=None — не участник."""
    if not is_group_chat(chat) or role is None:
        return set()
    if not chat.creator_id:
        return set(NO_OWNER_RIGHTS)
    if chat.creator_id == profile_id:
        return set(GROUP_RIGHTS)
    if role == "admin":
        return set(clean_rights(rights))
    return set()


def group_rights(chat, profile) -> set[str]:
    """Права профиля в группе (один запрос, если он не владелец)."""
    if not profile or not is_group_chat(chat):
        return set()
    if chat.creator_id == profile.id:
        return set(GROUP_RIGHTS)
    from .models import ChatParticipant
    cp = ChatParticipant.objects.filter(chat=chat, user=profile).only("role", "rights").first()
    if not cp:
        return set()
    return rights_from(chat, profile.id, cp.role, cp.rights)
