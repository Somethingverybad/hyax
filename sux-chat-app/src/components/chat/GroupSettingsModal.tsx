import { t } from "@/lib/i18n";
import { useEffect, useRef, useState } from "react";
import { Aura } from "@/components/Aura";
import { X, Camera, UserPlus, UserMinus, Users, Check, Music2 } from "lucide-react";
import { confirmDialog } from "@/lib/confirm";
import SoundPickerSheet from "@/components/SoundPicker";
import type { NotificationSoundInfo } from "@/api/client";
import Identicon from "@/components/Identicon";
import UserProfileModal from "@/components/UserProfileModal";
import { api, mediaUrl } from "@/api/client";
import { toast } from "sonner";
import CachedImg from "@/components/CachedImg";
import { isAnimatedFile } from "@/lib/animMedia";

interface Person { id: string; username: string; avatar_url?: string | null }

/**
 * Настройки группы. Админ (создатель) меняет название, аватар и добавляет
 * участников; остальные видят состав только на просмотр.
 */
const GroupSettingsModal = ({
  chatId,
  userId,
  isAdmin,
  ownerId,
  initialName,
  initialAvatar,
  initialSound,
  onClose,
  onUpdated,
}: {
  chatId: string;
  /** Свой id — свою строку в списке не открываем карточкой. */
  userId?: string;
  isAdmin: boolean;
  /** Владелец группы (создатель): удаляет участников и меняет настройки. */
  ownerId?: string | null;
  initialName: string;
  initialAvatar?: string | null;
  /** Общий звук уведомлений группы (задаёт админ). */
  initialSound?: NotificationSoundInfo | null;
  onClose: () => void;
  onUpdated: (patch: { name?: string; avatar_url?: string | null }) => void;
}) => {
  const [name, setName] = useState(initialName);
  const [avatar, setAvatar] = useState<string | null>(initialAvatar ?? null);
  const [members, setMembers] = useState<Person[]>([]);
  const [saving, setSaving] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Person[]>([]);
  const fileRef = useRef<HTMLInputElement>(null);
  const [sound, setSound] = useState<NotificationSoundInfo | null>(initialSound ?? null);
  const [soundOpen, setSoundOpen] = useState(false);
  const pickSound = async (s: NotificationSoundInfo | null) => {
    setSoundOpen(false);
    const prev = sound;
    setSound(s);
    try {
      await api.configureGroup(chatId, { notifySoundId: s ? s.id : null });
      toast.success(s ? t("Все участники услышат «{name}»", { name: s.name }) : t("Обычный звук"));
    } catch { setSound(prev); toast.error(t("Не удалось сохранить")); }
  };
  // Тап по участнику открывает его карточку — ту же, что из шапки личного чата.
  const [profileFor, setProfileFor] = useState<string | null>(null);

  useEffect(() => {
    api.getChatParticipants(chatId).then(setMembers).catch(() => {});
    // Состав поменялся (удалили, вышел, сменился владелец) — перечитать.
    const on = (e: Event) => { if ((e as CustomEvent).detail?.chat_id === chatId) api.getChatParticipants(chatId).then(setMembers).catch(() => {}); };
    window.addEventListener("hyax:group", on);
    return () => window.removeEventListener("hyax:group", on);
  }, [chatId]);

  const [removing, setRemoving] = useState<string | null>(null);
  const removeMember = async (m: Person) => {
    if (!(await confirmDialog(t("Удалить {name} из группы? Группа у этого человека пропадёт, вернуть его можно через «Добавить».", { name: m.username })))) return;
    setRemoving(m.id);
    try {
      await api.removeGroupMember(chatId, m.id);
      setMembers((prev) => prev.filter((x) => x.id !== m.id));
      toast.success(t("{name} больше не в группе", { name: m.username }));
      onUpdated({});
    } catch (err: any) {
      toast.error(err?.message || t("Не получилось"));
    } finally {
      setRemoving(null);
    }
  };

  const pickAvatar = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setSaving(true);
    try {
      // GIF и видео — видео-аватар: сервер сделает квадрат и mp4 до 5 секунд.
      const up = isAnimatedFile(file) ? await api.uploadAnimatedAvatar(file) : await api.uploadFile(file, undefined, undefined, true);
      const updated = await api.configureGroup(chatId, { avatarUrl: up.file_url });
      setAvatar(updated.avatar_url ?? null);
      onUpdated({ avatar_url: updated.avatar_url ?? null });
      toast.success(t("Аватар обновлён"));
    } catch (err: any) {
      toast.error(err?.message || t("Не удалось загрузить аватар"));
    } finally {
      setSaving(false);
    }
  };

  const saveName = async () => {
    const n = name.trim();
    if (!n || n === initialName) return;
    setSaving(true);
    try {
      const updated = await api.configureGroup(chatId, { name: n });
      onUpdated({ name: updated.name });
      toast.success(t("Название сохранено"));
    } catch (err: any) {
      toast.error(err?.message || t("Не удалось сохранить"));
    } finally {
      setSaving(false);
    }
  };

  const search = async (q: string) => {
    setQuery(q);
    if (!q.trim()) { setResults([]); return; }
    try {
      const found = await api.searchUsers(q);
      const have = new Set(members.map((m) => m.id));
      setResults((Array.isArray(found) ? found : []).filter((p: Person) => !have.has(p.id)));
    } catch { setResults([]); }
  };

  const addMember = async (p: Person) => {
    try {
      await api.addChatParticipants(chatId, [p.id]);
      setMembers((prev) => [...prev, p]);
      setResults((prev) => prev.filter((r) => r.id !== p.id));
      toast.success(t("{name} добавлен", { name: p.username }));
    } catch (err: any) {
      toast.error(err?.message || t("Не удалось добавить"));
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4" onClick={onClose}>
      <div
        className="w-full max-w-sm max-h-[85vh] overflow-y-auto bg-card border border-border rounded-2xl p-5 relative"
        onClick={(e) => e.stopPropagation()}
      >
        <button type="button" onClick={onClose} className="absolute top-3 right-3 p-2 text-muted-foreground hover:text-foreground" aria-label={t("Закрыть")}>
          <X className="w-5 h-5" />
        </button>

        {/* Аватар */}
        <div className="flex flex-col items-center">
          <button
            type="button"
            onClick={() => isAdmin && fileRef.current?.click()}
            disabled={!isAdmin || saving}
            className="relative w-24 h-24 rounded-2xl overflow-hidden bg-secondary flex items-center justify-center"
          >
            {avatar ? (
              <CachedImg src={mediaUrl(avatar)} alt="" className="w-full h-full object-cover" />
            ) : (
              <Users className="w-10 h-10 text-primary" />
            )}
            {isAdmin && (
              <span className="absolute bottom-1 right-1 bg-primary text-primary-foreground p-1 rounded-full">
                <Camera className="w-3 h-3" />
              </span>
            )}
          </button>
          <input ref={fileRef} type="file" accept="image/*,video/*" className="hidden" onChange={pickAvatar} />
        </div>

        {/* Название */}
        <div className="mt-4">
          {isAdmin ? (
            <div className="flex items-center gap-2">
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                onBlur={saveName}
                onKeyDown={(e) => e.key === "Enter" && saveName()}
                className="flex-1 bg-secondary border-2 border-border rounded-lg px-3 py-2 text-center font-semibold"
                placeholder={t("Название группы")}
              />
              {name.trim() && name !== initialName && (
                <button type="button" onClick={saveName} className="p-2 text-primary" aria-label={t("Сохранить")}>
                  <Check className="w-5 h-5" />
                </button>
              )}
            </div>
          ) : (
            <h2 className="text-center text-xl font-bold">{name || t("Группа")}</h2>
          )}
        </div>

        {/* Звук группы: с ним все её сообщения приходят у всех участников. */}
        {isAdmin ? (
          <button type="button" onClick={() => setSoundOpen(true)} className="mt-4 w-full flex items-center gap-3 py-2.5 text-left">
            <Music2 className="w-5 h-5 text-primary shrink-0" />
            <span className="min-w-0 flex-1">
              <span className="block text-sm font-medium">{t("Звук уведомлений группы")}</span>
              <span className="block text-xs text-muted-foreground truncate">{sound ? sound.name : t("Обычный — выбери свой, его услышат все участники")}</span>
            </span>
          </button>
        ) : sound ? (
          <div className="mt-4 flex items-center gap-3 py-2.5">
            <Music2 className="w-5 h-5 text-primary shrink-0" />
            <span className="text-sm">{t("Звук группы")}: {sound.name}</span>
          </div>
        ) : null}
        {soundOpen && (
          <SoundPickerSheet title={t("Звук уведомлений группы")} current={sound?.id || null} onClose={() => setSoundOpen(false)} onPick={(s) => void pickSound(s)} />
        )}

        {/* Участники */}
        <div className="mt-5">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs uppercase tracking-wide text-muted-foreground font-semibold">
              {t("Участники")} · {members.length}
            </span>
            {isAdmin && (
              <button type="button" onClick={() => setAddOpen((v) => !v)} className="flex items-center gap-1 text-sm text-primary">
                <UserPlus className="w-4 h-4" /> {t("Добавить")}
              </button>
            )}
          </div>

          {addOpen && isAdmin && (
            <div className="mb-3">
              <input
                value={query}
                onChange={(e) => search(e.target.value)}
                placeholder={t("Поиск по нику…")}
                className="w-full bg-secondary border-2 border-border rounded-lg px-3 py-2 text-sm"
              />
              {results.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => addMember(p)}
                  className="w-full flex items-center gap-2 px-2 py-2 rounded-lg active:bg-secondary text-left"
                >
                  <Aura active={!!(p as { is_online?: boolean }).is_online} owner={p as never} size={32}><Identicon id={p.id} avatarUrl={p.avatar_url} className="w-8 h-8" /></Aura>
                  <span className="text-sm">{p.username}</span>
                  <UserPlus className="w-4 h-4 ml-auto text-primary" />
                </button>
              ))}
            </div>
          )}

          <div className="space-y-1">
            {[...members].sort((a, b) => Number(b.id === ownerId) - Number(a.id === ownerId)).map((m) => (
              <div key={m.id} className="flex items-center gap-1">
                <button
                  type="button"
                  disabled={m.id === userId}
                  onClick={() => setProfileFor(m.id)}
                  className="flex-1 min-w-0 flex items-center gap-2 px-2 py-1.5 rounded-md text-left active:bg-surface-3 disabled:active:bg-transparent"
                >
                  <Aura active={!!(m as { is_online?: boolean }).is_online} owner={m as never} size={32}><Identicon id={m.id} avatarUrl={m.avatar_url} className="w-8 h-8" /></Aura>
                  <span className="text-sm truncate flex-1">{m.username}</span>
                  {m.id === ownerId && <span className="text-caption text-primary shrink-0">{t("владелец")}</span>}
                  {m.id === userId && <span className="text-caption text-subtle shrink-0">{t("вы")}</span>}
                </button>
                {isAdmin && m.id !== userId && (
                  <button
                    type="button"
                    disabled={removing === m.id}
                    onClick={() => void removeMember(m)}
                    aria-label={t("Удалить {name} из группы", { name: m.username })}
                    className="shrink-0 p-2 rounded-md text-subtle active:text-destructive active:bg-surface-3 disabled:opacity-40"
                  >
                    <UserMinus className="w-4 h-4" />
                  </button>
                )}
              </div>
            ))}
          </div>
        </div>
      </div>
      {/* Карточка поверх настроек. Клики внутри неё не должны доходить до
          подложки настроек — иначе тап мимо карточки закрыл бы и настройки. */}
      {profileFor && (
        <div onClick={(e) => e.stopPropagation()}>
          <UserProfileModal userId={profileFor} onClose={() => setProfileFor(null)} />
        </div>
      )}
    </div>
  );
};

export default GroupSettingsModal;
