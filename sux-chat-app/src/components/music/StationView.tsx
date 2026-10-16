import { t as tr, tn } from "@/lib/i18n";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Ban, Check, ChevronLeft, Flag, Heart, Pause, Play, Plus, Radio, SkipForward, Square } from "lucide-react";
import { SettingsCard, SettingsRow } from "@/components/settings";
import Identicon from "@/components/Identicon";
import ReportSheet from "@/components/ReportSheet";
import { api, type PlaylistTrack, type StationInfo } from "@/api/client";
import { confirmDialog } from "@/lib/confirm";
import { readCache } from "@/lib/session-cache";
import { fmtTime, toggle, usePlayer } from "@/lib/player";
import { applyControl, joinStation, leaveStation, useRadio } from "@/lib/radio";
import { cn } from "@/lib/utils";

/** Название эфира: «Моя музыка» переводим, свои названия — как есть. */
export const stationName = (s: { name: string; is_default: boolean }) => (s.is_default ? tr(s.name) : s.name);

/**
 * Экран эфира: что играет сейчас и дальше, кто слушает. Открыли — значит,
 * слушаем: подключаемся сразу. Ушли с экрана — эфир играет дальше, как и
 * обычная музыка; выйти из эфира — кнопкой внизу или крестиком плеера.
 * Ведущему (владельцу, админу канала) — пропуск, пауза и остановка.
 */
