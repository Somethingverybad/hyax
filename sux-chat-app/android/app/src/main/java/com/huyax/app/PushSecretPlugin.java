package com.huyax.app;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/** Отдаёт странице ключ шифрования пушей — она регистрирует его вместе с FCM-токеном. */
@CapacitorPlugin(name = "PushSecret")
public class PushSecretPlugin extends Plugin {
    @PluginMethod
    public void get(PluginCall call) {
        JSObject r = new JSObject();
        r.put("secret", PushCrypto.secret(getContext()));
        call.resolve(r);
    }
}
