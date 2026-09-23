"""Жалобы: приём, доставка в системный чат и состав получателей.

Жалоба не уходит в отдельную «панель модератора», которую надо не забывать
открывать. Она приходит сообщением в чат «Жалобы» — обычный чат приложения,
куда попадают все с ролью support или admin. Разбор идёт там же, где и вся
остальная переписка, и уведомление приходит так же, как обычное сообщение.

Отправитель — системный бот: у сообщений должен быть автор, а подставлять
жалобщика нельзя (в чате его имя видеть незачем, да и отвечать ему оттуда
некому).
"""
import logging

from django.contrib.auth.models import User

from .models import Chat, ChatParticipant, Message, Profile, Report

logger = logging.getLogger(__name__)

SYSTEM_BOT_USERNAME = "reports"
REPORTS_CHAT_NAME = "Жалобы"
SYSTEM_KIND = "system"


def system_bot():
    """Бот-отправитель системных сообщений. Владельца у него нет: он ничей."""
    bot = Profile.objects.filter(username=SYSTEM_BOT_USERNAME, is_bot=True).first()
    if bot:
        return bot
    user = User.objects.filter(username=SYSTEM_BOT_USERNAME).first()
    if not user:
        user = User.objects.create(username=SYSTEM_BOT_USERNAME, email=f"{SYSTEM_BOT_USERNAME}@bot.local", is_active=False)
        user.set_unusable_password()
        user.save()
    return Profile.objects.create(
        user=user,
        username=SYSTEM_BOT_USERNAME,
        is_bot=True,
        bio="Системный бот: присылает жалобы пользователей",
    )


BUGS_CHAT_NAME = "Баг-репорты"


def system_chat(name):
    """Системный чат с данным именем. Создаётся при первом обращении."""
    chat = Chat.objects.filter(kind=SYSTEM_KIND, name=name).first()
    if not chat:
        chat = Chat.objects.create(kind=SYSTEM_KIND, name=name, is_group=True)
    return chat


def reports_chat():
    """Системный чат «Жалобы»."""
    return system_chat(REPORTS_CHAT_NAME)


def sync_staff_membership(chat=None):
    """Состав системного чата = бот плюс все с ролью support/admin.

    Без аргумента пересобирает все системные чаты. Вызывается при выдаче роли
    и при каждой доставке: роль могли поменять в админке, и новый человек
    должен увидеть чаты без ручных действий. Тех, у кого роль забрали, убираем
    — иначе он остался бы с доступом.
    """
    if chat is None:
        for c in Chat.objects.filter(kind=SYSTEM_KIND):
            sync_staff_membership(c)
        return reports_chat()
    staff = set(
        Profile.objects.filter(role__in=[Profile.ROLE_SUPPORT, Profile.ROLE_ADMIN]).values_list("id", flat=True)
    )
    staff.add(system_bot().id)

    # У ChatParticipant участник лежит в поле user (это Profile), а его role —
    # про место в чате (owner/member), не про роль профиля. Не путать.
    current = set(ChatParticipant.objects.filter(chat=chat).values_list("user_id", flat=True))
    for pid in staff - current:
        ChatParticipant.objects.get_or_create(chat=chat, user_id=pid)
    if current - staff:
        ChatParticipant.objects.filter(chat=chat, user_id__in=list(current - staff)).delete()
    return chat


def _describe(report):
    """Текст сообщения в чат. Со снимком: на что жаловались, могут удалить."""
    who = report.reporter.username if report.reporter else "неизвестно"
    lines = [
        f"🚩 {report.get_reason_display()}",
        f"Объект: {report.get_target_type_display()} {report.target_id}",
        f"От: {who}",
    ]
    if report.target_profile:
        lines.append(f"На кого: {report.target_profile.username}")
    if report.comment:
        lines.append(f"Комментарий: {report.comment}")
    if report.snapshot:
        lines.append("")
        lines.append(f"Содержимое на момент жалобы:\n{report.snapshot}")
    lines.append("")
    lines.append(f"id жалобы: {report.id}")
    return "\n".join(lines)


def deliver_bug(bug, origin):
    """Баг-репорт — сообщением в чат «Баг-репорты». origin — базовый URL API,
    чтобы ссылки на скриншот и лог открывались из чата."""
    try:
        chat = sync_staff_membership(system_chat(BUGS_CHAT_NAME))
        meta = bug.meta or {}
        who = bug.reporter.username if bug.reporter else "неизвестно"
        lines = [
            f"🐞 Баг-репорт от {who}",
            f"{meta.get('platform', '?')} · {meta.get('app_version', '?')} (сборка {meta.get('app_build', '?')})",
        ]
        if meta.get("device"):
            lines.append(f"Устройство: {meta['device']}")
        if meta.get("screen"):
            lines.append(f"Экран: {meta['screen']}")
        if bug.description:
            lines.append("")
            lines.append(bug.description)
        lines.append("")
        if bug.screenshot_url:
            lines.append(f"Скриншот: {origin}{bug.screenshot_url}")
        if bug.log_url:
            lines.append(f"Лог: {origin}{bug.log_url}")
        lines.append(f"id: {bug.id}")
        return Message.objects.create(chat=chat, sender=system_bot(), content="\n".join(lines))
    except Exception:
        logger.exception("Баг-репорт %s сохранён, но не доставлен в чат", bug.id)
        return None


def deliver(report: Report):
    """Кладёт жалобу сообщением в чат «Жалобы». Ошибку глотаем намеренно:
    жалоба уже сохранена в базе, и сбой доставки не должен возвращать
    пользователю ошибку отправки."""
    try:
        chat = sync_staff_membership()
        return Message.objects.create(chat=chat, sender=system_bot(), content=_describe(report))
    except Exception:
        logger.exception("Жалоба %s сохранена, но не доставлена в чат", report.id)
        return None


# ---- Блокировка ----

def blocked_ids(profile):
    """Кого этот профиль заблокировал. Их сообщения ему не показываем,
    их пуши до него не доходят — во всех точках выдачи, а не только в одной."""
    from .models import Block
    return set(Block.objects.filter(blocker=profile).values_list("blocked_id", flat=True))


def can_see_saved(owner_id, viewer_id) -> bool:
    """Видит ли viewer сохранёнки owner'а. Своё видно всегда; «все» — любому
    вошедшему, «избранные» — только из списка SavedViewer, «никто» — никому.
    Правило одно на все точки выдачи: и список в профиле, и сама картинка по
    подписанной ссылке (см. SavedImagesView, MediaSignView)."""
    from .models import Profile, SavedViewer
    if str(owner_id) == str(viewer_id):
        return True
    mode = Profile.objects.filter(id=owner_id).values_list("saved_visibility", flat=True).first()
    if mode is None or mode == "all":
        return True
    if mode == "none":
        return False
    return SavedViewer.objects.filter(owner_id=owner_id, viewer_id=viewer_id).exists()


def blocked_either_way(a_id, b_id):
    """Есть ли блокировка между двумя людьми в любую сторону: личку в таком
    случае не открываем — иначе заблокированный писал бы в пустоту, а
    заблокировавший получал бы «новый чат» от того, кого закрыл."""
    from .models import Block
    from django.db.models import Q
    return Block.objects.filter(
        Q(blocker_id=a_id, blocked_id=b_id) | Q(blocker_id=b_id, blocked_id=a_id)
    ).exists()
