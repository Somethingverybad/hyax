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
 * Видео — тем же соединением, но только странице, которая его просит
 * (hello video: "cam" — камера вместе с голосом в потоке участника, "screen" —
 * демонстрация отдельным потоком). Браузер заново кодирует каждое переданное
 * видео, поэтому странице «только звук» его не шлём.
 *
 * Сигналы ходят через сервер (obs_signal в сокете пользователя, chat/obs.py):
 *   страница → hello {page, want, video?, audio?}, answer {page, to, sdp}, ice {page, to, candidate}, bye {page}
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
  /** Камера (дорожка может быть и выключенной — см. videoOn). */
  video?: MediaStreamTrack | null;
  videoOn?: boolean;
  /** Демонстрация экрана — только пока показывает. */
  screen?: MediaStreamTrack | null;
  /** Звук компьютера при демонстрации (если показывает со звуком). */
  screenAudio?: MediaStreamTrack | null;
};

/** video — камера включена; screen — id потока демонстрации, пока показывает. */
export type ObsRosterItem = { id: string; name: string; avatar: string | null; stream: string; self: boolean; video?: boolean; screen?: string | null };

/** Что хочет видеть страница: камеры (с голосом) или демонстрации. */
export type ObsView = "cam" | "screen";

// Своё соединение на этом же компьютере: сеть не ограничивает, держим качество.
const CAM_BITRATE = 4_000_000;
const SCREEN_BITRATE = 8_000_000;

type Page = {
  id: string;
  want: string | null;
  video: ObsView | null;
  audio: boolean;
  /** Странице «Экран» — и звук компьютера показывающего (без голосов). */
  screenAudio: boolean;
  pc: RTCPeerConnection;
  senders: Map<string, RTCRtpSender>;
  /** Ждём ответа на офер — следующий офер только после него. */
  waiting: boolean;
  again: boolean;
  roster: string;
  iceQueue: RTCIceCandidateInit[];
};

type Signal = { kind?: string; page?: string; to?: string; want?: string | null; video?: string; audio?: boolean; screen_audio?: boolean; sdp?: string; candidate?: RTCIceCandidateInit };

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
        this.open(d.page, typeof d.want === "string" && d.want ? d.want : null,
          d.video === "cam" || d.video === "screen" ? d.video : null, d.audio !== false, d.screen_audio === true);
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

  private open(id: string, want: string | null, video: ObsView | null, audio: boolean, screenAudio: boolean): void {
    const pc = new RTCPeerConnection({ iceServers: this.iceServers() });
    const page: Page = { id, want, video, audio, screenAudio, pc, senders: new Map(), waiting: false, again: false, roster: "", iceQueue: [] };
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
    const live = (t?: MediaStreamTrack | null): t is MediaStreamTrack => !!t && t.readyState === "live";
    const list = this.sources().filter((s) => (live(s.track) || live(s.video) || live(s.screen)) && (!page.want || s.id === page.want));
    // Дорожки этой странице: ключ — участник (голос), #cam, #screen.
    const tracks = new Map<string, { track: MediaStreamTrack; stream: MediaStream; kind: "audio" | "screenAudio" | ObsView }>();
    for (const s of list) {
      if (page.audio && live(s.track)) tracks.set(s.id, { track: s.track, stream: this.streamFor(s.id), kind: "audio" });
      if (page.video === "cam" && live(s.video)) tracks.set(`${s.id}#cam`, { track: s.video, stream: this.streamFor(s.id), kind: "cam" });
      if (page.video === "screen" && live(s.screen)) tracks.set(`${s.id}#screen`, { track: s.screen, stream: this.streamFor(`${s.id}#screen`), kind: "screen" });
      // Звук компьютера — в тот же поток, что демонстрация: страница «Экран» его и играет.
      if (page.video === "screen" && page.screenAudio && live(s.screen) && live(s.screenAudio)) {
        tracks.set(`${s.id}#screen-audio`, { track: s.screenAudio, stream: this.streamFor(`${s.id}#screen`), kind: "screenAudio" });
      }
    }
    let changed = fresh;
    for (const [key, t] of tracks) {
      const sender = page.senders.get(key);
      if (sender) {
        // Тот же участник, новая дорожка (переоткрыли микрофон) — без пересогласования.
        if (sender.track !== t.track) void sender.replaceTrack(t.track).catch(() => {});
      } else if (t.kind === "audio" || t.kind === "screenAudio") {
        page.senders.set(key, page.pc.addTrack(t.track, t.stream));
        changed = true;
      } else {
        // Демонстрации — чёткость важнее плавности (кодек держит разрешение).
        if (t.kind === "screen") { try { t.track.contentHint = "detail"; } catch { /* старый браузер */ } }
        const tx = page.pc.addTransceiver(t.track, {
          direction: "sendonly",
          streams: [t.stream],
          sendEncodings: [{ maxBitrate: t.kind === "screen" ? SCREEN_BITRATE : CAM_BITRATE, maxFramerate: 30 }],
        });
        page.senders.set(key, tx.sender);
        changed = true;
      }
    }
    for (const [key, sender] of page.senders) {
      if (tracks.has(key)) continue;
      // Видеоканал не убираем, а оставляем пустым: камеру включат снова —
      // дорожка встанет в него без пересогласования, каналы не копятся.
      if (key.includes("#")) {
        if (sender.track) void sender.replaceTrack(null).catch(() => {});
        continue;
      }
      try { page.pc.removeTrack(sender); } catch { /* соединение закрыто */ }
      page.senders.delete(key);
      changed = true;
    }
    const roster: ObsRosterItem[] = list.map((s) => ({
      id: s.id, name: s.name, avatar: s.avatarUrl ? mediaUrl(s.avatarUrl) : null, stream: this.streamFor(s.id).id, self: !!s.self,
      video: !!s.videoOn && live(s.video),
      screen: live(s.screen) ? this.streamFor(`${s.id}#screen`).id : null,
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

/** Ссылка для источника «Браузер» в OBS: весь звонок или один участник;
 *  view — видео: камеры (с голосом) или демонстрация экрана (без звука). */
export function obsLink(key: string, peerId?: string | null, view?: ObsView | null): string {
  const web = typeof location !== "undefined" && /^https?:$/.test(location.protocol);
  // Программа для компьютера живёт на app:// — страница всё равно на сайте.
  const base = web ? location.origin : "https://huyax.e-tree.su";
  const params = new URLSearchParams({ key });
  if (peerId) params.set("peer", peerId);
  if (view === "cam") params.set("view", "video");
  if (view === "screen") params.set("view", "screen");
  // Подсказки на странице (видны в предпросмотре OBS) — на языке приложения.
  if (getLang() !== "ru") params.set("lang", getLang());
  // Разработка: сайт с vite, сервер отдельно — подсказываем странице, куда идти.
  const api = (import.meta.env.VITE_API_URL as string | undefined)?.replace(/\/api\/?$/, "");
  if (web && api && !api.startsWith(location.origin)) params.set("ws", `${api.replace(/^http/, "ws")}/ws`);
  return `${base}/obs.html#${params.toString()}`;
}
