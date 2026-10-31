import { useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { Bell, ChevronLeft, ChevronRight, Lock, MessageSquare, Mic, Music2, Newspaper, Bookmark, Palette, Phone, Plus, Search, Settings, User } from "lucide-react";
import { t } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { paintTheme } from "@/themes/engine";
import { MintIcon } from "@/themes/mint";
import type { ThemeDef } from "@/themes/types";

/**
 * Предпросмотр темы в редакторе: три экрана (чаты, переписка, настройки),
 * нарисованные теми же классами, что настоящие, — у стиля soft это раскладка
 * «Мяты» (таблетки, карточки, остров навигации), у остальных — классическая.
 * Тема красит только эту рамку (paintTheme на обёртке), не всё приложение;
 * целиком её показывает «Примерить».
 */
type Tab = "chats" | "chat" | "settings";
const TABS: [Tab, string][] = [["chats", "Чаты"], ["chat", "Переписка"], ["settings", "Настройки"]];

const PEOPLE = [
  { name: "Аня", text: "Встречаемся в семь у входа?", time: "18:40", unread: 2, hue: 32 },
  { name: "Команда WYX", text: "Новая тема готова — смотрите!", time: "17:05", unread: 0, hue: 150 },
  { name: "Мама", text: "Купи, пожалуйста, хлеба", time: "12:31", unread: 1, hue: 280 },
  { name: "Даня", text: "🎵 Голосовое сообщение", time: "вчера", unread: 0, hue: 200 },
];

const Avatar = ({ hue, size = 40 }: { hue: number; size?: number }) => (
  <span className="rounded-full shrink-0" style={{ width: size, height: size, background: `linear-gradient(135deg, hsl(${hue} 70% 62%), hsl(${hue + 30} 60% 45%))` }} />
);

export default function ThemeShowcase({ theme, height = 420 }: { theme: ThemeDef; height?: number }) {
  const box = useRef<HTMLDivElement>(null);
  const [tab, setTab] = useState<Tab>("chats");
  useLayoutEffect(() => { if (box.current) paintTheme(box.current, theme); }, [theme]);
  const soft = theme.shape.style === "soft";

  return (
    <div className="space-y-2">
      <div className="flex rounded-md bg-surface-2 p-0.5">
        {TABS.map(([id, label]) => (
          <button key={id} type="button" onClick={() => setTab(id)} aria-pressed={tab === id}
            className={cn("flex-1 h-8 rounded text-small font-medium", tab === id ? "bg-primary text-primary-foreground" : "text-subtle")}>
            {t(label)}
          </button>
        ))}
      </div>
      <div ref={box} className="theme-showcase relative overflow-hidden rounded-[22px] border border-border bg-background text-foreground select-none pointer-events-none"
        style={{ height }} aria-hidden>
        {soft ? <SoftScreen tab={tab} /> : <ClassicScreen tab={tab} />}
      </div>
    </div>
  );
}

// ---------- «Мята» (soft) ----------
function SoftScreen({ tab }: { tab: Tab }) {
  return (
    <div className="h-full flex flex-col" style={{ background: "linear-gradient(180deg, hsl(var(--background)), hsl(var(--chat-canvas)))" }}>
      {tab === "chats" && (
        <>
          <div className="mint-head">
            <span className="mint-pill mint-btn mint-ink">{t("Изм.")}</span>
            <span className="mint-title">{t("Чаты")}</span>
            <span className="mint-lime mint-round"><Plus className="w-5 h-5" /></span>
          </div>
          <div className="px-4 space-y-2">
            <div className="mint-pill h-9 px-3 flex items-center gap-2 text-[13px] mint-muted"><Search className="w-4 h-4" />{t("Поиск")}</div>
            <div className="flex gap-2">
              <span className="mint-lime mint-btn">{t("Все")}</span>
              <span className="mint-pill mint-btn mint-ink">{t("Непрочитанные")}</span>
              <span className="mint-pill mint-btn mint-ink">{t("Каналы")}</span>
            </div>
          </div>
          <div className="mx-3 mt-3 mint-card overflow-hidden">
            {PEOPLE.map((p, i) => (
              <div key={p.name}>
                {i > 0 && <div className="mint-divider mx-3" />}
                <div className="flex items-center gap-3 px-3 py-2.5">
                  <Avatar hue={p.hue} />
                  <span className="flex-1 min-w-0">
                    <span className="block text-[14px] font-medium truncate" style={{ color: "var(--mint-label)" }}>{p.name}</span>
                    <span className="block text-[12.5px] truncate mint-muted">{p.text}</span>
                  </span>
                  <span className="flex flex-col items-end gap-1 shrink-0">
                    <span className="text-[11px] mint-muted">{p.time}</span>
                    {p.unread > 0 && <span className="mint-lime min-w-[18px] h-[18px] px-1 text-[10.5px] font-semibold grid place-items-center">{p.unread}</span>}
                  </span>
                </div>
              </div>
            ))}
          </div>
          <SoftNav active={2} />
        </>
      )}
      {tab === "chat" && (
        <>
          <div className="mint-head-between px-[17px] pt-3 pb-2">
            <span className="mint-pill mint-round"><ChevronLeft className="w-5 h-5 mint-ink" /></span>
            <span className="mint-pill h-[43px] pl-1.5 pr-4 flex items-center gap-2">
              <Avatar hue={32} size={32} />
              <span className="text-left leading-tight">
                <span className="block text-[13.5px] font-medium" style={{ color: "var(--mint-label)" }}>Аня</span>
                <span className="block text-[11px] text-online">{t("в сети")}</span>
              </span>
            </span>
            <span className="mint-pill mint-round"><Phone className="w-[18px] h-[18px] mint-ink" /></span>
          </div>
          <Bubbles />
          <div className="px-3 pb-3 flex items-center gap-2">
            <span className="mint-pill flex-1 h-[42px] px-4 flex items-center text-[13px] mint-muted">{t("Сообщение")}</span>
            <span className="mint-lime mint-round"><Mic className="w-5 h-5" /></span>
          </div>
        </>
      )}
      {tab === "settings" && (
        <>
          <div className="mint-head">
            <span className="mint-pill mint-round"><ChevronLeft className="w-5 h-5 mint-ink" /></span>
            <span className="mint-title">{t("Настройки")}</span>
            <span />
          </div>
          <div className="px-4 pt-1">
            <span className="mint-label">{t("Аккаунт")}</span>
            <div className="mint-card overflow-hidden">
              {[[User, "Профиль"], [Bell, "Уведомления"], [Lock, "Конфиденциальность"]].map(([Icon, label], i) => {
                const I = Icon as typeof User;
                return (
                  <div key={label as string}>
                    {i > 0 && <div className="mint-divider mx-3" />}
                    <div className="flex items-center gap-3 px-4 h-12">
                      <I className="w-5 h-5 mint-ink" />
                      <span className="flex-1 text-[14px]" style={{ color: "var(--mint-label)" }}>{t(label as string)}</span>
                      <ChevronRight className="w-4 h-4 mint-muted" />
                    </div>
                  </div>
                );
              })}
            </div>
            <span className="mint-label mt-4">{t("Оформление")}</span>
            <div className="mint-card px-4 py-3 space-y-3">
              <label className="flex items-center gap-3 text-[14px]" style={{ color: "var(--mint-label)" }}>
                <span className="flex-1">{t("Звук сообщений")}</span>
                <input type="checkbox" readOnly checked className="accent-primary" />
              </label>
              <span className="mint-dark-pill mint-btn w-full">{t("Поделиться профилем")}</span>
              <span className="block text-[11.5px] mint-faint">{t("Подпись под карточкой — приглушённым цветом темы.")}</span>
            </div>
          </div>
          <SoftNav active={4} />
        </>
      )}
    </div>
  );
}

function SoftNav({ active }: { active: number }) {
  const icons = ["navMusic", "navSaved", "navChat", "navWall", "navProfile"] as const;
  const sizes: [number, number][] = [[17, 21], [16, 21], [28, 20], [21, 21], [21, 22]];
  return (
    <div className="mt-auto flex justify-center pb-3 pt-2">
      <nav className="mint-nav" style={{ ["--n" as string]: 5 }}>
        <span className="mint-nav-pill" style={{ ["--i" as string]: active }} />
        {icons.map((ic, i) => (
          <span key={ic} className={cn("mint-nav-item", i === active && "mint-nav-on")}><MintIcon name={ic} size={sizes[i]} /></span>
        ))}
      </nav>
    </div>
  );
}

function Bubbles() {
  const row = (own: boolean, text: ReactNode, time: string) => (
    <div className={cn("flex", own ? "justify-end" : "justify-start")}>
      <div className={cn("msg-bubble max-w-[78%] px-3 py-2 text-[13.5px] leading-snug", own ? "msg-own" : "msg-peer")}>
        {text}<span className="ml-2 text-[10.5px] opacity-70 align-bottom">{time}</span>
      </div>
    </div>
  );
  return (
    <div className="chat-scroll flex-1 min-h-0 px-3 py-3 space-y-2 overflow-hidden">
      <div className="flex justify-center"><span className="ui-date-chip px-2.5 h-6 rounded-full text-[11px] grid place-items-center">{t("Сегодня")}</span></div>
      {row(false, "Привет! Как тебе новая тема?", "18:31")}
      {row(true, "Огонь 🔥 Цвета свои подобрал", "18:32")}
      {row(false, "Покажешь в профиле?", "18:33")}
      {row(true, "Уже поделился ссылкой", "18:35")}
    </div>
  );
}

// ---------- классическая раскладка (flat, outlined, glass) ----------
function ClassicScreen({ tab }: { tab: Tab }) {
  return (
    <div className="h-full flex flex-col">
      {tab === "chats" && (
        <>
          <div className="px-4 pt-3 pb-2 flex items-center gap-2">
            <span className="text-[13px] font-medium text-primary">{t("Изм.")}</span>
            <span className="flex-1 text-center text-[17px] font-bold">{t("Чаты")}</span>
            <span className="ui-plus w-9 h-9 rounded-full bg-primary text-primary-foreground grid place-items-center"><Plus className="w-5 h-5" /></span>
          </div>
          <div className="px-4 space-y-2">
            <div className="ui-search h-9 px-3 rounded-[var(--radius-field)] bg-surface-1 border border-border flex items-center gap-2 text-subtle text-[13px]"><Search className="w-4 h-4" />{t("Поиск")}</div>
            <div className="flex gap-1.5">
              <span className="ui-chip px-3 h-7 rounded-full bg-primary text-primary-foreground text-[12px] font-medium grid place-items-center">{t("Все")}</span>
              <span className="ui-chip px-3 h-7 rounded-full bg-surface-1 border border-border text-[12px] grid place-items-center">{t("Непрочитанные")}</span>
              <span className="ui-chip px-3 h-7 rounded-full bg-surface-1 border border-border text-[12px] grid place-items-center">{t("Каналы")}</span>
            </div>
          </div>
          <div className="ui-chat-list mt-2 flex-1 min-h-0">
            {PEOPLE.map((p) => (
              <div key={p.name} className="chat-row-card flex items-center gap-3 px-4 py-2.5 border-b border-border bg-background">
                <Avatar hue={p.hue} />
                <span className="flex-1 min-w-0">
                  <span className="block text-[14px] font-semibold truncate">{p.name}</span>
                  <span className="block text-[12.5px] text-muted-foreground truncate">{p.text}</span>
                </span>
                <span className="flex flex-col items-end gap-1 shrink-0">
                  <span className="text-[11px] text-subtle">{p.time}</span>
                  {p.unread > 0 && <span className="min-w-[18px] h-[18px] px-1 rounded-full bg-primary text-primary-foreground text-[10.5px] font-semibold grid place-items-center">{p.unread}</span>}
                </span>
              </div>
            ))}
          </div>
          <ClassicNav active={0} />
        </>
      )}
      {tab === "chat" && (
        <>
          <div className="px-3 h-14 flex items-center gap-2 border-b border-border bg-background">
            <ChevronLeft className="w-5 h-5 text-primary" />
            <Avatar hue={32} size={34} />
            <span className="flex-1 leading-tight">
              <span className="block text-[14px] font-semibold">Аня</span>
              <span className="block text-[11px] text-online">{t("в сети")}</span>
            </span>
            <Phone className="w-5 h-5 text-primary" />
          </div>
          <Bubbles />
          <div className="chat-compose px-3 py-2 flex items-center gap-2 border-t border-border">
            <span className="flex-1 h-10 px-3 rounded-[var(--radius-field)] bg-surface-1 border border-border flex items-center text-[13px] text-subtle">{t("Сообщение")}</span>
            <span className="w-10 h-10 rounded-full bg-primary text-primary-foreground grid place-items-center"><Mic className="w-5 h-5" /></span>
          </div>
        </>
      )}
      {tab === "settings" && (
        <>
          <div className="px-4 pt-3 pb-2 text-[19px] font-bold">{t("Настройки")}</div>
          <div className="px-4 space-y-3">
            <div className="rounded-[var(--radius)] bg-surface-1 border border-border overflow-hidden">
              {[[User, "Профиль"], [Bell, "Уведомления"], [Palette, "Оформление"]].map(([Icon, label], i) => {
                const I = Icon as typeof User;
                return (
                  <div key={label as string} className={cn("flex items-center gap-3 px-4 h-12", i > 0 && "border-t border-border")}>
                    <I className="w-5 h-5 text-primary" />
                    <span className="flex-1 text-[14px]">{t(label as string)}</span>
                    <ChevronRight className="w-4 h-4 text-subtle" />
                  </div>
                );
              })}
            </div>
            <div className="rounded-[var(--radius)] bg-surface-1 border border-border px-4 py-3 space-y-3">
              <label className="flex items-center gap-3 text-[14px]">
                <span className="flex-1">{t("Звук сообщений")}</span>
                <input type="checkbox" readOnly checked className="w-5 h-5 accent-primary" />
              </label>
              <span className="w-full h-10 rounded-[var(--radius-field)] bg-primary text-primary-foreground text-[13px] font-semibold grid place-items-center">{t("Поделиться профилем")}</span>
              <span className="w-full h-10 rounded-[var(--radius-field)] bg-destructive text-destructive-foreground text-[13px] font-semibold grid place-items-center">{t("Выйти")}</span>
            </div>
          </div>
          <ClassicNav active={4} />
        </>
      )}
    </div>
  );
}

function ClassicNav({ active }: { active: number }) {
  const items = [MessageSquare, Newspaper, Bookmark, Music2, Settings];
  return (
    <nav className="ui-bottom-nav mt-auto flex border-t border-border bg-background">
      {items.map((I, i) => (
        <span key={i} className={cn("ui-nav-item relative flex-1 h-12 grid place-items-center", i === active ? "ui-nav-on text-primary" : "text-subtle")}><I className="w-5 h-5" /></span>
      ))}
    </nav>
  );
}
