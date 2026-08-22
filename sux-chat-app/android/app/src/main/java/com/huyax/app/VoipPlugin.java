package com.huyax.app;

import android.content.Context;
import android.media.AudioManager;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import org.json.JSONObject;

/**
 * Android-половина плагина Voip (та же JS-поверхность, что у iOS/CallKit).
 * Нативный экран входящего рисует CallNotifications; здесь — мост к JS:
 * «звонок принят из уведомления», «отклонён», «входящий, пока приложение
 * в фоне», плюс отложенная доставка, если JS ещё не загрузился.
 */
@CapacitorPlugin(name = "Voip")
public class VoipPlugin extends Plugin {

    private static VoipPlugin instance;
    private static JSONObject pendingCall;
    private static boolean pendingAnswered;

    @Override
    public void load() {
        instance = this;
    }

    @PluginMethod
    public void register(PluginCall call) {
        call.resolve();
    }

    @PluginMethod
    public void getPendingAnswer(PluginCall call) {
        JSObject ret = new JSObject();
        if (pendingCall != null) {
            ret.put("call", toJS(pendingCall));
            ret.put("answered", pendingAnswered);
            pendingCall = null;
        } else {
            ret.put("call", JSONObject.NULL);
            ret.put("answered", false);
        }
        call.resolve(ret);
    }

    @PluginMethod
    public void reportOutgoingCall(PluginCall call) {
        call.resolve();
    }

    @PluginMethod
    public void reportConnected(PluginCall call) {
        call.resolve();
    }

    @PluginMethod
    public void setSpeaker(PluginCall call) {
        boolean enabled = call.getBoolean("enabled", true);
        AudioManager am = (AudioManager) getContext().getSystemService(Context.AUDIO_SERVICE);
        if (am != null) {
            // MODE_IN_COMMUNICATION включает эхоподавление и правильный
            // маршрут; без него WebView играет разговор через мультимедиа.
            am.setMode(AudioManager.MODE_IN_COMMUNICATION);
            am.setSpeakerphoneOn(enabled);
        }
        call.resolve();
    }

    @PluginMethod
    public void endCall(PluginCall call) {
        CallNotifications.cancel(getContext());
        AudioManager am = (AudioManager) getContext().getSystemService(Context.AUDIO_SERVICE);
        if (am != null) {
            am.setSpeakerphoneOn(false);
            am.setMode(AudioManager.MODE_NORMAL);
        }
        call.resolve();
    }

    /** Из уведомления/активити: пользователь принял (answered) или звонок просто показан. */
    static void deliverCall(JSONObject call, boolean answered) {
        if (instance != null && instance.getBridge() != null) {
            instance.notifyListeners(answered ? "callAnswered" : "callIncoming", toJS(call), true);
        } else {
            pendingCall = call;
            pendingAnswered = answered;
        }
    }

    private static JSObject toJS(JSONObject o) {
        try {
            return JSObject.fromJSONObject(o);
        } catch (Exception e) {
            return new JSObject();
        }
    }

    static void deliverEnded(String callId) {
        if (pendingCall != null && callId != null && callId.equals(pendingCall.optString("callId"))) {
            pendingCall = null;
        }
        if (instance != null && instance.getBridge() != null) {
            JSObject data = new JSObject();
            data.put("callId", callId);
            instance.notifyListeners("callEnded", data, true);
        }
    }
}
