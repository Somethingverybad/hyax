package com.huyax.app;

import android.content.Context;
import android.content.SharedPreferences;
import android.util.Base64;
import java.security.SecureRandom;
import javax.crypto.Cipher;
import javax.crypto.spec.GCMParameterSpec;
import javax.crypto.spec.SecretKeySpec;
import org.json.JSONObject;

/**
 * Ключ шифрования пушей и расшифровка. Ключ (32 байта) генерирует само
 * устройство при первом запуске, отдаёт серверу при регистрации токена и
 * хранит в приватных SharedPreferences — другим приложениям они недоступны,
 * а сервер шифрует им текст пуша (AES-256-GCM, blob = nonce ‖ ciphertext ‖ tag),
 * так что через Google текст идёт нечитаемым. Тот же подход, что у Telegram.
 */
final class PushCrypto {
    private static final String PREFS = "hyax_push";
    private static final String KEY = "secret";

    private PushCrypto() {}

    static synchronized String secret(Context ctx) {
        SharedPreferences sp = ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
        String s = sp.getString(KEY, null);
        if (s == null) {
            byte[] raw = new byte[32];
            new SecureRandom().nextBytes(raw);
            s = Base64.encodeToString(raw, Base64.NO_WRAP);
            sp.edit().putString(KEY, s).apply();
        }
        return s;
    }

    /** null — не расшифровалось (чужой/старый ключ, битые данные). */
    static JSONObject decrypt(Context ctx, String blobB64) {
        try {
            byte[] key = Base64.decode(secret(ctx), Base64.NO_WRAP);
            byte[] blob = Base64.decode(blobB64, Base64.NO_WRAP);
            if (blob.length < 13) return null;
            byte[] nonce = new byte[12];
            System.arraycopy(blob, 0, nonce, 0, 12);
            byte[] ct = new byte[blob.length - 12];
            System.arraycopy(blob, 12, ct, 0, ct.length);
            Cipher c = Cipher.getInstance("AES/GCM/NoPadding");
            c.init(Cipher.DECRYPT_MODE, new SecretKeySpec(key, "AES"), new GCMParameterSpec(128, nonce));
            return new JSONObject(new String(c.doFinal(ct), "UTF-8"));
        } catch (Exception e) {
            return null;
        }
    }
}
