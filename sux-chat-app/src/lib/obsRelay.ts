/**
 * Трансляция звонка в OBS — сторона стримера (браузер и программа для компьютера).
 *
 * В OBS добавлена страница /obs.html с ключом стримера (источник «Браузер»).
 * Она входит в сокет по ключу и здоровается («hello»); это приложение — оно и
 * так получает голоса всех участников и свой микрофон — отдаёт их странице
 * отдельным WebRTC-соединением, каждого участника своим потоком: на странице
 * можно оставить одного (#peer=<id>), и в микшере OBS у каждого будет свой
 * ползунок. Компьютер тот же — звук не уходит дальше него.
 *
 * Сигналы ходят через сервер (obs_signal в сокете пользователя, chat/obs.py):
 *   страница → hello {page, want}, answer {page, to, sdp}, ice {page, to, candidate}, bye {page}
 *   приложение → ping, offer {page, from, sdp, roster}, roster {page, from, roster}, ice {page, from, candidate}, stop {page, from}
 * Оферы всегда от приложения: состав поменялся — новый офер в том же соединении.
 */
import { mediaUrl } from "@/api/client";
import { applog } from "@/lib/applog";
import { getLang } from "@/lib/i18n";

export type ObsSource = {
  id: string;
  name: string;
  avatarUrl?: string | null;
  track: MediaStreamTrack | null;
  self?: boolean;
};

export type ObsRosterItem = { id: string; name: string; avatar: string | null; stream: string; self: boolean };

type Page = {
  id: string;
  want: string | null;
  pc: RTCPeerConnection;
  senders: Map<string, RTCRtpSender>;
  /** Ждём ответа на офер — следующий офер только после него. */
  waiting: boolean;
  again: boolean;
  roster: string;
  iceQueue: RTCIceCandidateInit[];
};

type Signal = { kind?: string; page?: string; to?: string; want?: string | null; sdp?: string; candidate?: RTCIceCandidateInit };

export class ObsRelay {
  /** Этот экземпляр приложения: у стримера может быть открыто несколько. */
  readonly id = Math.random().toString(36).slice(2, 10);
  private on = false;
  private pages = new Map<string, Page>();
  /** Поток на участника — по его id страница узнаёт, чей это голос. */
  private streams = new Map<string, MediaStream>();

  constructor(
    private send: (data: Record<string, unknown>) => void,
    private sources: () => ObsSource[],
    private iceServers: () => RTCIceServer[],
    private onPages: (count: number) => void,
  ) {}

  get active() { return this.on; }

  /** Включить: страницы, что уже открыты в OBS, отзовутся на ping. */
  start(): void {
    if (this.on) return;
    this.on = true;
    this.send({ kind: "ping", from: this.id });
  }

  stop(): void {
    if (!this.on) return;
    this.on = false;
    for (const p of this.pages.values()) {
      this.send({ kind: "stop", page: p.id, from: this.id });
      p.pc.close();
    }
    this.pages.clear();
    this.streams.clear();
    this.onPages(0);
  }

  /** Сигнал от страницы (obs_signal из сокета). */
  handle(d: Signal): void {
    if (!this.on || !d || typeof d.page !== "string") return;
    if (d.to && d.to !== this.id) return;
    const page = this.pages.get(d.page);
    switch (d.kind) {
      case "hello":
        if (page) this.close(page);
        this.open(d.page, typeof d.want === "string" && d.want ? d.want : null);
        break;
      case "answer":
        if (page && d.sdp) void this.onAnswer(page, d.sdp);
        break;
      case "ice":
        if (page && d.candidate) {
          if (page.pc.remoteDescription) void page.pc.addIceCandidate(d.candidate).catch(() => {});
          else page.iceQueue.push(d.candidate);
        }
        break;
      case "bye":
        if (page) this.close(page);
        break;
    }
  }

  /** Состав звонка или дорожки поменялись (вошёл, вышел, переоткрыли микрофон). */
  sync(): void {
    if (!this.on) return;
    for (const p of this.pages.values()) this.syncPage(p);
  }

