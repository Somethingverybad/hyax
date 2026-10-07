import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import Identicon from "@/components/Identicon";
import {
  Area, Bar, BarChart, CartesianGrid, ComposedChart, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts";
import { Activity, Cpu, Database, HardDrive, MemoryStick, MessageSquare, Phone, RefreshCw, Users, UserPlus, Radio } from "lucide-react";
import ScreenHeader from "@/components/ScreenHeader";
import { api, type AdminMetrics } from "@/api/client";

/**
 * Мониторинг для админов: онлайн, пользователи, сообщения, нагрузка сервера.
 * Данные — /api/admin/metrics/ (backend/chat/metrics.py). Онлайн и нагрузка
 * берутся из снимков раз в минуту, остальное считается из базы задним числом.
 *
 * Цвета рядов — эталонная палитра (синий, оранжевый), отдельные значения для
 * светлой и тёмной темы; текст и оси — токены темы приложения.
 */

type Range = "24h" | "7d" | "30d";
const RANGES: { id: Range; label: string }[] = [
  { id: "24h", label: "24 часа" },
  { id: "7d", label: "7 дней" },
  { id: "30d", label: "30 дней" },
];
const REFRESH_MS = 30_000;

/** Цвет из CSS-переменной темы: «H S% L%» оборачиваем в hsl(), остальное как есть. */
function cssVar(name: string, fallback: string): string {
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  if (!v) return fallback;
  return /^[\d.]+\s+[\d.]+%\s+[\d.]+%/.test(v) ? `hsl(${v})` : v;
}

function usePalette() {
  const [dark, setDark] = useState(() => getComputedStyle(document.documentElement).colorScheme.includes("dark"));
  useEffect(() => {
    const obs = new MutationObserver(() => setDark(getComputedStyle(document.documentElement).colorScheme.includes("dark")));
    obs.observe(document.documentElement, { attributes: true, attributeFilter: ["style", "class"] });
    return () => obs.disconnect();
  }, []);
  return useMemo(() => ({
    s1: dark ? "#3987e5" : "#2a78d6",
    s2: dark ? "#d95926" : "#eb6834",
    // Статусы — фиксированные, без подстройки под тему; рядом всегда подпись.
    good: "#0ca30c",
    warn: "#fab219",
    crit: "#d03b3b",
    grid: cssVar("--border", dark ? "#333" : "#ddd"),
    axis: cssVar("--subtle-foreground", dark ? "#999" : "#666"),
    surface: cssVar("--surface-2", dark ? "#1a1a19" : "#fcfcfb"),
  }), [dark]);
}

const nf = new Intl.NumberFormat("ru-RU");
const fmt = (n: number | null | undefined) => (n == null ? "—" : nf.format(n));

function bytes(n: number | null | undefined): string {
  if (n == null) return "—";
  const u = ["Б", "КБ", "МБ", "ГБ", "ТБ"];
  let i = 0;
  let v = n;
  while (v >= 1024 && i < u.length - 1) { v /= 1024; i++; }
  return `${v >= 100 || i === 0 ? Math.round(v) : v.toFixed(1)} ${u[i]}`;
}

function duration(s: number): string {
  const d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600), m = Math.floor((s % 3600) / 60);
  return d ? `${d} д ${h} ч` : h ? `${h} ч ${m} мин` : `${m} мин`;
}

const timeFmt = (range: Range) => (t: number) => {
  const d = new Date(t);
  const hm = d.toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" });
  return range === "24h" ? hm : `${d.toLocaleDateString("ru-RU", { day: "2-digit", month: "2-digit" })} ${hm}`;
};
const dayFmt = (t: number) => new Date(t).toLocaleDateString("ru-RU", { day: "2-digit", month: "2-digit" });
const timeAt = (iso?: string | null) => (iso ? new Date(iso).toLocaleString("ru-RU", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }) : "");

// ---------- мелкие детали ----------

function Card({ title, sub, children, className = "" }: { title?: string; sub?: string; children: ReactNode; className?: string }) {
  return (
    <section className={`ui-card rounded-lg bg-surface-2 border border-border p-4 ${className}`}>
      {title && (
        <header className="mb-3">
          <h2 className="text-h2 text-foreground">{title}</h2>
          {sub && <p className="text-caption text-subtle mt-0.5">{sub}</p>}
        </header>
      )}
      {children}
    </section>
  );
}

