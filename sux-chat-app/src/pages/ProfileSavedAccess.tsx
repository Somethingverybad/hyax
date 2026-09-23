import { useEffect, useState } from "react";
import ScreenHeader from "@/components/ScreenHeader";
import { SettingsCard, SettingsRow } from "@/components/settings";
import Identicon from "@/components/Identicon";
import { api, type Profile } from "@/api/client";
import { readCache, writeCache } from "@/lib/session-cache";
import { toast } from "sonner";
import { Check, Search, X } from "lucide-react";

type Person = { id: string; username: string; avatar_url?: string | null };

const MODES: { value: NonNullable<Profile["saved_visibility"]>; label: string; hint: string }[] = [
  { value: "all", label: "Все", hint: "Сохранёнки видит любой, кто открыл профиль" },
  { value: "selected", label: "Избранные люди", hint: "Только те, кого вы добавили в список" },
  { value: "none", label: "Никто", hint: "Сохранёнки видите только вы" },
];

/**
 * Кто видит сохранёнки. Настройка на весь раздел сразу: «все», «избранные
 * люди» со списком или «никто». Список нужен только в режиме «избранные», но
 * он не стирается при переключении — вернулись к нему, и люди на месте.
 */
const ProfileSavedAccess = () => {
  const [profile, setProfile] = useState<Profile | null>(readCache<Profile>("user"));
  const [viewers, setViewers] = useState<Person[] | null>(null);
  const [query, setQuery] = useState("");
  // Люди из переписок: по ним ищем прямо на устройстве. Поиск на сервере
  // намеренно точный (ник целиком) — каталога пользователей нет, чтобы никто
  // не перебирал всех по буквам, — поэтому по части ника он ничего не найдёт.
  const [people, setPeople] = useState<Person[]>([]);
  const [byNick, setByNick] = useState<Person[]>([]);
  const [searching, setSearching] = useState(false);

  useEffect(() => {
    api.getCurrentUser().then((p) => { setProfile(p); writeCache("user", p); }).catch(() => {});
    api.listSavedViewers().then(setViewers).catch(() => setViewers([]));
    api.getChats()
      .then((chats) => {
        const me = readCache<Profile>("user")?.id;
        const seen = new Map<string, Person>();
        for (const c of chats) {
          if (c.kind === "channel") continue;
          for (const p of c.participants || []) {
            if (p.id !== me && !p.is_bot && !seen.has(p.id)) {
              seen.set(p.id, { id: p.id, username: p.username, avatar_url: p.avatar_url });
            }
          }
        }
        setPeople([...seen.values()].sort((a, b) => a.username.localeCompare(b.username)));
      })
      .catch(() => setPeople([]));
  }, []);

  const mode = profile?.saved_visibility || "all";

  const setMode = async (value: NonNullable<Profile["saved_visibility"]>) => {
    if (!profile || value === mode) return;
    const prev = profile;
    const next = { ...profile, saved_visibility: value };
    setProfile(next); writeCache("user", next);
    try {
      await api.updateProfile(prev.id, { saved_visibility: value });
    } catch {
      toast.error("Не удалось сохранить");
      setProfile(prev); writeCache("user", prev);
    }
  };

  const q = query.trim().replace(/^@/, "").toLowerCase();
  const fromChats = q
    ? people.filter((p) => p.username.toLowerCase().includes(q))
    : people;

  // Человека, с которым переписки ещё нет, находим по нику целиком — так
  // устроен поиск на сервере. Спрашиваем его, только если среди собеседников
  // никого похожего не нашлось.
  useEffect(() => {
    if (q.length < 2 || fromChats.length > 0) { setByNick([]); return; }
    setSearching(true);
    const t = setTimeout(() => {
      api.searchUsers(q)
        .then((list) => setByNick(list.filter((p) => p.id !== profile?.id).slice(0, 5)))
        .catch(() => setByNick([]))
        .finally(() => setSearching(false));
    }, 400);
    return () => clearTimeout(t);
  }, [q, fromChats.length, profile?.id]);

  const found = [...fromChats, ...byNick].filter((p) => !viewers?.some((v) => v.id === p.id)).slice(0, 20);

  const add = async (p: Person) => {
    if (viewers?.some((v) => v.id === p.id)) return;
    setViewers((l) => [...(l || []), p]);
    setQuery(""); setByNick([]);
    try { await api.addSavedViewer(p.id); }
    catch (e: any) {
      toast.error(e?.message || "Не получилось");
      setViewers((l) => (l || []).filter((v) => v.id !== p.id));
    }
  };

  const remove = async (p: Person) => {
    const before = viewers || [];
    setViewers(before.filter((v) => v.id !== p.id));
    try { await api.removeSavedViewer(p.id); }
    catch { toast.error("Не получилось"); setViewers(before); }
  };

  return (
    <div className="h-screen flex flex-col bg-background">
      <ScreenHeader title="Кто видит сохранёнки" />
      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-3">
        <SettingsCard>
          {MODES.map((m) => (
            <SettingsRow
              key={m.value}
              label={m.label}
              hint={m.hint}
              onClick={() => void setMode(m.value)}
              trailing={mode === m.value ? <Check className="w-5 h-5 text-primary shrink-0" /> : undefined}
            />
          ))}
        </SettingsCard>

        {mode === "selected" && (
          <>
            <p className="px-1 pt-2 text-small text-subtle">Кому открыто</p>
            <SettingsCard>
              {viewers === null ? (
                <div className="px-4 py-4 text-small text-subtle">Загрузка…</div>
              ) : viewers.length === 0 ? (
                <div className="px-4 py-4 text-small text-subtle">Пока никого. Сохранёнки видите только вы — найдите человека ниже и добавьте.</div>
              ) : viewers.map((p) => (
                <div key={p.id} className="min-h-14 px-4 py-2 flex items-center gap-3">
                  <Identicon id={p.id} avatarUrl={p.avatar_url} className="w-9 h-9 rounded-md shrink-0" />
                  <span className="flex-1 text-body truncate">{p.username}</span>
                  <button type="button" onClick={() => void remove(p)} className="text-small text-primary active:opacity-60">Убрать</button>
                </div>
              ))}
            </SettingsCard>

            <div className="ui-card rounded-lg bg-surface-2 border border-border p-3 space-y-2">
              <div className="flex items-center gap-2 h-10 px-3 rounded-md bg-surface-4">
                <Search className="w-4 h-4 text-subtle shrink-0" />
                <input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Имя или ник"
                  className="flex-1 bg-transparent outline-none text-body min-w-0"
                  aria-label="Поиск человека"
                />
                {query && (
                  <button type="button" onClick={() => setQuery("")} className="text-subtle" aria-label="Очистить">
                    <X className="w-4 h-4" />
                  </button>
                )}
              </div>
              {found.length === 0 && searching && <p className="text-small text-subtle px-1">Ищу…</p>}
              {found.length === 0 && !searching && (
                <p className="text-small text-subtle px-1">
                  {q
                    ? "Никого не нашлось. С кем переписки ещё не было — введите ник целиком."
                    : "Здесь люди, с которыми у вас есть переписка. Кого нет в списке — введите его ник целиком."}
                </p>
              )}
              {found.map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => void add(p)}
                    disabled={viewers?.some((v) => v.id === p.id)}
                    className="w-full min-h-12 px-1 py-1 flex items-center gap-3 text-left active:opacity-70 disabled:opacity-50"
                  >
                    <Identicon id={p.id} avatarUrl={p.avatar_url} className="w-8 h-8 rounded-md shrink-0" />
                    <span className="flex-1 text-body truncate">{p.username}</span>
                    <span className="text-small text-subtle">добавить</span>
                  </button>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
};

export default ProfileSavedAccess;