  private open(id: string, want: string | null): void {
    const pc = new RTCPeerConnection({ iceServers: this.iceServers() });
    const page: Page = { id, want, pc, senders: new Map(), waiting: false, again: false, roster: "", iceQueue: [] };
    pc.onicecandidate = (e) => {
      if (e.candidate) this.send({ kind: "ice", page: id, from: this.id, candidate: e.candidate.toJSON() });
    };
    pc.onconnectionstatechange = () => {
      applog.info(`obs page ${id.slice(0, 6)} ${pc.connectionState}`);
      if (pc.connectionState === "failed") this.close(page);
    };
    this.pages.set(id, page);
    this.onPages(this.pages.size);
    this.syncPage(page, true);
  }

  private close(page: Page): void {
    page.pc.close();
    this.pages.delete(page.id);
    this.onPages(this.pages.size);
  }

  private streamFor(id: string): MediaStream {
    let s = this.streams.get(id);
    if (!s) { s = new MediaStream(); this.streams.set(id, s); }
    return s;
  }

  private syncPage(page: Page, fresh = false): void {
    const list = this.sources().filter((s) => s.track && s.track.readyState === "live" && (!page.want || s.id === page.want));
    let changed = fresh;
    for (const s of list) {
      const sender = page.senders.get(s.id);
      if (sender) {
        // Тот же участник, новая дорожка (переоткрыли микрофон) — без пересогласования.
        if (sender.track !== s.track) void sender.replaceTrack(s.track).catch(() => {});
      } else {
        page.senders.set(s.id, page.pc.addTrack(s.track!, this.streamFor(s.id)));
        changed = true;
      }
    }
    for (const [id, sender] of page.senders) {
      if (list.some((s) => s.id === id)) continue;
      try { page.pc.removeTrack(sender); } catch { /* соединение закрыто */ }
      page.senders.delete(id);
      changed = true;
    }
    const roster: ObsRosterItem[] = list.map((s) => ({
      id: s.id, name: s.name, avatar: s.avatarUrl ? mediaUrl(s.avatarUrl) : null, stream: this.streamFor(s.id).id, self: !!s.self,
    }));
    const key = JSON.stringify(roster);
    if (changed) void this.offer(page, roster);
    else if (key !== page.roster) this.send({ kind: "roster", page: page.id, from: this.id, roster });
    page.roster = key;
  }

  private async offer(page: Page, roster: ObsRosterItem[]): Promise<void> {
    if (page.waiting) { page.again = true; return; }
    page.waiting = true;
    try {
      const offer = await page.pc.createOffer();
      await page.pc.setLocalDescription(offer);
      this.send({ kind: "offer", page: page.id, from: this.id, sdp: page.pc.localDescription?.sdp, roster });
    } catch (e) {
      page.waiting = false;
      applog.warn(`obs offer: ${String((e as Error)?.message || e)}`);
    }
  }

  private async onAnswer(page: Page, sdp: string): Promise<void> {
    try {
      await page.pc.setRemoteDescription({ type: "answer", sdp });
      for (const c of page.iceQueue.splice(0)) await page.pc.addIceCandidate(c).catch(() => {});
    } catch (e) {
      applog.warn(`obs answer: ${String((e as Error)?.message || e)}`);
    }
    page.waiting = false;
    if (page.again && this.pages.has(page.id)) {
      page.again = false;
      page.roster = "";
      this.syncPage(page, true);
    }
  }
}

/** Ссылка для источника «Браузер» в OBS: весь звонок или один участник. */
export function obsLink(key: string, peerId?: string | null): string {
  const web = typeof location !== "undefined" && /^https?:$/.test(location.protocol);
  // Программа для компьютера живёт на app:// — страница всё равно на сайте.
  const base = web ? location.origin : "https://huyax.e-tree.su";
  const params = new URLSearchParams({ key });
  if (peerId) params.set("peer", peerId);
  // Подсказки на странице (видны в предпросмотре OBS) — на языке приложения.
  if (getLang() !== "ru") params.set("lang", getLang());
  // Разработка: сайт с vite, сервер отдельно — подсказываем странице, куда идти.
  const api = (import.meta.env.VITE_API_URL as string | undefined)?.replace(/\/api\/?$/, "");
  if (web && api && !api.startsWith(location.origin)) params.set("ws", `${api.replace(/^http/, "ws")}/ws`);
  return `${base}/obs.html#${params.toString()}`;
}
