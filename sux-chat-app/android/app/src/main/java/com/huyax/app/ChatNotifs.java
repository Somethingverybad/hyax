package com.huyax.app;

import android.app.NotificationManager;
import android.content.Context;
import android.service.notification.StatusBarNotification;

import java.util.ArrayList;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Set;

/**
 * Уведомления о сообщениях по чатам. Каждое публикуется с тегом chat:<id>
 * (CallMessagingService), поэтому прочитанный чат может убрать свои — и на
 * этом устройстве (ChatNotificationsPlugin), и по тихому пушу chat_read,
 * когда прочитали на другом.
 */
final class ChatNotifs {
    static final int ID = 7001;
    private static final String PREFIX = "chat:";
    /** id сообщения, которое сейчас показывает уведомление чата. */
    static final String EXTRA_MESSAGE = "hyax_message_id";

    private ChatNotifs() {}

    static String tag(String chatId) { return PREFIX + chatId; }

    static void cancel(Context ctx, String chatId) {
        if (chatId == null || chatId.isEmpty()) return;
        NotificationManager nm = (NotificationManager) ctx.getSystemService(Context.NOTIFICATION_SERVICE);
        if (nm == null) return;
        nm.cancel(tag(chatId), ID);
        // Уведомления прежних версий — без тега, номером был hashCode id чата.
        nm.cancel(chatId.hashCode());
    }

    /** Удалили сообщение: у чата одно уведомление — последнее сообщение; если
     *  показывает удалённое — снимаем, если уже новее — оставляем. */
    static void cancelMessage(Context ctx, String chatId, String messageId) {
        if (chatId == null || chatId.isEmpty() || messageId == null || messageId.isEmpty()) return;
        NotificationManager nm = (NotificationManager) ctx.getSystemService(Context.NOTIFICATION_SERVICE);
        if (nm == null) return;
        String t = tag(chatId);
        for (StatusBarNotification sbn : nm.getActiveNotifications()) {
            if (!t.equals(sbn.getTag())) continue;
            String shown = sbn.getNotification().extras.getString(EXTRA_MESSAGE, "");
            if (messageId.equals(shown)) nm.cancel(t, ID);
        }
    }

    static List<String> active(Context ctx) {
        Set<String> out = new LinkedHashSet<>();
        NotificationManager nm = (NotificationManager) ctx.getSystemService(Context.NOTIFICATION_SERVICE);
        if (nm != null) {
            for (StatusBarNotification sbn : nm.getActiveNotifications()) {
                String t = sbn.getTag();
                if (t != null && t.startsWith(PREFIX)) out.add(t.substring(PREFIX.length()));
            }
        }
        return new ArrayList<>(out);
    }
}
