import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Search, X, Maximize2 } from "lucide-react";
import Identicon from "@/components/Identicon";
import { api, type AdminGraph as GraphData, type AdminGraphEdge, type AdminGraphNode } from "@/api/client";
import { t as tr, getLang } from "@/lib/i18n";

/**
 * Мониторинг → «Связи»: кто с кем переписывается в личке (backend
 * AdminGraphView). Узел — человек (размер — сколько у него диалогов), линия —
 * личный чат двоих (толщина — сколько в нём сообщений). Содержимого переписки
 * здесь нет; секретные чаты и группы не показываются.
 *
 * Фильтр — ники через запятую: найденные (оранжевые) и их собеседники
 * (синие) на 1–2 шага. Без фильтра — самые активные диалоги. Раскладка —
 * простая силовая (отталкивание узлов, притяжение по рёбрам), считается один
 * раз на набор данных; перетаскивание и щипок — сдвиг и масштаб, тап по
 * узлу — его диалоги списком.
 */

type Pal = { s1: string; s2: string; grid: string; axis: string; surface: string };
type Pos = { x: number; y: number };
type View = { k: number; tx: number; ty: number };

const MINS = [1, 10, 100];
const nfByLang: Record<string, Intl.NumberFormat> = {};
const nf = () => (nfByLang[getLang()] ||= new Intl.NumberFormat(getLang()));
const dateOf = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString(getLang(), { day: "2-digit", month: "2-digit", year: "2-digit" }) : "—");

/** Детерминированная «случайность» по id: одна и та же раскладка при обновлении. */
function hash01(s: string, salt: number) {
  let h = 2166136261 ^ salt;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return ((h >>> 0) % 100000) / 100000;
}

/** Силовая раскладка (Фрюхтерман — Рейнгольд) в прямоугольнике 1000·asp × 1000 —
 *  по форме области рисования, чтобы граф занимал её целиком, а не середину. */
function layout(nodes: AdminGraphNode[], edges: AdminGraphEdge[], asp: number): Map<string, Pos> {
  const n = nodes.length;
  const W = 1000 * asp, cx = W / 2;
  const pos = nodes.map((nd) => ({ x: cx + (hash01(nd.id, 1) - 0.5) * W * 0.6, y: 500 + (hash01(nd.id, 2) - 0.5) * 600 }));
  if (n <= 1) return new Map(nodes.map((nd, i) => [nd.id, pos[i]]));
  const idx = new Map(nodes.map((nd, i) => [nd.id, i]));
  const links = edges.map((e) => [idx.get(e.a)!, idx.get(e.b)!, Math.log2(e.n + 1)] as const).filter(([a, b]) => a != null && b != null);
  const k = Math.sqrt((W * 1000) / n) * 0.95;
  // Связанные узлы (хабы) отталкивают сильнее — центр не слипается в кучу.
  const deg = new Float64Array(n);
  for (const [a, b] of links) { deg[a]++; deg[b]++; }
  const iters = n > 400 ? 160 : 260;
  let temp = 120;
  const dx = new Float64Array(n), dy = new Float64Array(n);
  for (let it = 0; it < iters; it++) {
    dx.fill(0); dy.fill(0);
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        let ddx = pos[i].x - pos[j].x, ddy = pos[i].y - pos[j].y;
        let d2 = ddx * ddx + ddy * ddy;
        if (d2 < 0.01) { ddx = 0.1; ddy = 0.1; d2 = 0.02; }
        const f = ((k * k) / d2) * (1 + Math.sqrt(deg[i] * deg[j]) * 0.15);
        dx[i] += ddx * f; dy[i] += ddy * f; dx[j] -= ddx * f; dy[j] -= ddy * f;
      }
    }
    for (const [a, b, w] of links) {
      const ddx = pos[a].x - pos[b].x, ddy = pos[a].y - pos[b].y;
      const d = Math.sqrt(ddx * ddx + ddy * ddy) || 0.1;
      const f = (d / k) * (0.6 + w * 0.15);
      dx[a] -= ddx * f; dy[a] -= ddy * f; dx[b] += ddx * f; dy[b] += ddy * f;
    }
    for (let i = 0; i < n; i++) {
      // Лёгкое притяжение к центру — одиночки и мелкие компоненты не улетают.
      dx[i] += (cx - pos[i].x) * 0.015; dy[i] += (500 - pos[i].y) * 0.015;
      const d = Math.sqrt(dx[i] * dx[i] + dy[i] * dy[i]) || 1;
      const step = Math.min(d, temp);
      pos[i].x += (dx[i] / d) * step; pos[i].y += (dy[i] / d) * step;
    }
    temp *= 0.975;
  }
  // Силы одинаковы по осям, и граф выходит круглым — в широкой области он
  // занимал бы только середину. Растягиваем по ширине до формы области.
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
  for (const p of pos) { x0 = Math.min(x0, p.x); x1 = Math.max(x1, p.x); y0 = Math.min(y0, p.y); y1 = Math.max(y1, p.y); }
  const stretch = Math.max(1, Math.min(2.5, (asp * (y1 - y0)) / Math.max(1, x1 - x0)));
  if (stretch > 1.05) for (const p of pos) p.x = cx + (p.x - cx) * stretch;
  return new Map(nodes.map((nd, i) => [nd.id, pos[i]]));
}

