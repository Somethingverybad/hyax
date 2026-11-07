import { applog } from "@/lib/applog";

/**
 * Журнал звонка для баг-репорта — без адресов: откуда взяты серверы связи,
 * какие кандидаты у каждой стороны, как менялось соединение и каким путём
 * в итоге пошёл звук (напрямую, через NAT или через TURN).
 *
 * Раньше всё это писалось только в консоль (console.log в журнал отчёта не
 * попадает), и «не слышу собеседника» по отчёту было не разобрать (Satoshi и
 * WerewolfHell, 06.11: сигналы дошли все, а куда делся звук — не видно).
 */
type Count = Record<string, number>;
const peers = new Map<string, { local: Count; remote: Count }>();
const short = (peer: string) => (peer || "?").slice(0, 8);

/** Тип кандидата из строки SDP: host, srflx (через NAT), prflx, relay (TURN). */
const typeOf = (c?: string | null) => /\btyp (\w+)/.exec(c || "")?.[1] || null;

function bump(peer: string, side: "local" | "remote", cand?: string | null) {
  const t = typeOf(cand);
  if (!t) return;
  const k = short(peer);
  let p = peers.get(k);
  if (!p) { p = { local: {}, remote: {} }; peers.set(k, p); }
  p[side][t] = (p[side][t] || 0) + 1;
}
const fmt = (c: Count) => Object.entries(c).map(([t, n]) => `${t}×${n}`).join(" ") || "нет";

export type IceSource = "server" | "cached" | "none";

export const callDiag = {
  /** Какие серверы связи у звонков: без TURN через NAT звук не пройдёт. */
  ice(list: RTCIceServer[], source: IceSource | "retry") {
    const urls = list.flatMap((s) => (Array.isArray(s.urls) ? s.urls : [s.urls]));
    const turn = urls.some((u) => /^turns?:/.test(u));
    const stun = urls.some((u) => /^stun:/.test(u));
    const from = { server: "с сервера", cached: "сохранённые", none: "нет", retry: "с сервера (повтор)" }[source];
    applog[turn ? "info" : "warn"](`call ice ${from}: ${turn ? "turn" : "без turn"}${stun ? " + stun" : ""}`);
  },
  local(peer: string, cand?: string | null) { bump(peer, "local", cand); },
  remote(peer: string, cand?: string | null) { bump(peer, "remote", cand); },
  /** Смена состояния соединения; на итоговых — и сводка кандидатов. */
  state(peer: string, state: string) {
    const p = peers.get(short(peer));
    const final = state === "connected" || state === "failed" || state === "disconnected";
    const line = `call ${short(peer)} ${state}${final && p ? ` · кандидаты наши ${fmt(p.local)}, их ${fmt(p.remote)}` : ""}`;
    applog[state === "failed" ? "warn" : "info"](line);
  },
  /** Каким путём пошло соединение (веб): выбранная пара кандидатов. */
  async path(peer: string, pc: RTCPeerConnection | null | undefined) {
    if (!pc) return;
    try {
      const stats = await pc.getStats();
      let pairId: string | undefined;
      stats.forEach((s: any) => { if (s.type === "transport" && s.selectedCandidatePairId) pairId = s.selectedCandidatePairId; });
      let pair: any;
      stats.forEach((s: any) => {
        if (s.type !== "candidate-pair") return;
        if (pairId ? s.id === pairId : s.nominated && s.state === "succeeded") pair = s;
      });
      if (!pair) return;
      const l: any = stats.get(pair.localCandidateId), r: any = stats.get(pair.remoteCandidateId);
      applog.info(`call ${short(peer)} путь ${l?.candidateType || "?"}/${l?.protocol || "?"}${l?.relayProtocol ? ` (turn по ${l.relayProtocol})` : ""} ↔ ${r?.candidateType || "?"}`);
    } catch { /* статистики нет — не страшно */ }
  },
  reset(peer: string) { peers.delete(short(peer)); },
};