function Tile({ icon: Icon, label, value, sub, accent }: { icon: typeof Users; label: string; value: ReactNode; sub?: ReactNode; accent?: ReactNode }) {
  return (
    <div className="ui-card rounded-lg bg-surface-2 border border-border p-3.5 min-w-0">
      <div className="flex items-center gap-1.5 text-caption text-subtle">
        <Icon className="w-3.5 h-3.5 shrink-0" />
        <span className="truncate">{label}</span>
        {accent}
      </div>
      <div className="mt-1.5 text-[28px] leading-none font-semibold text-foreground tabular-nums">{value}</div>
      {sub && <div className="mt-1.5 text-caption text-subtle leading-snug">{sub}</div>}
    </div>
  );
}

/** Полоса заполнения с порогами: до 70 % — обычный цвет, до 90 % — внимание, выше — критично. */
function Meter({ icon: Icon, label, pct, detail, pal }: { icon: typeof Cpu; label: string; pct: number | null; detail: string; pal: ReturnType<typeof usePalette> }) {
  const p = pct == null ? null : Math.max(0, Math.min(100, pct));
  const level = p == null ? "" : p >= 90 ? "критично" : p >= 70 ? "много" : "";
  const color = p == null ? pal.grid : p >= 90 ? pal.crit : p >= 70 ? pal.warn : pal.s1;
  return (
    <div className="min-w-0">
      <div className="flex items-center gap-1.5 text-small text-foreground">
        <Icon className="w-4 h-4 text-subtle shrink-0" />
        <span className="flex-1 truncate">{label}</span>
        <span className="tabular-nums font-medium">{p == null ? "—" : `${Math.round(p)}%`}</span>
      </div>
      <div className="mt-1.5 h-2 rounded-full bg-surface-3 overflow-hidden" role="meter" aria-valuenow={p ?? undefined} aria-valuemin={0} aria-valuemax={100} aria-label={label}>
        <div className="h-full rounded-full transition-[width] duration-500" style={{ width: `${p ?? 0}%`, background: color }} />
      </div>
      <div className="mt-1 text-caption text-subtle flex justify-between gap-2">
        <span className="truncate">{detail}</span>
        {level && <span style={{ color }} className="shrink-0 font-medium">{level}</span>}
      </div>
    </div>
  );
}

function Legend({ items }: { items: { color: string; label: string; dashed?: boolean }[] }) {
  return (
    <div className="flex flex-wrap gap-x-4 gap-y-1 mb-2 text-caption text-subtle">
      {items.map((it) => (
        <span key={it.label} className="inline-flex items-center gap-1.5">
          <span className="inline-block w-3.5 h-0.5 rounded" style={{ background: it.color }} />
          {it.label}
        </span>
      ))}
    </div>
  );
}

function ChartTip({ active, payload, label, labelFmt, unit }: {
  active?: boolean; payload?: { name: string; value: number | null; color: string }[]; label?: number;
  labelFmt: (t: number) => string; unit?: string;
}) {
  if (!active || !payload?.length || label == null) return null;
  return (
    <div className="rounded-md border border-border bg-background/95 px-2.5 py-1.5 shadow-lg text-caption">
      <div className="text-subtle mb-0.5">{labelFmt(label)}</div>
      {payload.map((p) => (
        <div key={p.name} className="flex items-center gap-1.5 text-foreground">
          <span className="w-2 h-2 rounded-full" style={{ background: p.color }} />
          <span className="text-subtle">{p.name}</span>
          <span className="ml-auto pl-3 font-medium tabular-nums">{p.value == null ? "—" : `${nf.format(p.value)}${unit || ""}`}</span>
        </div>
      ))}
    </div>
  );
}

function Empty({ children }: { children: ReactNode }) {
  // Отступ слева — под колонку подписей оси Y; подложка — чтобы текст не
  // сливался с сеткой и подписями, через которые проходит.
  return (
    <div className="absolute inset-y-0 left-12 right-2 flex items-center justify-center text-center pointer-events-none">
      <span className="rounded-md bg-surface-2/90 px-2.5 py-1.5 text-small text-subtle">{children}</span>
    </div>
  );
}

