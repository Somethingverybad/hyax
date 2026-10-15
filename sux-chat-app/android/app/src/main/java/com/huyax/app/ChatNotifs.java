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
