import { api, type PlaylistTrack } from "@/api/client";
import { currentTrack, playerState, playQueue, queueSource, subscribePlayer, type QueueSource, type Track } from "@/lib/player";

/**
 * Где человек остановился в плейлисте — хранится на сервере
 * (PlaylistProgressView, поле resume в ответах о плейлисте), так что
 * продолжить можно и на другом устройстве.
 *
 * Пока играет очередь из плейлиста (player.queueSource), сохраняем трек и
 * секунду: раз в SAVE_EVERY, на паузе, при смене трека и когда очередь
 * сменилась или плеер закрыли. Трек доиграл до конца — запоминаем следующий
 * с начала; доиграл последний — плейлист пройден, в следующий раз с первого.
 */

const SAVE_EVERY = 15_000;

interface Point { src: QueueSource; track: string; pos: number; playing: boolean; queue: Track[]; index: number; duration: number }

let last: Point | null = null;
let savedAt = 0;
let savedKey = "";

function where(p: Point): { track: string; pos: number } {
  // Почти доиграл — продолжать с этого места незачем.
  if (p.duration > 0 && p.pos > p.duration - 3) {
    const next = p.queue[p.index + 1] || p.queue[0];
    return { track: next?.id || p.track, pos: 0 };
  }
  return { track: p.track, pos: p.pos };
}

function save(p: Point) {
  const w = where(p);
  const key = `${p.src.playlistId}:${w.track}:${Math.round(w.pos)}`;
  savedAt = Date.now();
  if (key === savedKey) return;
  savedKey = key;
  api.savePlaylistProgress(p.src.playlistId, w.track, w.pos, p.src.token).catch(() => { savedKey = ""; });
}

subscribePlayer(() => {
  const src = queueSource();
  const t = currentTrack();
  const st = playerState();
  const now: Point | null = src && t && !st.live
    ? { src, track: t.id, pos: st.time, playing: st.playing, queue: st.queue, index: st.index, duration: st.duration }
    : null;
  const prev = last;
  last = now;
  if (prev && (!now || now.src.playlistId !== prev.src.playlistId)) { save(prev); return; }  // сменили очередь или закрыли плеер
  if (!now) return;
  if (prev && prev.track !== now.track) { save({ ...now, pos: 0 }); return; }                 // следующий трек
  if (prev?.playing && !now.playing) { save(now); return; }                                   // пауза или конец
  if (now.playing && Date.now() - savedAt > SAVE_EVERY) save(now);
});

/** Включить плейлист: с места, где остановился (resume с сервера), иначе с первого трека. */
export function playPlaylist(tracks: PlaylistTrack[], toQueue: (t: PlaylistTrack) => Track, src: QueueSource,
                             resume?: { track_id: string; position: number } | null) {
  const queue = tracks.map(toQueue);
  const i = resume ? tracks.findIndex((t) => t.id === resume.track_id) : -1;
  return playQueue(queue, Math.max(0, i), { source: src, at: i >= 0 ? resume!.position : undefined });
}

/** Есть ли куда «продолжить»: трек ещё в плейлисте и плейлист сейчас не играет. */
export function resumeTrack(tracks: PlaylistTrack[] | null, playlistId: string, resume?: { track_id: string; position: number } | null) {
  if (!tracks || !resume) return null;
  if (queueSource()?.playlistId === playlistId && currentTrack()) return null;
  return tracks.find((t) => t.id === resume.track_id) || null;
}