type OnlineUser = AdminMetrics["live"]["users_online"][number];

/** Кто сейчас на связи: сначала с приложением на экране, потом в фоне. */
function OnlineList({ users, pal }: { users: OnlineUser[]; pal: ReturnType<typeof usePalette> }) {
  const navigate = useNavigate();
  const [all, setAll] = useState(false);
  const LIMIT = 12;
  if (!users.length) return <p className="text-small text-subtle">Сейчас никого нет.</p>;
  const shown = all ? users : users.slice(0, LIMIT);
  return (
    <>
      <ul className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-x-4">
        {shown.map((u) => (
          <li key={u.id}>
            <button type="button" onClick={() => navigate(`/u/${encodeURIComponent(u.username)}`)}
              className="w-full flex items-center gap-3 py-2 text-left rounded-md active:bg-surface-3 hover:bg-surface-3/60 -mx-1 px-1">
              <span className="relative shrink-0">
                <Identicon id={u.id} avatarUrl={u.avatar_url} className="w-9 h-9" />
                <span className="absolute -right-0.5 -bottom-0.5 w-3 h-3 rounded-full border-2 border-[hsl(var(--surface-2))]"
                  style={{ background: u.active ? pal.good : pal.axis }} aria-hidden />
              </span>
              <span className="flex-1 min-w-0">
                <span className="flex items-center gap-1.5 min-w-0">
                  <span className="text-body text-foreground truncate">{u.username}</span>
                  {u.role === "admin" && <span className="shrink-0 text-[10px] uppercase tracking-wide rounded px-1 py-px bg-surface-3 text-subtle">админ</span>}
                  {u.role === "support" && <span className="shrink-0 text-[10px] uppercase tracking-wide rounded px-1 py-px bg-surface-3 text-subtle">поддержка</span>}
                  {u.hidden && <span className="shrink-0 text-[10px] uppercase tracking-wide rounded px-1 py-px bg-surface-3 text-subtle" title="Прячет «в сети» от собеседников">скрыт</span>}
                </span>
                <span className="block text-caption text-subtle truncate">
                  {u.active ? "приложение на экране" : "в фоне"}
                  {u.devices > 1 ? ` · ${u.devices} устройства` : ""}
                  {u.online_s != null ? ` · ${duration(u.online_s)}` : ""}
                </span>
              </span>
            </button>
          </li>
        ))}
      </ul>
      {users.length > LIMIT && (
        <button type="button" onClick={() => setAll((v) => !v)} className="mt-2 text-small text-primary active:opacity-60">
          {all ? "Свернуть" : `Показать всех (${users.length})`}
        </button>
      )}
    </>
  );
}

// ---------- страница ----------