const StationView = ({ item, onBack }: { item: StationInfo; onBack: () => void }) => {
  const radio = useRadio();
  const player = usePlayer();
  const joined = radio.stationId === item.id;
  const data = joined ? radio.data : null;
  const info = data?.station || item;
  const [taken, setTaken] = useState<Set<string>>(new Set());
  const [reportFor, setReportFor] = useState<PlaylistTrack | null>(null);
  const [busy, setBusy] = useState(false);
  const isAdmin = !!readCache<{ is_admin?: boolean }>("user")?.is_admin;

  useEffect(() => { if (radio.stationId !== item.id) void joinStation(item.id); }, [item.id]);

  const take = async (t: PlaylistTrack) => {
    if (taken.has(t.id)) return;
    try {
      const r = await api.addTrackFromPublic(t.id);
      setTaken((s) => new Set(s).add(t.id));
      toast.success(r.already ? tr("Уже есть в «Моей музыке»") : tr("Добавлено в «Мою музыку»"));
    } catch (e: any) { toast.error(e?.message || tr("Не получилось")); }
  };

  const control = async (action: "skip" | "pause" | "resume") => {
    if (busy) return;
    setBusy(true);
    try { applyControl(await api.controlStation(item.id, action)); }
    catch (e: any) { toast.error(e?.message || tr("Не получилось")); }
    finally { setBusy(false); }
  };

  const stopAir = async () => {
    if (!(await confirmDialog(tr("Остановить эфир «{name}»? Слушатели его потеряют.", { name: stationName(info) }), { ok: tr("Остановить") }))) return;
    try {
      await api.stopStation(item.id);
      leaveStation();
      toast.success(tr("Эфир остановлен"));
      onBack();
    } catch (e: any) { toast.error(e?.message || tr("Не получилось")); }
  };

  const takedown = async (t: PlaylistTrack) => {
    if (!(await confirmDialog(tr("Снять «{name}» везде — из всех плейлистов, эфиров и сообщений? Это для жалоб правообладателей, вернуть нельзя.", { name: t.title }), { ok: tr("Снять") }))) return;
    try {
      const r = await api.takedownTrack(t.id);
      toast.success(tr("Снято: плейлистов {p}, сообщений {m}", { p: r.tracks, m: r.messages }));
    } catch (e: any) { toast.error(e?.message || tr("Не получилось")); }
  };

  const now = data?.now || null;
  const live = joined && player.live?.stationId === item.id;
  const frac = live && player.duration ? Math.min(1, player.time / player.duration) : 0;
  const src = info.channel ? { id: info.channel.id, avatar: info.channel.avatar_url, name: info.channel.name }
                           : { id: info.owner.id, avatar: info.owner.avatar_url, name: info.owner.username };

  // Кнопки трека: забрать себе, пожаловаться, админу — снять везде.
  const trackActions = (t: PlaylistTrack) => (
    <span className="flex items-center shrink-0">
      <button type="button" onClick={(e) => { e.stopPropagation(); void take(t); }}
        className={cn("p-2", taken.has(t.id) ? "text-primary" : "text-subtle active:text-primary")}
        aria-label={taken.has(t.id) ? tr("Добавлено в «Мою музыку»") : tr("В «Мою музыку»")}>
        {taken.has(t.id) ? <Check className="w-4 h-4" /> : <Plus className="w-4 h-4" />}
      </button>
      {!info.mine && (
        <button type="button" onClick={(e) => { e.stopPropagation(); setReportFor(t); }}
          className="p-2 text-subtle active:text-destructive" aria-label={tr("Пожаловаться на трек")}>
          <Flag className="w-4 h-4" />
        </button>
      )}
      {isAdmin && (
        <button type="button" onClick={(e) => { e.stopPropagation(); void takedown(t); }}
          className="p-2 text-subtle active:text-destructive" aria-label={tr("Снять трек везде")}>
          <Ban className="w-4 h-4" />
        </button>
      )}
    </span>
  );

  return (
    <>
      <div className="shrink-0 px-2 py-3 pad-safe-top bg-background border-b border-border min-h-14 flex items-center gap-2">
        <button type="button" onClick={onBack} className="ui-icon-btn p-2" aria-label={tr("Назад")}>
          <ChevronLeft className="w-5 h-5" />
        </button>
        <span className="text-h2 flex-1 truncate">{stationName(info)}</span>
        <span className={cn("shrink-0 px-2 h-6 rounded-full text-caption font-semibold flex items-center gap-1",
          info.paused ? "bg-surface-4 text-subtle" : "bg-destructive text-destructive-foreground")}>
          <Radio className="w-3.5 h-3.5" /> {info.paused ? tr("Пауза") : tr("Эфир")}
        </span>
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-3" style={{ paddingBottom: "calc(16px + var(--mint-nav-space, 0px))" }}>
        <div className="flex items-center gap-3 px-1">
          <Identicon id={src.id} avatarUrl={src.avatar} className="w-9 h-9 rounded-md shrink-0" />
          <div className="min-w-0 flex-1">
            <p className="text-small truncate"><b>{src.name}</b></p>
            <p className="text-caption text-subtle">
              {tn(info.listeners, "{n} слушает", "{n} слушают", "{n} слушают")}
            </p>
          </div>
          {/* Кто слушает — до пяти аватарок, свежие первыми. */}
          <div className="flex -space-x-2 shrink-0">
            {info.listeners_preview.map((p) => (
              <Identicon key={p.id} id={p.id} avatarUrl={p.avatar_url} className="w-7 h-7 rounded-full ring-2 ring-background" />
            ))}
          </div>
        </div>

        <div className="ui-card rounded-lg bg-surface-2 border border-border p-4 space-y-3">
          <p className="text-caption text-subtle">{tr("Сейчас играет")}</p>
          {!now ? (
            <p className="text-body text-subtle">{radio.joining || !data ? tr("Подключаюсь…") : tr("В эфире пока тихо")}</p>
          ) : (
            <>
              <div className="flex items-start gap-2">
                <div className="min-w-0 flex-1">
                  <p className="text-h2 break-words">{now.track.title}</p>
                  {now.track.artist && <p className="text-small text-subtle">{now.track.artist}</p>}
                </div>
                {trackActions(now.track)}
              </div>
              {/* Полоса без перемотки: место в эфире у всех одно. */}
              <div className="h-1.5 rounded-full bg-black/20 overflow-hidden">
                <div className="h-full rounded-full bg-primary" style={{ width: `${frac * 100}%` }} />
              </div>
              <div className="flex items-center justify-between text-caption text-subtle tabular-nums">
                <span>{live ? fmtTime(player.time) : ""}</span>
                <span>{info.paused ? tr("Эфир на паузе") : live && player.duration ? fmtTime(player.duration) : ""}</span>
              </div>
              <div className="flex items-center justify-center gap-3">
                {live && (
                  <button type="button" onClick={() => void toggle()}
                    className="w-12 h-12 rounded-full bg-primary text-primary-foreground flex items-center justify-center"
                    aria-label={player.playing ? tr("Пауза") : tr("Играть")}>
                    {player.playing ? <Pause className="w-5 h-5" /> : <Play className="w-5 h-5" />}
                  </button>
                )}
                <button type="button" onClick={() => void take(now.track)}
                  className={cn("h-10 px-4 rounded-full border border-border flex items-center gap-2 text-small",
                    taken.has(now.track.id) ? "text-primary" : "text-foreground")}>
                  <Heart className={cn("w-4 h-4", taken.has(now.track.id) && "fill-current")} />
                  {taken.has(now.track.id) ? tr("У вас") : tr("Себе")}
                </button>
              </div>
            </>
          )}
        </div>

        {info.can_control && (
          <div className="grid grid-cols-3 gap-2">
            <button type="button" disabled={busy || !now} onClick={() => void control("skip")}
              className="h-11 rounded-md bg-surface-4 flex items-center justify-center gap-1.5 text-small disabled:opacity-50">
              <SkipForward className="w-4 h-4" /> {tr("Дальше")}
            </button>
            <button type="button" disabled={busy || !now} onClick={() => void control(info.paused ? "resume" : "pause")}
              className="h-11 rounded-md bg-surface-4 flex items-center justify-center gap-1.5 text-small disabled:opacity-50">
              {info.paused ? <Play className="w-4 h-4" /> : <Pause className="w-4 h-4" />} {info.paused ? tr("Продолжить") : tr("Пауза")}
            </button>
            <button type="button" onClick={() => void stopAir()}
              className="h-11 rounded-md bg-surface-4 text-destructive flex items-center justify-center gap-1.5 text-small">
              <Square className="w-4 h-4" /> {tr("Стоп")}
            </button>
          </div>
        )}

        {!!data?.next.length && (
          <>
            <p className="px-1 pt-1 text-small font-semibold text-subtle">{tr("Дальше в эфире")}</p>
            <SettingsCard>
              {data.next.map((n) => (
                <SettingsRow key={`${n.track.id}-${n.started_at}`} label={n.track.title} hint={n.track.artist || undefined}
                  trailing={trackActions(n.track)} />
              ))}
            </SettingsCard>
          </>
        )}

        {joined ? (
          <button type="button" onClick={() => { leaveStation(); onBack(); }}
            className="w-full h-11 rounded-md border border-border text-small font-medium active:opacity-80">
            {tr("Выйти из эфира")}
          </button>
        ) : (
          <button type="button" onClick={() => void joinStation(item.id)}
            className="w-full h-11 rounded-md bg-primary text-primary-foreground text-small font-medium active:opacity-90">
            {tr("Слушать")}
          </button>
        )}
        <p className="px-1 text-caption text-subtle">
          {tr("Все слушают эфир одновременно: перемотки нет, трек меняется у всех разом. Понравившееся забирайте себе — а потом запускайте свой эфир из любого плейлиста.")}
        </p>
      </div>

      {reportFor && (
        <ReportSheet target={{ type: "track", id: reportFor.id }} title={reportFor.title} onClose={() => setReportFor(null)} />
      )}
    </>
  );
};

export default StationView;
