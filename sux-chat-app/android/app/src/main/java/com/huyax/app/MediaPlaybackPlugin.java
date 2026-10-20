package com.huyax.app;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * Плеер при заблокированном экране (src/lib/nativeMedia.ts → MediaPlaybackService).
 *
 * `update` — что играет: title, artist, playing, live, hasPrev, hasNext,
 * position и duration в секундах; `stop` — плеер закрыли. Событие `command`
 * {cmd: play | pause | next | prev | stop | seek, position} — кнопки карточки,
 * экрана блокировки и гарнитуры, пауза при отключении наушников.
 */
@CapacitorPlugin(name = "MediaPlayback")
public class MediaPlaybackPlugin extends Plugin {

    @Override
    public void load() {
        MediaPlaybackService.commands = (cmd, position) -> {
            JSObject data = new JSObject();
            data.put("cmd", cmd);
            data.put("position", position);
            notifyListeners("command", data);
        };
    }

    /** Экран приложения закрыт насовсем — с ним и WebView, который играл. */
    @Override
    protected void handleOnDestroy() {
        MediaPlaybackService.stop();
    }

    @PluginMethod
    public void update(PluginCall call) {
        MediaPlaybackService.Info i = new MediaPlaybackService.Info();
        i.title = call.getString("title", "");
        i.artist = call.getString("artist", "");
        i.playing = Boolean.TRUE.equals(call.getBoolean("playing", false));
        i.live = Boolean.TRUE.equals(call.getBoolean("live", false));
        i.hasPrev = Boolean.TRUE.equals(call.getBoolean("hasPrev", false));
        i.hasNext = Boolean.TRUE.equals(call.getBoolean("hasNext", false));
        i.positionMs = Math.max(0, Math.round(call.getDouble("position", 0.0) * 1000));
        i.durationMs = Math.max(0, Math.round(call.getDouble("duration", 0.0) * 1000));
        MediaPlaybackService.update(getContext(), i);
        call.resolve();
    }

    @PluginMethod
    public void stop(PluginCall call) {
        MediaPlaybackService.stop();
        call.resolve();
    }
}