const radius = (nd: AdminGraphNode) => 4 + Math.min(14, Math.sqrt(nd.dialogs) * 2.2);
const width = (e: AdminGraphEdge) => 0.8 + Math.min(5, Math.log2(e.n + 1) * 0.55);

export default function AdminGraph({ pal }: { pal: Pal }) {
  const [input, setInput] = useState("");
  const [params, setParams] = useState({ q: "", depth: 1, min: 1, bots: false });
  const [data, setData] = useState<GraphData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [hover, setHover] = useState<{ x: number; y: number; text: string } | null>(null);

  const load = useCallback(async (p: typeof params) => {
    setLoading(true);
    try {
      setData(await api.getAdminGraph({ q: p.q, depth: p.depth, min: p.min, bots: p.bots }));
      setError(null);
    } catch (e) {
      setError((e as Error).message || tr("Не удалось загрузить"));
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => { void load(params); setSelected(null); }, [params, load]);

  const apply = (q = input) => setParams((p) => ({ ...p, q: q.trim() }));

  const nodes = data?.nodes ?? [];
  const edges = data?.edges ?? [];
  const byId = useMemo(() => new Map(nodes.map((n) => [n.id, n])), [nodes]);
  // Раскладка — под форму области (ширина/высота), заново только при новых данных или заметной смене формы.
  const [asp, setAsp] = useState(1.6);
  const pos = useMemo(() => layout(nodes, edges, asp), [nodes, edges, asp]);
  const neighbors = useMemo(() => {
    if (!selected) return null;
    const s = new Set<string>([selected]);
    for (const e of edges) { if (e.a === selected) s.add(e.b); else if (e.b === selected) s.add(e.a); }
    return s;
  }, [selected, edges]);

  // ---- область рисования: размер, вписывание, сдвиг и масштаб ----
  const boxRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 800, h: 520 });
  useLayoutEffect(() => {
    const el = boxRef.current;
    if (!el) return;
    const set = () => {
      setSize({ w: el.clientWidth, h: el.clientHeight });
      const a = Math.max(0.5, Math.min(2.5, el.clientWidth / Math.max(1, el.clientHeight)));
      setAsp((prev) => (Math.abs(prev - a) / prev > 0.2 ? Math.round(a * 10) / 10 : prev));
    };
    set();
    const ro = new ResizeObserver(set);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const [view, setView] = useState<View>({ k: 1, tx: 0, ty: 0 });
  const fit = useCallback(() => {
    if (!pos.size) return;
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    pos.forEach((p) => { x0 = Math.min(x0, p.x); y0 = Math.min(y0, p.y); x1 = Math.max(x1, p.x); y1 = Math.max(y1, p.y); });
    const pad = 40;
    const k = Math.min((size.w - pad * 2) / Math.max(1, x1 - x0), (size.h - pad * 2 - 16) / Math.max(1, y1 - y0), 3);
    setView({ k, tx: size.w / 2 - ((x0 + x1) / 2) * k, ty: size.h / 2 - ((y0 + y1) / 2) * k });
  }, [pos, size.w, size.h]);
  useEffect(() => { fit(); }, [pos, fit]);

  const ptrs = useRef(new Map<number, { x: number; y: number }>());
  const gest = useRef<{ moved: boolean; d0: number; k0: number; mid0: { x: number; y: number }; v0: View; node: string | null } | null>(null);
  const local = (e: { clientX: number; clientY: number }) => {
    const r = boxRef.current!.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };
  const onDown = (e: React.PointerEvent) => {
    // Узел — по месту касания до захвата указателя (после захвата цель — вся область).
    const node = (e.target as Element).closest?.("[data-node]")?.getAttribute("data-node") ?? null;
    (e.currentTarget as Element).setPointerCapture(e.pointerId);
    ptrs.current.set(e.pointerId, local(e));
    const pts = [...ptrs.current.values()];
    const mid = pts.length === 2 ? { x: (pts[0].x + pts[1].x) / 2, y: (pts[0].y + pts[1].y) / 2 } : pts[0];
    gest.current = { moved: gest.current?.moved ?? false, d0: pts.length === 2 ? Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y) : 0, k0: view.k, mid0: mid, v0: view, node: pts.length === 1 ? node : null };
  };
  const onMove = (e: React.PointerEvent) => {
    if (!ptrs.current.has(e.pointerId)) return;
    const p0 = ptrs.current.get(e.pointerId)!;
    const p = local(e);
    ptrs.current.set(e.pointerId, p);
    const g = gest.current;
    if (!g) return;
    const pts = [...ptrs.current.values()];
    if (pts.length === 2 && g.d0 > 0) {
      g.moved = true;
      const d = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
      const mid = { x: (pts[0].x + pts[1].x) / 2, y: (pts[0].y + pts[1].y) / 2 };
      const k = Math.max(0.1, Math.min(8, g.v0.k * (d / g.d0)));
      const wx = (g.mid0.x - g.v0.tx) / g.v0.k, wy = (g.mid0.y - g.v0.ty) / g.v0.k;
      setView({ k, tx: mid.x - wx * k, ty: mid.y - wy * k });
    } else if (pts.length === 1) {
      if (Math.abs(p.x - p0.x) + Math.abs(p.y - p0.y) > 0) {
        if (!g.moved && Math.hypot(p.x - g.mid0.x, p.y - g.mid0.y) < 5) return;
        g.moved = true;
        setView((v) => ({ ...v, tx: v.tx + (p.x - p0.x), ty: v.ty + (p.y - p0.y) }));
      }
    }
  };
  const onUp = (e: React.PointerEvent) => {
    ptrs.current.delete(e.pointerId);
    const g = gest.current;
    if (!ptrs.current.size) {
      // Тап без сдвига: по узлу — выбрать, по пустому месту — снять выбор.
      if (g && !g.moved) setSelected(g.node && g.node !== selected ? g.node : null);
      gest.current = null;
    } else if (g) {
      const pts = [...ptrs.current.values()];
      gest.current = { ...g, d0: 0, mid0: pts[0], v0: view };
    }
  };
  const onWheel = (e: React.WheelEvent) => {
    const p = local(e);
    const k = Math.max(0.1, Math.min(8, view.k * Math.exp(-e.deltaY * 0.0015)));
    const wx = (p.x - view.tx) / view.k, wy = (p.y - view.ty) / view.k;
    setView({ k, tx: p.x - wx * k, ty: p.y - wy * k });
  };
  // Колесо — масштаб, а не прокрутка страницы.
  useEffect(() => {
    const el = boxRef.current;
    if (!el) return;
    const stop = (e: WheelEvent) => e.preventDefault();
    el.addEventListener("wheel", stop, { passive: false });
    return () => el.removeEventListener("wheel", stop);
  }, []);

  // Подписи — без наложений: по очереди важности (выбранный, его собеседники,
  // найденные, самые связанные) ставим над узлом, если место на экране свободно.
  const labeled = useMemo(() => {
    const prio = (nd: AdminGraphNode) => (nd.id === selected ? 4 : neighbors?.has(nd.id) ? 3 : nd.seed ? 2 : 0) * 1e6 + nd.dialogs * 1e3 + nd.messages / 1e3;
    const order = [...nodes].sort((a, b) => prio(b) - prio(a)).slice(0, 160);
    const boxes: { x0: number; y0: number; x1: number; y1: number }[] = [];
    const out = new Set<string>();
    for (const nd of order) {
      const p = pos.get(nd.id);
      if (!p) continue;
      const sx = p.x * view.k + view.tx, sy = p.y * view.k + view.ty;
      if (sx < -40 || sy < -20 || sx > size.w + 40 || sy > size.h + 20) continue;
      const r = radius(nd) * Math.sqrt(view.k);
      const w = nd.username.length * 6.4 + 4, h = 13;
      const b = { x0: sx - w / 2, y0: sy - r - 4 - h, x1: sx + w / 2, y1: sy - r - 4 };
      if (boxes.some((o) => b.x0 < o.x1 && b.x1 > o.x0 && b.y0 < o.y1 && b.y1 > o.y0)) continue;
      boxes.push(b);
      out.add(nd.id);
    }
    return out;
  }, [nodes, pos, view, size.w, size.h, selected, neighbors]);

  const sel = selected ? byId.get(selected) : null;
  const selEdges = useMemo(() => (selected ? edges.filter((e) => e.a === selected || e.b === selected).sort((x, y) => y.n - x.n) : []), [selected, edges]);
  const topEdges = useMemo(() => [...edges].sort((x, y) => y.n - x.n).slice(0, 30), [edges]);
  const tip = (e: React.PointerEvent | React.MouseEvent, text: string) => { const p = local(e); setHover({ x: p.x, y: p.y, text }); };
  const seedsShown = nodes.some((n) => n.seed);

  return (
    <div className="space-y-3">
      {/* Фильтры — одной строкой над графом. */}
      <div className="flex flex-wrap items-center gap-2">
        <form className="flex-1 min-w-[220px] flex items-center gap-2 h-9 px-3 rounded-md border border-border bg-surface-2"
          onSubmit={(e) => { e.preventDefault(); apply(); }}>
          <Search className="w-4 h-4 text-subtle shrink-0" />
          <input value={input} onChange={(e) => setInput(e.target.value)} placeholder={tr("Ники через запятую")}
            className="flex-1 min-w-0 bg-transparent text-small outline-none placeholder:text-subtle" />
          {input && <button type="button" onClick={() => { setInput(""); apply(""); }} aria-label={tr("Очистить")} className="text-subtle"><X className="w-4 h-4" /></button>}
        </form>
        <div className="flex w-full sm:w-auto sm:inline-flex rounded-md border border-border bg-surface-2 p-0.5" role="tablist" aria-label={tr("Глубина")}>
          {[1, 2].map((d) => (
            <button key={d} type="button" role="tab" aria-selected={params.depth === d} onClick={() => setParams((p) => ({ ...p, depth: d }))}
              className={`flex-1 sm:flex-none px-3 h-8 rounded text-small whitespace-nowrap ${params.depth === d ? "bg-primary text-primary-foreground font-medium" : "text-foreground hover:bg-surface-3"}`}>
              {d === 1 ? tr("Собеседники") : tr("+ их собеседники")}
            </button>
          ))}
        </div>
        <select value={params.min} onChange={(e) => setParams((p) => ({ ...p, min: Number(e.target.value) }))} aria-label={tr("Сообщений в диалоге")}
          className="h-9 px-2 rounded-md border border-border bg-surface-2 text-small">
          {MINS.map((m) => <option key={m} value={m}>{tr("от {n} сообщ.", { n: m })}</option>)}
        </select>
        <label className="inline-flex items-center gap-1.5 text-small cursor-pointer">
          <input type="checkbox" checked={params.bots} onChange={(e) => setParams((p) => ({ ...p, bots: e.target.checked }))} className="accent-primary" />
          {tr("Боты")}
        </label>
      </div>

      {error && <p className="text-body text-foreground">{error === "403" ? tr("Раздел только для администраторов.") : tr("Не удалось загрузить: {err}", { err: error })}</p>}

      {data && (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-caption text-subtle">
          <span>{tr("Показано: людей {u}, диалогов {e}", { u: nf().format(nodes.length), e: nf().format(edges.length) })}</span>
          <span>{tr("всего диалогов {n} у {u} человек", { n: nf().format(data.total_edges), u: nf().format(data.total_users) })}</span>
          {data.truncated && <span>{tr("показаны самые активные")}</span>}
          {params.q && !data.matched && <span className="text-foreground">{tr("По нику никого не нашлось")}</span>}
          {/* Легенда — когда цветов два (есть найденные по нику). */}
          {seedsShown && (
            <span className="ml-auto inline-flex items-center gap-3">
              <span className="inline-flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-full" style={{ background: pal.s2 }} />{tr("найденные")}</span>
              <span className="inline-flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-full" style={{ background: pal.s1 }} />{tr("собеседники")}</span>
            </span>
          )}
        </div>
      )}

      <div className="grid gap-3 lg:grid-cols-[1fr_300px]">
        <div ref={boxRef} className="relative h-[62vh] min-h-[380px] rounded-lg border border-border bg-surface-2 overflow-hidden select-none"
          style={{ touchAction: "none" }}
          onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp} onWheel={onWheel}
          onPointerLeave={() => setHover(null)}>
          {loading && !data && <p className="absolute inset-0 flex items-center justify-center text-small text-subtle">{tr("Загружаю…")}</p>}
          {data && !edges.length && !loading && <p className="absolute inset-0 flex items-center justify-center text-small text-subtle px-6 text-center">{tr("Диалогов по этому фильтру нет")}</p>}
          <svg width={size.w} height={size.h} className="block">
            <g transform={`translate(${view.tx},${view.ty}) scale(${view.k})`}>
              {edges.map((e) => {
                const a = pos.get(e.a), b = pos.get(e.b);
                if (!a || !b) return null;
                const on = !!selected && (e.a === selected || e.b === selected);
                const dim = !!neighbors && !on;
                const label = `${byId.get(e.a)?.username} ↔ ${byId.get(e.b)?.username} · ${tr("{n} сообщ.", { n: nf().format(e.n) })} · ${tr("последнее {date}", { date: dateOf(e.last) })}`;
                return (
                  <g key={`${e.a}-${e.b}`}>
                    <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke={on ? pal.s1 : pal.axis} strokeOpacity={dim ? 0.12 : on ? 0.9 : 0.45}
                      strokeWidth={width(e)} vectorEffect="non-scaling-stroke" strokeLinecap="round" />
                    {/* Попадание шире самой линии. */}
                    <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke="transparent" strokeWidth={12} vectorEffect="non-scaling-stroke"
                      onPointerEnter={(ev) => tip(ev, label)} onPointerMove={(ev) => tip(ev, label)} onPointerLeave={() => setHover(null)} />
                  </g>
                );
              })}
              {nodes.map((nd) => {
                const p = pos.get(nd.id);
                if (!p) return null;
                const dim = !!neighbors && !neighbors.has(nd.id);
                const r = radius(nd);
                const label = `${nd.username}${nd.is_bot ? " 🤖" : ""} · ${tr("диалогов {n}", { n: nd.dialogs })} · ${tr("{n} сообщ.", { n: nf().format(nd.messages) })}`;
                return (
                  <g key={nd.id} data-node={nd.id} transform={`translate(${p.x},${p.y})`} opacity={dim ? 0.25 : 1} className="cursor-pointer"
                    onPointerEnter={(ev) => tip(ev, label)} onPointerMove={(ev) => tip(ev, label)} onPointerLeave={() => setHover(null)}>
                    <circle r={r / Math.sqrt(view.k)} fill={nd.seed ? pal.s2 : pal.s1} stroke={pal.surface} strokeWidth={2} vectorEffect="non-scaling-stroke" />
                    {nd.id === selected && <circle r={r / Math.sqrt(view.k) + 4 / view.k} fill="none" stroke={pal.s2} strokeWidth={2} vectorEffect="non-scaling-stroke" />}
                    {labeled.has(nd.id) && (
                      <text y={-(r / Math.sqrt(view.k)) - 4 / view.k} textAnchor="middle" fontSize={11 / view.k}
                        className="fill-foreground" style={{ paintOrder: "stroke", stroke: pal.surface, strokeWidth: 3 / view.k }}>{nd.username}</text>
                    )}
                  </g>
                );
              })}
            </g>
          </svg>
          {hover && (
            <div className="absolute z-10 pointer-events-none max-w-[260px] px-2.5 py-1.5 rounded-md bg-surface-1 border border-border shadow-card text-caption text-foreground"
              style={{ left: Math.min(hover.x + 12, size.w - 270), top: Math.max(8, hover.y - 36) }}>{hover.text}</div>
          )}
          <button type="button" onClick={fit} aria-label={tr("Вписать граф")} title={tr("Вписать граф")}
            className="absolute right-2 bottom-2 w-9 h-9 rounded-md bg-surface-1 border border-border text-foreground flex items-center justify-center active:opacity-70">
            <Maximize2 className="w-4 h-4" />
          </button>
        </div>

        {/* Выбранный человек — его диалоги; иначе — самые активные диалоги таблицей. */}
        <section className="ui-card self-start rounded-lg bg-surface-2 border border-border p-3 max-h-[62vh] overflow-y-auto">
          {sel ? (
            <>
              <div className="flex items-center gap-2.5">
                <Identicon id={sel.id} avatarUrl={sel.avatar_url || undefined} className="w-10 h-10" />
                <div className="min-w-0 flex-1">
                  <p className="text-body font-semibold truncate">{sel.username}{sel.is_bot ? " 🤖" : ""}</p>
                  <p className="text-caption text-subtle">{tr("диалогов {n}", { n: sel.dialogs })} · {tr("{n} сообщ.", { n: nf().format(sel.messages) })}</p>
                  {sel.last_seen && <p className="text-caption text-subtle">{tr("в сети {date}", { date: dateOf(sel.last_seen) })}</p>}
                </div>
                <button type="button" onClick={() => setSelected(null)} aria-label={tr("Закрыть")} className="text-subtle"><X className="w-4 h-4" /></button>
              </div>
              <button type="button" onClick={() => { setInput(sel.username); apply(sel.username); }}
                className="mt-2 w-full h-8 rounded-md bg-primary text-primary-foreground text-small font-medium">{tr("Связи этого человека")}</button>
              {selEdges.length < sel.dialogs && (
                <p className="mt-2 text-caption text-subtle">{tr("Здесь {k} из {n} — остальные вне выборки; все покажет «Связи этого человека».", { k: selEdges.length, n: sel.dialogs })}</p>
              )}
              <ul className="mt-2 divide-y divide-border">
                {selEdges.map((e) => {
                  const other = byId.get(e.a === sel.id ? e.b : e.a);
                  return (
                    <li key={`${e.a}-${e.b}`}>
                      <button type="button" onClick={() => other && setSelected(other.id)} className="w-full py-2 flex items-center gap-2 text-left active:opacity-70">
                        <span className="flex-1 min-w-0 truncate text-small">{other?.username}</span>
                        <span className="text-caption text-subtle tabular-nums">{nf().format(e.n)}</span>
                        <span className="w-16 text-right text-caption text-subtle tabular-nums">{dateOf(e.last)}</span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            </>
          ) : (
            <>
              <h3 className="text-small font-semibold text-foreground">{tr("Самые активные диалоги")}</h3>
              <p className="text-caption text-subtle mt-0.5">{tr("Тап по человеку на графе — его диалоги")}</p>
              <table className="mt-2 w-full text-small">
                <thead><tr className="text-caption text-subtle"><th className="text-left font-normal py-1">{tr("Диалог")}</th><th className="text-right font-normal">{tr("Сообщ.")}</th></tr></thead>
                <tbody className="divide-y divide-border">
                  {topEdges.map((e) => (
                    <tr key={`${e.a}-${e.b}`} className="cursor-pointer active:opacity-70" onClick={() => setSelected(e.a)}>
                      <td className="py-1.5 pr-2 truncate max-w-[200px]">{byId.get(e.a)?.username} ↔ {byId.get(e.b)?.username}</td>
                      <td className="py-1.5 text-right tabular-nums text-subtle">{nf().format(e.n)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          )}
        </section>
      </div>
    </div>
  );
}
