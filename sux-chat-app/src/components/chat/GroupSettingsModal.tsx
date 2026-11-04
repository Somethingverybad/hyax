import { t } from "@/lib/i18n";
import { useEffect, useRef, useState } from "react";
import { Aura } from "@/components/Aura";
import { X, Camera, UserPlus, UserMinus, Users, Check, Music2, PawPrint, Minus, Plus, Shield } from "lucide-react";
import { GROUP_RIGHTS, type GroupRight } from "@/lib/groupRights";
import { rememberPet, useChatPets, usePetsAvailable } from "@/lib/pets";
import { confirmDialog } from "@/lib/confirm";
import SoundPickerSheet from "@/components/SoundPicker";
import type { NotificationSoundInfo } from "@/api/client";
import Identicon from "@/components/Identicon";
import UserProfileModal from "@/components/UserProfileModal";
import { api, mediaUrl } from "@/api/client";
import { toast } from "sonner";
import CachedImg from "@/components/CachedImg";
import { isAnimatedFile } from "@/lib/animMedia";

interface Person {
  id: string; username: string; avatar_url?: string | null;
  /** Роль в группе и права админа (сервер — participants, chat/grouprights.py). */
  group_role?: "owner" | "admin" | "member";
  group_rights?: GroupRight[];
}

/** Права админа: галочки, сохранить, снять с админов. Выдать можно только
 *  свои права (у владельца — все). */
const AdminRightsSheet = ({ chatId, person, mine, onClose, onSaved }: {
  chatId: string; person: Person; mine: GroupRight[]; onClose: () => void;
  onSaved: (role: "admin" | "member", rights: GroupRight[]) => void;
}) => {
  const isAdmin = person.group_role === "admin";
  const [picked, setPicked] = useState<GroupRight[]>(isAdmin ? person.group_rights || [] : mine.filter((r) => r !== "admins"));
  const [busy, setBusy] = useState(false);
  const toggle = (r: GroupRight) => setPicked((p) => (p.includes(r) ? p.filter((x) => x !== r) : [...p, r]));
  const save = async () => {
    setBusy(true);
    try {
      const res = await api.setGroupAdmin(chatId, person.id, picked);
      onSaved("admin", res.group_rights as GroupRight[]);
      toast.success(t("{name} — админ группы", { name: person.username }));
    } catch (err) {
      toast.error((err as Error)?.message || t("Не получилось"));
    } finally { setBusy(false); }
  };
  const demote = async () => {
    setBusy(true);
    try {
      await api.removeGroupAdmin(chatId, person.id);
      onSaved("member", []);
      toast.success(t("{name} больше не админ", { name: person.username }));
    } catch (err) {
      toast.error((err as Error)?.message || t("Не получилось"));
    } finally { setBusy(false); }
  };
  return (
    <div className="fixed inset-0 z-[60] bg-black/50 flex items-end sm:items-center justify-center" onClick={(e) => { e.stopPropagation(); onClose(); }}>
      <div role="dialog" aria-label={t("Права админа")} className="w-full sm:max-w-sm bg-card border border-border rounded-t-2xl sm:rounded-2xl p-5 pb-[calc(var(--sab,0px)+20px)]" onClick={(e) => e.stopPropagation()}>
        <h3 className="text-lg font-bold">{t("Права: {name}", { name: person.username })}</h3>
        <div className="mt-3 space-y-1">
          {GROUP_RIGHTS.map((r) => {
            const allowed = mine.includes(r.key);
            return (
              <label key={r.key} className={`flex items-start gap-3 py-2 ${allowed ? "" : "opacity-50"}`}>
                <input type="checkbox" className="mt-0.5 w-5 h-5 accent-primary shrink-0" disabled={!allowed || busy}
                  checked={picked.includes(r.key)} onChange={() => toggle(r.key)} />
                <span className="min-w-0">
                  <span className="block text-sm font-medium">{t(r.label)}</span>
                  {r.hint && <span className="block text-xs text-muted-foreground">{t(r.hint)}</span>}
                </span>
              </label>
            );
          })}
        </div>
        <button type="button" onClick={() => void save()} disabled={busy || !picked.length}
          className="mt-4 w-full h-11 rounded-xl bg-primary text-primary-foreground font-semibold disabled:opacity-50">
          {isAdmin ? t("Сохранить") : t("Назначить админом")}
        </button>
        {isAdmin && (
          <button type="button" onClick={() => void demote()} disabled={busy}
            className="mt-2 w-full h-11 rounded-xl text-destructive font-semibold disabled:opacity-50">
            {t("Снять с админов")}
          </button>
        )}
      </div>
    </div>
  );
};

