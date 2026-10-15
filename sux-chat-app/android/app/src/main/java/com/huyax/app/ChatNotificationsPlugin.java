package com.huyax.app;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/** Убрать уведомления прочитанных чатов и узнать, по каким чатам они висят (см. ChatNotifs). */
@CapacitorPlugin(name = "ChatNotifications")
public class ChatNotificationsPlugin extends Plugin {
    @PluginMethod
    public void dismiss(PluginCall call) {
        JSArray ids = call.getArray("chatIds");
        if (ids != null) {
            for (int i = 0; i < ids.length(); i++) {
                ChatNotifs.cancel(getContext(), ids.optString(i, ""));
            }
        }
        call.resolve();
    }

    @PluginMethod
    public void list(PluginCall call) {
        JSArray out = new JSArray();
        for (String id : ChatNotifs.active(getContext())) out.put(id);
        JSObject r = new JSObject();
        r.put("chatIds", out);
        call.resolve(r);
    }
}
