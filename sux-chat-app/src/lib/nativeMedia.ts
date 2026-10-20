import { Capacitor, registerPlugin } from "@capacitor/core";
import { applog } from "@/lib/applog";
import { currentTrack, next, playerState, prev, seek, stop, subscribePlayer, toggle } from "@/lib/player";

/**
 * Android: плеер при заблокированном экране (MediaPlaybackService.java).
 *
 * Звук играет WebView, но без службы переднего плана Android замораживает
 * приложение через несколько секунд после блокировки — музыка и эфир глохнут
 * (баг-репорт 6ff984d2). Пока что-то играет, служба держит процесс и
 * показывает карточку плеера в шторке и на экране блокировки.
 *
 * Туда — что играет, на паузе ли, эфир ли и место в треке: на смене и на
 * перемотке, между ними система досчитывает сама. Оттуда — кнопки карточки и
 * гарнитуры, пауза при отключении наушников. На iOS фоновый звук уже включён,
 * а в старых сборках плагина нет — тогда ничего не делаем.
 */

interface MediaPlayback {
  update(o: { title: string; artist: string; playing: boolean; live: boolean;
              hasPrev: boolean; hasNext: boolean; position: number; duration: number }): Promise<void>;
  stop(): Promise<void>;
  addListener(ev: "command", f: (e: { cmd: string; position?: number }) => void): Promise<unknown>;
}

if (Capacitor.getPlatform() === "android" && Capacitor.isPluginAvailable("MediaPlayback")) {
  const native = registerPlugin<MediaPlayback>("MediaPlayback");
  let lastKey = "";
  let sentAt = 0;
  let sentPos = 0;
  let sentPlaying = false;
  let shown = false;

  subscribePlayer(() => {
    const t = currentTrack();
    const s = playerState();
    if (!t) {
      if (shown) { shown = false; lastKey = ""; void native.stop().catch(() => {}); }
      return;
    }
    const info = {
      title: t.title,
      artist: s.live ? `${t.artist ? `${t.artist} · ` : ""}📻 ${s.live.name}` : (t.artist || "WYX"),
      playing: s.playing,
      live: !!s.live,
      hasPrev: !s.live,
      hasNext: !s.live && s.queue.length > 1,
      duration: Math.round(s.duration || 0),
    };
    const key = JSON.stringify([t.id, info]);
    // Перемотали (или эфир подтянулся к расписанию) — место разошлось с тем,
    // что досчитывает система.
    const drift = Math.abs(s.time - (sentPos + (sentPlaying ? (Date.now() - sentAt) / 1000 : 0)));
    if (key === lastKey && drift < 3) return;
    if (!shown || s.playing !== sentPlaying) applog.info(`media ${s.playing ? "play" : "pause"}${s.live ? " live" : ""}`);
    lastKey = key;
    sentAt = Date.now();
    sentPos = s.time;
    sentPlaying = s.playing;
    shown = true;
    void native.update({ ...info, position: s.time, duration: s.duration || 0 }).catch(() => {});
  });

  void native.addListener("command", ({ cmd, position }) => {
    const s = playerState();
    applog.info(`media cmd ${cmd}`);
    if (cmd === "play") { if (!s.playing) void toggle(); }
    else if (cmd === "pause") { if (s.playing) void toggle(); }
    else if (cmd === "next") void next();
    else if (cmd === "prev") void prev();
    else if (cmd === "stop") stop();
    else if (cmd === "seek" && typeof position === "number") seek(position);
  });
}
