import { currentTrack, next, playerState, prev, stop, subscribePlayer, toggle } from "@/lib/player";

/**
 * Мост плеера к оболочке компьютера (electron/playerWidget.cjs): мини-плеер
 * поверх окон, меню Dock на Mac и кнопки в превью на панели задач Windows.
 *
 * Туда — состояние: что играет, на паузе ли, эфир ли (в эфире «следующий» и
 * «предыдущий» не работают) и время — не чаще раза в секунду. Оттуда —
 * команды: toggle, next, prev, stop. В вебе и в старых установщиках моста нет.
 */

const api = typeof window !== "undefined" ? window.electronAPI : undefined;

if (api?.playerState && api.onPlayerCmd) {
  const send = api.playerState;
  let lastKey = "";
  let lastTimeAt = 0;
  subscribePlayer(() => {
    const t = currentTrack();
    const s = playerState();
    const info = {
      hasTrack: !!t,
      title: t?.title || "",
      artist: s.live ? `📻 ${s.live.name}` : (t?.artist || ""),
      playing: s.playing,
      live: !!s.live,
    };
    const key = JSON.stringify(info);
    const now = Date.now();
    if (key !== lastKey) {
      lastKey = key;
      lastTimeAt = now;
      send({ ...info, time: s.time, duration: s.duration });
    } else if (info.hasTrack && now - lastTimeAt >= 1000) {
      lastTimeAt = now;
      send({ time: s.time, duration: s.duration });
    }
  });
  api.onPlayerCmd((cmd) => {
    if (cmd === "toggle") void toggle();
    else if (cmd === "next") void next();
    else if (cmd === "prev") void prev();
    else if (cmd === "stop") stop();
  });
}

/** Есть ли мини-плеер (компьютер с новым установщиком). */
export const hasPlayerWidget = !!api?.setPlayerWidget;