const PET_LIMIT_MAX = 10; // как на сервере (chat/pets.py)

/**
 * Настройки группы. Что можно менять — по моим правам (lib/groupRights):
 * владелец может всё, админ — выданное (название и прочее, добавлять,
 * удалять участников, назначать админов); остальные видят только состав.
 */
const GroupSettingsModal = ({
  chatId,
  userId,
  rights,
  ownerId,
  initialName,
  initialAvatar,
  initialSound,
  initialPetLimit = 3,
  onClose,
  onUpdated,
}: {
  chatId: string;
  /** Свой id — свою строку в списке не открываем карточкой. */
  userId?: string;
  /** Мои права в группе (lib/groupRights). */
  rights: GroupRight[];
  /** Владелец группы (создатель): удаляет участников и меняет настройки. */
  ownerId?: string | null;
  initialName: string;
  initialAvatar?: string | null;
  /** Общий звук уведомлений группы (задаёт админ). */
  initialSound?: NotificationSoundInfo | null;
  /** Сколько питомцев одновременно (chat/pets.py); 0 — выключены. */
  initialPetLimit?: number;
  onClose: () => void;
  onUpdated: (patch: { name?: string; avatar_url?: string | null }) => void;
}) => {
  const canInfo = rights.includes("info"), canAdd = rights.includes("add"), canRemove = rights.includes("remove"), canAdmins = rights.includes("admins");
  const iOwn = !!userId && String(ownerId ?? "") === String(userId);
  const [rightsFor, setRightsFor] = useState<Person | null>(null);
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
  // Питомцы: лимит меняет владелец; уменьшил — лишние (пришедшие последними) уходят домой на сервере.
  const petsOn = usePetsAvailable();
  const petsHere = useChatPets(petsOn ? chatId : null);
  const [petLimit, setPetLimit] = useState(initialPetLimit);
  const changePetLimit = async (n: number) => {
    const next = Math.max(0, Math.min(PET_LIMIT_MAX, n));
    if (next === petLimit) return;
    const prev = petLimit;
    setPetLimit(next);
    try { await api.configureGroup(chatId, { petLimit: next }); }
    catch (e) { setPetLimit(prev); toast.error((e as Error).message || t("Не получилось")); }
  };
  const petHome = async (petId: string) => {
    try { rememberPet(await api.sendPetHome(petId)); }
    catch (e) { toast.error((e as Error).message || t("Не получилось")); }
  };
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

  const rank = (m: Person) => (m.id === ownerId ? 2 : m.group_role === "admin" ? 1 : 0);
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
            onClick={() => canInfo && fileRef.current?.click()}
            disabled={!canInfo || saving}
            className="relative w-24 h-24 rounded-2xl overflow-hidden bg-secondary flex items-center justify-center"
          >
            {avatar ? (
              <CachedImg src={mediaUrl(avatar)} alt="" className="w-full h-full object-cover" />
            ) : (
              <Users className="w-10 h-10 text-primary" />
            )}
            {canInfo && (
              <span className="absolute bottom-1 right-1 bg-primary text-primary-foreground p-1 rounded-full">
                <Camera className="w-3 h-3" />
              </span>
            )}
          </button>
          <input ref={fileRef} type="file" accept="image/*,video/*" className="hidden" onChange={pickAvatar} />
        </div>

        {/* Название */}
        <div className="mt-4">
          {canInfo ? (
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
        {canInfo ? (
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

        {/* Питомцы в группе: сколько одновременно и кто сейчас здесь. */}
        {petsOn && (
          <div className="mt-4">
            <div className="flex items-center gap-3 py-2.5">
              <PawPrint className="w-5 h-5 text-primary shrink-0" />
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-medium">{t("Питомцы в группе")}</span>
                <span className="block text-xs text-muted-foreground">
                  {petLimit === 0 ? t("Выключены — позвать питомца сюда нельзя") : t("Одновременно — до {n}", { n: petLimit })}
                </span>
              </span>
              {canInfo && (
                <span className="shrink-0 flex items-center gap-1">
                  <button type="button" onClick={() => void changePetLimit(petLimit - 1)} disabled={petLimit <= 0}
                    className="w-8 h-8 rounded-full bg-surface-2 grid place-items-center disabled:opacity-40" aria-label={t("Меньше питомцев")}>
                    <Minus className="w-4 h-4" />
                  </button>
                  <span className="w-6 text-center text-sm font-semibold tabular-nums">{petLimit}</span>
                  <button type="button" onClick={() => void changePetLimit(petLimit + 1)} disabled={petLimit >= PET_LIMIT_MAX}
                    className="w-8 h-8 rounded-full bg-surface-2 grid place-items-center disabled:opacity-40" aria-label={t("Больше питомцев")}>
                    <Plus className="w-4 h-4" />
                  </button>
                </span>
              )}
            </div>
            {petsHere.length > 0 && (
              <div className="pl-8 space-y-1">
                {petsHere.map((p) => {
                  const owner = members.find((m) => m.id === p.owner_id)?.username || "";
                  return (
                    <div key={p.id} className="flex items-center gap-2 text-sm">
                      <span className="min-w-0 flex-1 truncate">
                        {p.name || t("питомец {owner}", { owner })}
                        {owner && <span className="text-muted-foreground"> · {owner}</span>}
                      </span>
                      {canInfo && (
                        <button type="button" onClick={() => void petHome(p.id)} className="shrink-0 text-xs text-primary px-2 py-1">{t("Домой")}</button>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* Участники */}
        <div className="mt-5">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs uppercase tracking-wide text-muted-foreground font-semibold">
              {t("Участники")} · {members.length}
            </span>
            {canAdd && (
              <button type="button" onClick={() => setAddOpen((v) => !v)} className="flex items-center gap-1 text-sm text-primary">
                <UserPlus className="w-4 h-4" /> {t("Добавить")}
              </button>
            )}
          </div>

          {addOpen && canAdd && (
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
            {/* Сверху владелец, за ним админы. */}
            {[...members].sort((a, b) => rank(b) - rank(a)).map((m) => (
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
                  {m.id !== ownerId && m.group_role === "admin" && <span className="text-caption text-primary shrink-0">{t("админ")}</span>}
                  {m.id === userId && <span className="text-caption text-subtle shrink-0">{t("вы")}</span>}
                </button>
                {canAdmins && m.id !== userId && m.id !== ownerId && (
                  <button
                    type="button"
                    onClick={() => setRightsFor(m)}
                    aria-label={m.group_role === "admin" ? t("Права админа") : t("Назначить админом")}
                    title={m.group_role === "admin" ? t("Права админа") : t("Назначить админом")}
                    className={`shrink-0 p-2 rounded-md active:bg-surface-3 ${m.group_role === "admin" ? "text-primary" : "text-subtle"}`}
                  >
                    <Shield className="w-4 h-4" />
                  </button>
                )}
                {/* Удалить: владельца — никто, админа — только владелец. */}
                {canRemove && m.id !== userId && m.id !== ownerId && (m.group_role !== "admin" || iOwn) && (
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
      {rightsFor && (
        <AdminRightsSheet chatId={chatId} person={rightsFor} mine={rights} onClose={() => setRightsFor(null)}
          onSaved={(role, r) => {
            setMembers((prev) => prev.map((x) => (x.id === rightsFor.id ? { ...x, group_role: role, group_rights: r } : x)));
            setRightsFor(null);
          }} />
      )}
      {profileFor && (
        <div onClick={(e) => e.stopPropagation()}>
          <UserProfileModal userId={profileFor} onClose={() => setProfileFor(null)} />
        </div>
      )}
    </div>
  );
};

export default GroupSettingsModal;