export default function AdminMetrics() {
  const pal = usePalette();
  const [range, setRange] = useState<Range>("24h");
  const [data, setData] = useState<AdminMetrics | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [updatedAt, setUpdatedAt] = useState<Date | null>(null);

  const load = useCallback(async (r: Range) => {
    setLoading(true);
    try {
      const d = await api.getAdminMetrics(r, -new Date().getTimezoneOffset());
      setData(d);
      setError(null);
      setUpdatedAt(new Date());
    } catch (e) {
      setError((e as Error).message || "Не удалось загрузить");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load(range);
    const id = setInterval(() => { if (document.visibilityState === "visible") void load(range); }, REFRESH_MS);
    return () => clearInterval(id);
  }, [range, load]);

  const tFmt = timeFmt(range);
  const live = data?.live;
  const tot = data?.totals;
  const samplePoints = data?.timeline.filter((p) => p.online_avg != null).length ?? 0;
  const hasSamples = samplePoints >= 2;
  // Пока точек мало, линия из одной-двух точек не видна — рисуем их кружками.
  const sparseDot = samplePoints < 12 ? { r: 3, strokeWidth: 0 } : false;
  const hasDailyPeaks = !!data?.daily.some((p) => p.peak_online != null);
  const sampling = live?.sampling_since ? `Снимки онлайна и нагрузки идут с ${timeAt(live.sampling_since)}` : "Снимки онлайна и нагрузки ещё не начались";

  const axis = { stroke: pal.axis, fontSize: 11, tickLine: false, axisLine: false } as const;
  const grid = <CartesianGrid vertical={false} stroke={pal.grid} strokeDasharray="0" strokeOpacity={0.6} />;

  return (
    <div className="h-screen flex flex-col bg-background">
      <ScreenHeader
        title="Мониторинг"
        right={
          <button type="button" onClick={() => load(range)} disabled={loading} aria-label="Обновить"
            className="w-10 h-10 shrink-0 inline-flex items-center justify-center text-primary active:opacity-60 disabled:opacity-40">
            <RefreshCw className={`w-5 h-5 ${loading ? "animate-spin" : ""}`} />
          </button>
        }
      />

      <div className="flex-1 overflow-y-auto">
        <div className="max-w-6xl mx-auto px-4 py-4 space-y-3">
          {/* Фильтр периода — один ряд над графиками; плитки «сейчас» от него не зависят. */}
          <div className="flex items-center gap-2">
            <div className="inline-flex rounded-md border border-border bg-surface-2 p-0.5" role="tablist" aria-label="Период">
              {RANGES.map((r) => (
                <button key={r.id} type="button" role="tab" aria-selected={range === r.id} onClick={() => setRange(r.id)}
                  className={`px-3 h-8 rounded text-small transition-colors ${range === r.id ? "bg-primary text-primary-foreground font-medium" : "text-foreground hover:bg-surface-3"}`}>
                  {r.label}
                </button>
              ))}
            </div>
            <span className="ml-auto text-caption text-subtle tabular-nums">
              {updatedAt ? `обновлено ${updatedAt.toLocaleTimeString("ru-RU")}` : loading ? "загружаю…" : ""}
            </span>
          </div>

          {error && (
            <Card>
              <p className="text-body text-foreground">{error === "403" ? "Раздел только для администраторов." : `Не удалось загрузить: ${error}`}</p>
            </Card>
          )}

          {data && live && tot && (
            <>
              {/* ---- сейчас ---- */}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <Tile icon={Activity} label="В сети сейчас" value={fmt(live.online)}
                  accent={<span className="ml-auto inline-flex items-center gap-1" style={{ color: pal.good }}><span className="w-2 h-2 rounded-full animate-pulse" style={{ background: pal.good }} />live</span>}
                  sub={<>на связи {fmt(live.connected)} · сокетов {fmt(live.sockets)}</>} />
                <Tile icon={Users} label="Пользователей" value={fmt(tot.users)}
                  sub={<>+{fmt(tot.users_24h)} за сутки · +{fmt(tot.users_7d)} за неделю</>} />
                <Tile icon={UserPlus} label="Заходили за сутки" value={fmt(tot.seen_24h)}
                  sub={<>за 7 дней {fmt(tot.seen_7d)} · за 30 дней {fmt(tot.seen_30d)}</>} />
                <Tile icon={MessageSquare} label="Сообщений за сутки" value={fmt(tot.messages_24h)}
                  sub={<>всего {fmt(tot.messages)}</>} />
                <Tile icon={Activity} label="Пик за сутки" value={fmt(tot.peak_24h)}
                  sub={tot.peak_all != null ? <>рекорд {fmt(tot.peak_all)} · {timeAt(tot.peak_all_at)}</> : "снимков пока нет"} />
                <Tile icon={Radio} label="Чаты" value={fmt(tot.chats_direct + tot.chats_group)}
                  sub={<>личных {fmt(tot.chats_direct)} · групп {fmt(tot.chats_group)} · каналов {fmt(tot.channels)}</>} />
                <Tile icon={Phone} label="Звонков за сутки" value={fmt(tot.calls_24h)} sub={<>ботов в системе {fmt(tot.bots)}</>} />
                <Tile icon={Database} label="База данных" value={bytes(live.db_size)}
                  sub={<>процесс API {bytes(live.rss)} · работает {duration(live.uptime_s)}</>} />
              </div>

              {/* ---- кто в сети ---- */}
              <Card title={`Сейчас в сети · ${fmt(live.users_online?.length ?? 0)}`}
                sub="Зелёная точка — приложение открыто на экране, серая — свёрнуто, но соединение живо">
                <OnlineList users={live.users_online || []} pal={pal} />
              </Card>

              {/* ---- сервер ---- */}
              <Card title="Сервер" sub={`${live.cores ?? "?"} ядер · нагрузка ${live.load ? live.load.map((x) => x.toFixed(2)).join(" / ") : "—"} (1 / 5 / 15 мин)`}>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <Meter icon={Cpu} label="Процессор" pct={live.cpu} pal={pal}
                    detail={live.cpu == null ? "появится через минуту" : "среднее за последнюю минуту"} />
                  <Meter icon={MemoryStick} label="Память" pal={pal}
                    pct={live.mem_used != null && live.mem_total ? (100 * live.mem_used) / live.mem_total : null}
                    detail={`${bytes(live.mem_used)} из ${bytes(live.mem_total)}`} />
                  <Meter icon={HardDrive} label="Диск" pal={pal}
                    pct={live.disk_used != null && live.disk_total ? (100 * live.disk_used) / live.disk_total : null}
                    detail={`${bytes(live.disk_used)} из ${bytes(live.disk_total)}`} />
                </div>
              </Card>

              <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
                {/* ---- онлайн ---- */}
                <Card title="Онлайн" sub={`Пользователей с открытым приложением, шаг ${data.step_s / 60 >= 60 ? `${data.step_s / 3600} ч` : `${data.step_s / 60} мин`}. ${sampling}`}>
                  <Legend items={[{ color: pal.s1, label: "в среднем" }, { color: pal.s2, label: "пик" }]} />
                  <div className="relative h-56">
                    <ResponsiveContainer width="100%" height="100%">
                      <ComposedChart data={data.timeline} margin={{ top: 6, right: 6, bottom: 0, left: 0 }}>
                        {grid}
                        <XAxis dataKey="t" type="number" scale="time" domain={["dataMin", "dataMax"]} tickFormatter={tFmt} minTickGap={28} {...axis} />
                        <YAxis allowDecimals={false} width={36} {...axis} />
                        <Tooltip content={<ChartTip labelFmt={tFmt} />} cursor={{ stroke: pal.axis, strokeWidth: 1 }} />
                        <Area name="в среднем" dataKey="online_avg" type="monotone" stroke={pal.s1} strokeWidth={2} fill={pal.s1} fillOpacity={0.16} dot={sparseDot && { ...sparseDot, fill: pal.s1 }} connectNulls={false} isAnimationActive={false} />
                        <Line name="пик" dataKey="online_max" type="monotone" stroke={pal.s2} strokeWidth={2} dot={sparseDot && { ...sparseDot, fill: pal.s2 }} activeDot={{ r: 4, stroke: pal.surface, strokeWidth: 2 }} connectNulls={false} isAnimationActive={false} />
                      </ComposedChart>
                    </ResponsiveContainer>
                    {!hasSamples && <Empty>{samplePoints ? "Снимки только начали копиться — линия появится со следующей точкой." : "Снимков за этот период ещё нет — точки появляются раз в минуту."}</Empty>}
                  </div>
                </Card>

                {/* ---- нагрузка ---- */}
                <Card title="Нагрузка сервера" sub="Процессор и память хоста, % (среднее за шаг)">
                  <Legend items={[{ color: pal.s1, label: "процессор" }, { color: pal.s2, label: "память" }]} />
                  <div className="relative h-56">
                    <ResponsiveContainer width="100%" height="100%">
                      <LineChart data={data.timeline} margin={{ top: 6, right: 6, bottom: 0, left: 0 }}>
                        {grid}
                        <XAxis dataKey="t" type="number" scale="time" domain={["dataMin", "dataMax"]} tickFormatter={tFmt} minTickGap={28} {...axis} />
                        <YAxis domain={[0, 100]} ticks={[0, 25, 50, 75, 100]} width={46} tickFormatter={(v: number) => `${v}%`} {...axis} />
                        <Tooltip content={<ChartTip labelFmt={tFmt} unit="%" />} cursor={{ stroke: pal.axis, strokeWidth: 1 }} />
                        <Line name="процессор" dataKey="cpu" type="monotone" stroke={pal.s1} strokeWidth={2} dot={sparseDot && { ...sparseDot, fill: pal.s1 }} activeDot={{ r: 4, stroke: pal.surface, strokeWidth: 2 }} isAnimationActive={false} />
                        <Line name="память" dataKey="mem" type="monotone" stroke={pal.s2} strokeWidth={2} dot={sparseDot && { ...sparseDot, fill: pal.s2 }} activeDot={{ r: 4, stroke: pal.surface, strokeWidth: 2 }} isAnimationActive={false} />
                      </LineChart>
                    </ResponsiveContainer>
                    {!hasSamples && <Empty>{samplePoints ? "Нагрузка пишется вместе со снимками онлайна — линия появится со следующей точкой." : "Нагрузка пишется вместе со снимками онлайна."}</Empty>}
                  </div>
                </Card>

                {/* ---- сообщения ---- */}
                <Card title="Сообщения" sub="Отправлено за шаг, без удалённых у всех">
                  <div className="h-56">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={data.timeline} margin={{ top: 6, right: 6, bottom: 0, left: 0 }} barCategoryGap={2}>
                        {grid}
                        <XAxis dataKey="t" tickFormatter={tFmt} minTickGap={28} {...axis} />
                        <YAxis allowDecimals={false} width={36} {...axis} />
                        <Tooltip content={<ChartTip labelFmt={tFmt} />} cursor={{ fill: pal.grid, fillOpacity: 0.35 }} />
                        <Bar name="сообщений" dataKey="messages" fill={pal.s1} radius={[4, 4, 0, 0]} maxBarSize={22} isAnimationActive={false} />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                </Card>

                {/* ---- по часам суток ---- */}
                <Card title="Активность по часам" sub="Сообщения за 30 дней по часу суток, ваше время">
                  <div className="h-56">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={data.hours} margin={{ top: 6, right: 6, bottom: 0, left: 0 }} barCategoryGap={2}>
                        {grid}
                        <XAxis dataKey="hour" tickFormatter={(h: number) => `${h}`} interval={2} {...axis} />
                        <YAxis allowDecimals={false} width={36} {...axis} />
                        <Tooltip content={<ChartTip labelFmt={(h) => `${String(h).padStart(2, "0")}:00–${String((h + 1) % 24).padStart(2, "0")}:00`} />} cursor={{ fill: pal.grid, fillOpacity: 0.35 }} />
                        <Bar name="сообщений" dataKey="messages" fill={pal.s1} radius={[4, 4, 0, 0]} isAnimationActive={false} />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                </Card>
              </div>

              {/* ---- по дням: разные величины — отдельные графики, без второй оси ---- */}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                {([
                  { key: "registrations", title: "Регистрации", sub: "Новых пользователей в день", empty: false },
                  { key: "writers", title: "Писали сообщения", sub: "Разных людей в день", empty: false },
                  { key: "peak_online", title: "Пик онлайна по дням", sub: "Максимум одновременно", empty: !hasDailyPeaks },
                ] as const).map((c) => (
                  <Card key={c.key} title={c.title} sub={`${c.sub}, 30 дней`}>
                    <div className="relative h-44">
                      <ResponsiveContainer width="100%" height="100%">
                        <BarChart data={data.daily} margin={{ top: 6, right: 4, bottom: 0, left: 0 }} barCategoryGap={2}>
                          {grid}
                          <XAxis dataKey="t" tickFormatter={dayFmt} minTickGap={22} {...axis} />
                          <YAxis allowDecimals={false} width={32} {...axis} />
                          <Tooltip content={<ChartTip labelFmt={(t) => new Date(t).toLocaleDateString("ru-RU", { day: "numeric", month: "long", weekday: "short" })} />} cursor={{ fill: pal.grid, fillOpacity: 0.35 }} />
                          <Bar name={c.title.toLowerCase()} dataKey={c.key} fill={pal.s1} radius={[4, 4, 0, 0]} isAnimationActive={false} />
                        </BarChart>
                      </ResponsiveContainer>
                      {c.empty && <Empty>Появится, когда накопятся снимки за целый день.</Empty>}
                    </div>
                  </Card>
                ))}
              </div>

              <p className="text-caption text-subtle pb-4">
                «В сети» — приложение открыто на экране; «на связи» — сокет открыт, в том числе свёрнутым приложением. Боты не считаются.
              </p>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
