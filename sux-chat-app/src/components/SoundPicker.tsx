import { useEffect, useRef, useState } from "react";
import { Check, Play, Square, X } from "lucide-react";
import { api, mediaUrl, type NotificationSoundInfo } from "@/api/client";
import { playSfx } from "@/lib/sfx";

/**
 * Выбор звука уведомлений из общего каталога — один компонент на все места:
 * «мой звук» в профиле и звук канала в его настройках. Звук можно послушать,
 * не выбирая; «Без звука» возвращает обычный.
 */
const SoundRow = ({ sound, selected, onPick }: {
  sound: NotificationSoundInfo | null; selected: boolean; onPick: () => void;
}) => {
  const stopRef = useRef<(() => void) | null>(null);
  const [playing, setPlaying] = useState(false);
  const toggle = () => {
    stopRef.current?.();
    if (playing || !sound) { setPlaying(false); return; }
    setPlaying(true);
    playSfx(mediaUrl(sound.url), { volume: 0.7, onEnded: () => setPlaying(false) })
      .then((stop) => { stopRef.current = stop; })
      .catch(() => setPlaying(false));
  };
  useEffect(() => () => stopRef.current?.(), []);
  return (
    <div className={`flex items-center gap-2 px-3 h-12 border-b border-border/60 ${selected ? "bg-primary/10" : ""}`}>
      <button type="button" onClick={toggle} disabled={!sound} className="w-8 h-8 shrink-0 flex items-center justify-center rounded-md bg-surface-4 disabled:opacity-30">
        {playing ? <Square className="w-4 h-4" /> : <Play className="w-4 h-4" />}
      </button>
      <button type="button" onClick={onPick} className="flex-1 min-w-0 text-left">
        <span className="block text-body truncate">{sound ? sound.name : "Без звука"}</span>
        {sound?.pack_name && <span className="block text-caption text-subtle truncate">{sound.pack_name}</span>}
      </button>
      {selected && <Check className="w-4 h-4 text-primary shrink-0" />}
    </div>
  );
};

const SoundPicker = ({ title, current, onPick, onClose }: {
  /** Заголовок шторки: у профиля и у канала он разный. */
  title: string;
  current: string | null;
  onPick: (s: NotificationSoundInfo | null) => void;
  onClose: () => void;
}) => {
  const [sounds, setSounds] = useState<NotificationSoundInfo[] | null>(null);
  useEffect(() => { api.getNotificationSounds().then(setSounds).catch(() => setSounds([])); }, []);
  return (
    <div className="fixed inset-0 z-[90] bg-black/60 flex items-end md:items-center md:justify-center" onClick={onClose}>
      <div className="w-full md:w-[420px] max-h-[80vh] bg-surface-2 rounded-t-[16px] md:rounded-lg flex flex-col pb-[var(--sab)]" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-2 px-4 h-14 shrink-0">
          <span className="text-h2 flex-1">{title}</span>
          <button type="button" onClick={onClose} className="p-1.5 text-subtle" aria-label="Закрыть"><X className="w-4 h-4" /></button>
        </div>
        <div className="overflow-y-auto">
          <SoundRow sound={null} selected={!current} onPick={() => onPick(null)} />
          {sounds === null && <p className="px-4 py-6 text-small text-subtle text-center">Загрузка…</p>}
          {sounds?.map((s) => <SoundRow key={s.id} sound={s} selected={current === s.id} onPick={() => onPick(s)} />)}
          {sounds && sounds.length === 0 && <p className="px-4 py-6 text-small text-subtle text-center">Каталог звуков пуст</p>}
        </div>
      </div>
    </div>
  );
};

export default SoundPicker;
