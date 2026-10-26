import { t, getLang } from "@/lib/i18n";
import { writeClipboard } from "@/lib/clipboard";
import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";
import { useNavigate } from "react-router-dom";
import { X, Phone, Share2, Copy, ChevronRight, Flag, Ban, MessageSquare, LayoutGrid } from "lucide-react";
import { openMiniApp } from "@/lib/miniapp";
import ReportSheet from "@/components/ReportSheet";
import SavedGallery, { SavedTile, pluralPhotos } from "@/components/SavedGallery";
import type { SavedImage } from "@/api/client";
import Identicon from "@/components/Identicon";
import AvatarZoom from "@/components/AvatarZoom";
import { Aura, DEFAULT_AURA } from "@/components/Aura";
import { api, mediaUrl } from "@/api/client";
import { lastSeenText } from "@/lib/lastSeen";
import { shareProfile, profileLink } from "@/lib/share";
import ShareToChat from "@/components/ShareToChat";
import { toast } from "sonner";
import { useSwipeDismiss } from "@/lib/useSwipeDismiss";
import Vibometer from "@/components/Vibometer";
import { useMint, MintIcon, type MintIconName } from "@/themes/mint";
import ChatMediaSheet, { ChatMediaPreview } from "@/components/chat/ChatMediaSheet";
import type { MediaKind } from "@/api/client";

const LOCALE = { ru: "ru-RU", en: "en-US", ko: "ko-KR" } as const;

interface UserProfile {
  id: string;
  username: string;
  avatar_url?: string | null;
  cover_url?: string | null;
  is_online?: boolean;
  last_seen?: string | null;
  bio?: string | null;
  aura_color?: string | null;
  aura_text?: string | null;
  created_at?: string | null;
}

/**
 * Просмотр чужого профиля — только чтение: аватар, имя, статус (bio).
 * Открывается тапом по имени собеседника в шапке чата.
 */
