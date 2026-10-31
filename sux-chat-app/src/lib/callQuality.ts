/**
 * Качество связи в звонке — шкала из четырёх палочек на экране звонка.
 *
 * Браузер и программа WYX — по статистике соединений (getStats): задержка
 * пути, потери пакетов голоса в обе стороны, дрожание. Из них — оценка
 * разборчивости по упрощённой E-модели (MOS 1…4,5), сглаженная, чтобы
 * шкала не мигала.
 *
 * Приложения на телефонах: соединение держит нативный движок, статистики у
 * страницы нет — оценка приблизительная, по задержке до сервера и тому,
 * не рвётся ли соединение (approx).
 */

/** 0 — связь пропала (переподключаемся), 1 — плохо … 4 — отлично. */
export type QualityLevel = 0 | 1 | 2 | 3 | 4;

export type CallQuality = {
  level: QualityLevel;
  /** Задержка туда и обратно, мс. */
  rtt?: number;
  /** Потери пакетов голоса, %. */
  loss?: number;
  /** Дрожание, мс. */
  jitter?: number;
  /** Оценка по задержке до сервера, без статистики самого соединения. */
  approx?: boolean;
};

/** Разборчивость речи по задержке, дрожанию и потерям (упрощённая E-модель). */
export function mosOf(rtt: number, jitter: number, loss: number): number {
  const eff = rtt / 2 + 2 * jitter + 10;
  let r = eff < 160 ? 93.2 - eff / 40 : 93.2 - (eff - 120) / 10;
  r -= 2.5 * loss;
  if (r <= 0) return 1;
  return Math.min(4.5, 1 + 0.035 * r + 0.000007 * r * (r - 60) * (100 - r));
}

export function levelOf(mos: number): QualityLevel {
  if (mos >= 4.1) return 4;
  if (mos >= 3.7) return 3;
  if (mos >= 3.1) return 2;
  return 1;
}

type Counters = { lost: number; recv: number };

/** Замер по соединениям браузера: вызывать раз в 2 с, вернёт null, пока данных нет. */
export class QualityMeter {
  private prev = new WeakMap<RTCPeerConnection, Counters>();
  private seen = new WeakSet<RTCPeerConnection>();
  private mos: number | null = null;

  async sample(pcs: RTCPeerConnection[]): Promise<CallQuality | null> {
    if (!pcs.length) return null;
    // Новое соединение (новый звонок, новый участник) — сглаживание с нуля.
    if (pcs.some((pc) => !this.seen.has(pc))) {
      this.mos = null;
      pcs.forEach((pc) => this.seen.add(pc));
    }
    if (pcs.some((pc) => pc.iceConnectionState === "disconnected" || pc.connectionState === "failed")) {
      this.mos = null;
      return { level: 0 };
    }
    const rows = (await Promise.all(pcs.map((pc) => this.one(pc).catch(() => null)))).filter((x): x is Required<Omit<CallQuality, "level" | "approx">> => !!x);
    if (!rows.length) return null;
    // Несколько соединений (групповой звонок) — средняя: шкала про мою связь,
    // а не про самого слабого участника.
    const rtt = avg(rows.map((r) => r.rtt));
    const loss = avg(rows.map((r) => r.loss));
    const jitter = avg(rows.map((r) => r.jitter));
    const mos = mosOf(rtt, jitter, loss);
    this.mos = this.mos === null ? mos : this.mos * 0.6 + mos * 0.4;
    return { level: levelOf(this.mos), rtt: Math.round(rtt), loss: Math.round(loss * 10) / 10, jitter: Math.round(jitter) };
  }

  private async one(pc: RTCPeerConnection): Promise<{ rtt: number; loss: number; jitter: number } | null> {
    const stats = await pc.getStats();
    let pairId: string | undefined;
    stats.forEach((s) => { if (s.type === "transport" && s.selectedCandidatePairId) pairId = s.selectedCandidatePairId; });
    let rtt: number | undefined;
    let lost = 0;
    let recv = 0;
    let jitter = 0;
    let outLoss = 0;
    let remoteRtt: number | undefined;
    stats.forEach((s) => {
      if (s.type === "candidate-pair" && (pairId ? s.id === pairId : s.nominated && s.state === "succeeded") && typeof s.currentRoundTripTime === "number") {
        rtt = s.currentRoundTripTime * 1000;
      } else if (s.type === "inbound-rtp" && s.kind === "audio") {
        lost += Math.max(0, s.packetsLost || 0);
        recv += s.packetsReceived || 0;
        if (typeof s.jitter === "number") jitter = Math.max(jitter, s.jitter * 1000);
      } else if (s.type === "remote-inbound-rtp" && s.kind === "audio") {
        // Что собеседник недополучает от меня — по его отчётам RTCP.
        if (typeof s.fractionLost === "number") outLoss = Math.max(outLoss, s.fractionLost * 100);
        if (typeof s.roundTripTime === "number") remoteRtt = s.roundTripTime * 1000;
      }
    });
    rtt ??= remoteRtt;
    if (rtt === undefined) return null;
    const p = this.prev.get(pc);
    this.prev.set(pc, { lost, recv });
    const dl = p ? lost - p.lost : 0;
    const dr = p ? recv - p.recv : 0;
    const inLoss = dl + dr > 0 ? (100 * dl) / (dl + dr) : 0;
    return { rtt, loss: Math.max(inLoss, outLoss), jitter };
  }
}

const avg = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;

/** Приложение на телефоне: по задержке до сервера (мс) и состоянию соединения. */
export function approxQuality(serverRtt: number | null, linkDown: boolean): CallQuality | null {
  if (linkDown) return { level: 0, approx: true };
  if (serverRtt === null) return null;
  // Это задержка до сервера, а не до собеседника — пороги грубые.
  const level: QualityLevel = serverRtt < 150 ? 4 : serverRtt < 300 ? 3 : serverRtt < 700 ? 2 : 1;
  return { level, rtt: Math.round(serverRtt), approx: true };
}