const UserProfileModal = ({
  userId,
  onClose,
  onCall,
  chatId,
  onSearch,
  onJump,
}: {
  userId: string;
  onClose: () => void;
  onCall?: () => void;
  /** Личка с этим человеком — для вкладок вложений и «Показать в чате». */
  chatId?: string;
  /** Поиск по этой переписке (открыт из шапки чата). */
  onSearch?: () => void;
  onJump?: (messageId: string) => void;
}) => {
  // «Мята» на телефоне — полноэкранный профиль по макету; иначе шторка.
  const mint = useMint();
  const [mediaTab, setMediaTab] = useState<MediaKind | null>(null);
  const [moreOpen, setMoreOpen] = useState(false);
  const navigate = useNavigate();
  // Свайп вниз по шторке закрывает её — и мы снова там, откуда открыли профиль.
  const swipe = useSwipeDismiss(onClose);
  const [writing, setWriting] = useState(false);
  // «Написать» — как на карточке профиля в сообщении: личка (создаём или
  // находим) и переход в неё. Ботам тоже: с ними общаются в личке.
  const write = async () => {
    if (writing) return;
    setWriting(true);
    try {
      let chatId: string;
      if (isBot) {
        // Бот: «Начать» — личка и команда /start; без этого бот писать не может.
        chatId = (await api.startBot(userId)).chat_id;
      } else {
        try { chatId = (await api.createDirectChat(userId)).id; }
        catch (err: any) { if (err?.message === "exists" && err.chatId) chatId = err.chatId; else throw err; }
      }
      onClose();
      navigate("/chat", { state: { chatId, title: profile?.username } });
    } catch (e: any) { toast.error(e?.message || t("Не удалось открыть чат")); }
    finally { setWriting(false); }
  };
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const isBot = !!(profile as { is_bot?: boolean } | null)?.is_bot;
  const [loading, setLoading] = useState(true);
  const [saved, setSaved] = useState<{ count: number; items: SavedImage[] } | null>(null);
  const [galleryOpen, setGalleryOpen] = useState(false);
  // Профиль собеседника можно переслать прямо в хуяксе, не уходя наружу.
  const [shareOpen, setShareOpen] = useState(false);
  const [reportOpen, setReportOpen] = useState(false);
  // Заблокирован ли этот человек мной — кнопка переключается между
  // «Заблокировать» и «Разблокировать».
  const [blocked, setBlocked] = useState<boolean | null>(null);
  useEffect(() => {
    let alive = true;
    api.listBlocks().then((l) => alive && setBlocked(l.some((b) => b.id === userId))).catch(() => alive && setBlocked(false));
    return () => { alive = false; };
  }, [userId]);
  const toggleBlock = async () => {
    if (blocked === null) return;
    try {
      if (blocked) { await api.unblockUser(userId); toast.success(t("Разблокирован")); }
      else { await api.blockUser(userId); toast.success(t("Заблокирован: его сообщения и пуши больше не придут")); }
      setBlocked(!blocked);
    } catch (e: any) { toast.error(e?.message || t("Не получилось")); }
  };
  useEffect(() => {
    let alive = true;
    api.listSavedImages(userId, 5).then((d) => alive && setSaved(d)).catch(() => alive && setSaved({ count: 0, items: [] }));
    return () => { alive = false; };
  }, [userId]);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    api
      .getProfileById(userId)
      .then((p) => alive && setProfile(p))
      .catch(() => alive && setProfile(null))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [userId]);

  const copy = async (value: string) => {
    try { await writeClipboard(value); toast.success(t("Скопировано")); }
    catch { toast.error(t("Не удалось скопировать")); }
  };

  const extras = (
    <>
      {profile && (
        <ShareToChat
          open={shareOpen}
          title={t("Отправить профиль {name}", { name: profile.username })}
          text={profileLink(profile.username)}
          onClose={() => setShareOpen(false)}
          onShareOutside={async () => {
            const r = await shareProfile(profile.username);
            if (r === "copied") toast.success(t("Ссылка скопирована"));
            else if (r === "error") toast.error(t("Не удалось поделиться"));
          }}
        />
      )}
      {galleryOpen && profile && (
        <SavedGallery profileId={profile.id} own={false} title={t("Сохранёнки {name}", { name: profile.username })} onClose={() => setGalleryOpen(false)} />
      )}
      {reportOpen && (
        <ReportSheet target={{ type: "user", id: userId }} title={profile?.username ? t("Жалоба на {name}", { name: profile.username }) : t("Жалоба на пользователя")} onClose={() => setReportOpen(false)} />
      )}
      {mediaTab && chatId && profile && (
        <ChatMediaSheet chatId={chatId} title={profile.username} initialTab={mediaTab}
          onClose={() => setMediaTab(null)} onJump={(id) => { setMediaTab(null); onClose(); onJump?.(id); }} />
      )}
    </>
  );

  if (mint) {
    // Кнопки под именем (макет: 65×55, тёмно-зелёные, значок и подпись).
    // В шапке чата — «звонок» и «поиск» по переписке; вне чата первая — «написать».
    const acts: { key: string; icon: MintIconName | null; label: string; onClick: () => void; disabled?: boolean }[] = [
      ...(onCall ? [{ key: "call", icon: "actCall" as MintIconName, label: t("звонок"), onClick: () => { onCall(); onClose(); } }] : []),
      onSearch
        ? { key: "search", icon: "actSearch" as MintIconName, label: t("поиск"), onClick: () => { onClose(); onSearch(); } }
        : { key: "write", icon: null, label: writing ? t("Открываю…") : isBot ? t("Начать") : t("написать"), onClick: () => void write(), disabled: writing },
      { key: "block", icon: "actBlock" as MintIconName, label: blocked ? t("разблок") : t("блок"), onClick: () => void toggleBlock(), disabled: blocked === null },
      { key: "report", icon: "actReport" as MintIconName, label: t("жалоба"), onClick: () => setReportOpen(true) },
      { key: "more", icon: "actMore" as MintIconName, label: t("ещё"), onClick: () => setMoreOpen((v) => !v) },
    ];
    const webapp = isBot ? (profile as { webapp_url?: string; webapp_title?: string } | null) : null;
    const infoRows: [string, string, boolean][] = profile ? [
      [t("имя пользователя"), "@" + profile.username, true],
      ...(profile.bio ? [[t("о себе"), profile.bio, false] as [string, string, boolean]] : []),
      ...(profile.created_at ? [[t("дата регистрации"), new Date(profile.created_at).toLocaleDateString(LOCALE[getLang()] || "ru-RU"), false] as [string, string, boolean]] : []),
      [t("ID"), profile.id, true],
    ] : [];
    return (
      <div className="fixed inset-0 z-50 bg-background overflow-y-auto overscroll-contain" role="dialog" aria-label={profile?.username || t("Профиль")}>
        <button type="button" onClick={onClose} aria-label={t("Назад")}
          className="absolute z-10 left-[17px] mint-pill w-[44px] h-[33px] inline-flex items-center justify-center mint-muted"
          style={{ top: "calc(var(--sat) + 19px)" }}>
          <MintIcon name="back" size={[7, 13]} />
        </button>
        {loading ? (
          <div className="pt-40 text-center text-small text-subtle">{t("Загрузка…")}</div>
        ) : !profile ? (
          <div className="pt-40 text-center text-small text-subtle">{t("Не удалось загрузить профиль")}</div>
        ) : (
          <div className="pb-[calc(var(--sab)+24px)]" style={{ paddingTop: "calc(var(--sat) + 73px)" }}>
            {/* Обложка во всю ширину, аватар 98 свешивается с её низа на половину. */}
            <div className="h-[139px] w-full bg-surface-3 overflow-hidden" style={{ boxShadow: "0 4.3px 13.3px rgb(0 0 0 / 0.25)" }}>
              {profile.cover_url && <img src={mediaUrl(profile.cover_url)} alt="" className="w-full h-full object-cover" />}
            </div>
            <div className="flex justify-center -mt-[47px]">
              <AvatarZoom url={profile.avatar_url} name={profile.username}>
                <Aura active={!!profile.is_online} owner={profile} size={98}>
                  <Identicon id={profile.id} avatarUrl={profile.avatar_url} className="w-[98px] h-[98px] mint-call-avatar" />
                </Aura>
              </AvatarZoom>
            </div>
            <h2 className="mt-[12px] px-4 text-center text-[26.7px] leading-[30px] font-semibold truncate" style={{ color: "var(--mint-title)" }}>{profile.username}</h2>
            <p className={cn("mt-[4px] text-center text-[16px] truncate px-4", profile.is_online ? "text-online" : "text-[#9cb2ab]")}>
              {profile.is_online ? t("в сети") : lastSeenText(profile.last_seen)}
            </p>

            <div className="relative mt-[27px] px-[18px] flex justify-center gap-[8px]">
              {acts.map((a) => (
                <button key={a.key} type="button" onClick={a.onClick} disabled={a.disabled} aria-label={a.label}
                  className="mint-act flex-1 max-w-[65px] h-[55px] rounded-[20px] flex flex-col items-center justify-center gap-[4px] text-white disabled:opacity-60">
                  {a.icon ? <MintIcon name={a.icon} size={a.icon === "actMore" ? [28, 6] : [20, 20]} /> : <MessageSquare className="w-[20px] h-[20px]" />}
                  <span className="text-[11px] leading-[13px] max-w-full truncate px-1">{a.label}</span>
                </button>
              ))}
              {moreOpen && (
                <div className="absolute z-20 right-[18px] top-[calc(100%+8px)] mint-card mint-rows min-w-[220px] overflow-hidden" onClick={() => setMoreOpen(false)}>
                  <button type="button" onClick={() => setShareOpen(true)} className="w-full h-[48px] px-[19px] text-left text-[14.3px] mint-ink active:bg-black/5">{t("Поделиться профилем")}</button>
                  {onSearch && (
                    <button type="button" onClick={() => void write()} className="w-full h-[48px] px-[19px] text-left text-[14.3px] mint-ink active:bg-black/5">{isBot ? t("Начать") : t("Написать")}</button>
                  )}
                  {webapp?.webapp_url && (
                    <button type="button" onClick={() => { const pr = profile; onClose(); void openMiniApp({ botId: pr.id, botName: pr.username }); }} className="w-full h-[48px] px-[19px] text-left text-[14.3px] mint-ink active:bg-black/5">{webapp.webapp_title || t("Приложение")}</button>
                  )}
                </div>
              )}
            </div>

            <div className="mt-[24px] px-[17px] space-y-[11px]">
              {/* Сведения: подпись 13.3 px, значение 16 px, строки ~68 px с чертой между. */}
              <div className="mint-card mint-rows overflow-hidden">
                {infoRows.map(([label, value, copyable]) => (
                  <button key={label} type="button" onClick={copyable ? () => void copy(value) : undefined}
                    className={cn("w-full min-h-[68px] px-[19px] py-[12px] flex items-center gap-3 text-left", copyable && "active:bg-black/5")}>
                    <span className="min-w-0 flex-1">
                      <span className="block text-[13.3px] leading-[17px] mint-ink opacity-80">{label}</span>
                      <span className={cn("block text-[16px] leading-[21px] mint-ink break-words", copyable && "truncate")}>{value}</span>
                    </span>
                    {copyable && <MintIcon name="rowCopy" size={16} className="mint-muted" />}
                  </button>
                ))}
              </div>

              {!isBot && <Vibometer profileId={profile.id} username={profile.username} initial={(profile as { vibe?: number }).vibe} />}

              {saved && saved.count > 0 && (
                <div className="mint-card overflow-hidden">
                  <div className="px-[19px] pt-[14px] flex items-center">
                    <span className="flex-1 text-[13.3px] mint-ink">{t("сохранёнки")}</span>
                    <span className="text-[13.3px] mint-muted">{pluralPhotos(saved.count)}</span>
                  </div>
                  <div className="px-[19px] pt-[15px] pb-[16px] grid grid-cols-3 gap-[11px]">
                    {saved.items.slice(0, 3).map((it) => (
                      <SavedTile key={it.id} item={it} className="aspect-square w-full rounded-[20px]" onClick={() => setGalleryOpen(true)} />
                    ))}
                  </div>
                  <button type="button" onClick={() => setGalleryOpen(true)} className="w-full h-[44px] px-[19px] flex items-center justify-between text-[13.3px] mint-muted active:bg-black/5" style={{ boxShadow: "inset 0 1px 0 var(--mint-divider)" }}>
                    {t("все сохранёнки")}
                    <MintIcon name="chevron" size={[5, 10]} />
                  </button>
                </div>
              )}

              {chatId && !isBot && (
                <div className="pt-[8px]"><ChatMediaPreview chatId={chatId} onOpenAll={(k) => setMediaTab(k)} /></div>
              )}
            </div>
          </div>
        )}
        {extras}
      </div>
    );
  }

  return (
    <div
      className="fixed inset-0 z-50 bg-black/60 md:bg-black/30 flex items-end md:items-start md:justify-end md:p-4"
      onClick={onClose}
    >
      {/* Телефон — шторка снизу; десктоп — боковая панель во всю высоту, как
          колонка профиля в референсе. Поверхности: панель surface-2, карточки и
          вторичные кнопки surface-4, чтобы читались на панели. */}
      <div
        // На телефоне шторка не выше 85% экрана: с сохранёнками и длинным
        // «О себе» она раньше вырастала во весь экран. Лишнее прокручивается
        // внутри, шапка с аватаром остаётся под пальцем.
        ref={swipe.ref}
        className="w-full md:w-[400px] max-h-[85vh] md:max-h-full overflow-y-auto overscroll-contain bg-surface-2 md:bg-surface-1 rounded-t-[16px] md:rounded-lg md:border md:border-border p-6 md:p-5 pb-[calc(var(--sab)+24px)] md:pb-5 relative"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="md:hidden absolute top-2 left-1/2 -translate-x-1/2 w-9 h-1 rounded-full bg-foreground/20" aria-hidden />
        <button
          type="button"
          onClick={onClose}
          className="absolute top-4 right-4 p-1.5 text-subtle hover:text-foreground"
          aria-label={t("Закрыть")}
        >
          <X className="w-4 h-4" />
        </button>

        {loading ? (
          <div className="py-10 text-center text-small text-subtle">{t("Загрузка…")}</div>
        ) : profile ? (
          <div className="space-y-6">
            {/* Обложка — такая же, как человек видит у себя в профиле. */}
            {profile.cover_url && (
              <div className="-mx-6 md:-mx-5 -mt-6 md:-mt-5 h-28 bg-surface-3 overflow-hidden md:rounded-t-lg">
                <img src={mediaUrl(profile.cover_url)} alt="" className="w-full h-full object-cover" />
              </div>
            )}
            <div className="flex items-center gap-5 pr-8">
              <AvatarZoom url={profile.avatar_url} name={profile.username}>
                <Aura active={!!profile.is_online} owner={profile} size={104}>
                  <Identicon id={profile.id} avatarUrl={profile.avatar_url} className="w-[104px] h-[104px] rounded-lg shrink-0" />
                </Aura>
              </AvatarZoom>
              <div className="min-w-0">
                <h2 className="text-[24px] leading-tight font-semibold text-foreground truncate">{profile.username}</h2>
                <p className={`mt-1 text-small truncate ${profile.is_online ? "text-online" : "text-subtle"}`}>
                  {profile.is_online ? t("в сети") : lastSeenText(profile.last_seen)}
                </p>
                {/* Значение ауры — здесь его видно и на телефоне, где нет наведения. */}
                {profile.aura_text && (
                  <p className="mt-1 text-small text-foreground flex items-center gap-1.5 min-w-0">
                    <span className="w-2.5 h-2.5 rounded-full shrink-0"
                      style={{ background: profile.aura_color || DEFAULT_AURA, opacity: profile.is_online ? 1 : 0.45 }} aria-hidden />
                    <span className="truncate">{profile.aura_text}</span>
                  </p>
                )}
                <p className="mt-1 text-body text-subtle truncate">{profile.bio ? profile.bio.split("\n")[0] : t("Статус не указан")}</p>
              </div>
            </div>

            {/* Действия одним рядом: на телефоне только иконки (подписи не влезали —
                пять кнопок шли в два ряда, баг-репорт fde2b313), на компьютере — с подписями. */}
            <div className="flex gap-2">
              {([
                { key: "write", onClick: write, disabled: writing, primary: true, icon: <MessageSquare className="w-5 h-5 md:w-4 md:h-4" />,
                  label: writing ? t("Открываю…") : isBot ? t("Начать") : t("Написать") },
                ...(isBot && (profile as { webapp_url?: string } | null)?.webapp_url ? [{
                  key: "app", onClick: () => { const pr = profile!; onClose(); void openMiniApp({ botId: pr.id, botName: pr.username }); }, primary: false,
                  icon: <LayoutGrid className="w-5 h-5 md:w-4 md:h-4" />, label: (profile as { webapp_title?: string }).webapp_title || t("Приложение") }] : []),
                ...(onCall ? [{ key: "call", onClick: () => { onCall(); onClose(); }, primary: true, icon: <Phone className="w-5 h-5 md:w-4 md:h-4" />, label: t("Позвонить") }] : []),
                { key: "share", onClick: () => setShareOpen(true), primary: false, icon: <Share2 className="w-5 h-5 md:w-4 md:h-4" />, label: t("Поделиться") },
                { key: "report", onClick: () => setReportOpen(true), primary: false, icon: <Flag className="w-5 h-5 md:w-4 md:h-4" />, label: t("Пожаловаться") },
                { key: "block", onClick: toggleBlock, disabled: blocked === null, primary: false, accent: true, icon: <Ban className="w-5 h-5 md:w-4 md:h-4" />,
                  label: blocked ? t("Разблокировать") : t("Заблокировать") },
              ] as { key: string; onClick: () => void; disabled?: boolean; primary: boolean; accent?: boolean; icon: React.ReactNode; label: string }[]).map((b) => (
                <button
                  key={b.key}
                  type="button"
                  onClick={b.onClick}
                  disabled={b.disabled}
                  aria-label={b.label}
                  title={b.label}
                  className={cn(
                    "flex-1 min-w-0 h-11 md:h-9 rounded-md font-medium md:text-small flex items-center justify-center gap-2 active:opacity-90 hover:brightness-110 disabled:opacity-60",
                    b.primary ? "bg-primary text-primary-foreground" : b.accent ? "bg-surface-4 text-primary" : "bg-surface-4 text-foreground",
                  )}
                >
                  {b.icon}
                  <span className="hidden md:inline truncate">{b.label}</span>
                </button>
              ))}
            </div>

            <div className="border-t border-border" />

            {!(profile as { is_bot?: boolean }).is_bot && <Vibometer profileId={profile.id} username={profile.username} initial={(profile as { vibe?: number }).vibe} />}

            {profile.bio && (
              <div className="rounded-lg bg-surface-4 p-4">
                <p className="text-h2 mb-2">{t("О себе")}</p>
                <p className="text-body text-muted-foreground whitespace-pre-wrap break-words">{profile.bio}</p>
              </div>
            )}

            {saved && saved.count > 0 && (
            <div className="rounded-lg bg-surface-4 p-4">
              <div className="flex items-center gap-2">
                <span className="text-h2 flex-1">{t("Сохранёнки")}</span>
                <span className="text-small text-subtle">{pluralPhotos(saved.count)}</span>
              </div>
              {saved.items.length > 0 ? (
                <div className="mt-3 grid grid-cols-5 gap-1.5">
                  {saved.items.map((it) => <SavedTile key={it.id} item={it} className="aspect-square w-full rounded-[8px] ring-1 ring-border" onClick={() => setGalleryOpen(true)} />)}
                </div>
              ) : (
                <p className="mt-2 text-small text-subtle"></p>
              )}
              <button type="button" onClick={() => setGalleryOpen(true)} className="mt-3 -mb-4 -mx-4 px-4 h-11 w-[calc(100%+32px)] border-t border-border flex items-center text-body active:bg-surface-3">
                <span className="flex-1 text-left">{t("Все сохранёнки")}</span>
                <ChevronRight className="w-4 h-4 text-subtle" />
              </button>
            </div>
            )}

            <div className="rounded-lg bg-surface-4 p-4">
              <p className="text-h2 mb-2">{t("Информация")}</p>
              {[
                [t("Имя пользователя"), "@" + profile.username],
                [t("ID пользователя"), profile.id],
                ...(profile.created_at ? [[t("Дата регистрации"), new Date(profile.created_at).toLocaleDateString(LOCALE[getLang()] || "ru-RU")]] : []),
              ].map(([label, value]) => (
                <div key={label} className="flex items-center gap-3 h-9 md:h-8">
                  <span className="text-small text-subtle w-32 shrink-0">{label}</span>
                  <span className="text-small text-muted-foreground flex-1 min-w-0 truncate">{value}</span>
                  <button type="button" onClick={() => copy(value)} className="p-1.5 text-subtle active:text-foreground" aria-label={t("Скопировать: {label}", { label })}>
                    <Copy className="w-4 h-4" />
                  </button>
                </div>
              ))}
            </div>
          </div>
        ) : (
          <div className="py-10 text-center text-small text-subtle">{t("Не удалось загрузить профиль")}</div>
        )}
      </div>
      {extras}
    </div>
  );
};

export default UserProfileModal;
