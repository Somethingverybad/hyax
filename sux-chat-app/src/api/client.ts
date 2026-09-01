const API_URL = import.meta.env.VITE_API_URL || "https://huyax.e-tree.su/api";

// Сервер отдаёт пути к медиа относительными (/media/...). В вебе они
// резолвятся от домена сайта, а в приложении WebView живёт на
// capacitor://localhost — и картинка искалась бы внутри бандла. Достраиваем
// до абсолютного URL от хоста API.
const MEDIA_ORIGIN = API_URL.replace(/\/api\/?$/, "");
// WebSocket для сигналинга звонков и уведомлений: тот же хост, что API.
export const WS_URL = `${MEDIA_ORIGIN.replace(/^http/, "ws")}/ws`;

export function mediaUrl(path?: string | null): string {
  if (!path) return "";
  if (/^(https?:|blob:|data:)/.test(path)) return path;
  return `${MEDIA_ORIGIN}${path.startsWith("/") ? "" : "/"}${path}`;
}

interface AuthResponse {
  message: string;
  error?: string;
  user_id?: string;
}

interface Profile {
  id: string;
  username: string;
  avatar_url?: string;
  status?: string;
  created_at?: string;
  user?: any;
}

interface Chat {
  id: string;
  participants: Profile[];
  created_at?: string;
  is_group?: boolean;
  name?: string;
  avatar_url?: string | null;
  creator?: string | null;
}

export interface ChatInfo {
  id: string;
  name?: string;
  is_group?: boolean;
  avatar_url?: string | null;
  creator?: string | null;
  participants?: Profile[];
}

export interface NotificationSoundInfo {
  id: string;
  slug: string;
  name: string;
  url: string;      // исходник — проигрывается в приложении
  caf_url: string;  // вариант для APNs, докачивается в Library/Sounds на iOS
  pack?: string | null;
  pack_name?: string;
  updated_at: string;
}

interface UnreadCountResponse {
  total_unread: number;
  unread_by_chat: Record<string, number>;
}

async function fetchWithAuth(input: RequestInfo, init?: RequestInit): Promise<Response> {
  const token = localStorage.getItem("access_token");
  const authInit = {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(init?.headers || {}),
      Authorization: token ? `Bearer ${token}` : "",
    },
  };

  let res = await fetch(input, authInit);

  // Эндпоинты авторизации обновлять нечем и незачем: 401 там означает
  // «неверные данные», а не «протух токен». Без этой проверки обёртка лезла
  // обновлять несуществующий refresh и подменяла ответ сервера своей ошибкой —
  // пользователь видел «no refresh token» вместо «неверный логин или пароль».
  const url = typeof input === "string" ? input : (input as Request).url;
  const isAuthEndpoint = /\/(token|auth\/register)\/?$/.test(url)
    || url.includes("/token/refresh");

  // Если access token устарел — пробуем обновить
  if (res.status === 401 && !isAuthEndpoint) {
    const refreshToken = localStorage.getItem("refresh_token");
    if (!refreshToken) throw new Error("Unauthorized: no refresh token");

    try {
      const refreshRes = await fetch(`${API_URL}/token/refresh/`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ refresh: refreshToken }),
      });

      if (!refreshRes.ok) {
        // Refresh token тоже недействителен
        localStorage.removeItem("access_token");
        localStorage.removeItem("refresh_token");
        throw new Error("Refresh token expired, please login again");
      }

      const data = await refreshRes.json();
      localStorage.setItem("access_token", data.access);

      // Повторяем исходный запрос с новым токеном
      const retryInit = {
        ...authInit,
        headers: {
          ...(authInit.headers as Record<string, string>),
          Authorization: `Bearer ${data.access}`,
        },
      };
      res = await fetch(input, retryInit);
    } catch (err) {
      throw err;
    }
  }

  return res;
}

/**
 * Токен для WebSocket. Обычные запросы обновляют токен по 401, а сокету
 * ответить нечем: сервер просто закрывает соединение. Поэтому проверяем
 * срок жизни заранее и при необходимости обновляем перед подключением —
 * иначе после протухания сокет не переподключится никогда, и пропадут
 * realtime-сообщения и звонки.
 */
export async function getFreshAccessToken(): Promise<string | undefined> {
  const token = localStorage.getItem("access_token") || undefined;
  const refresh = localStorage.getItem("refresh_token");
  const expiresAt = (t?: string): number => {
    if (!t) return 0;
    try {
      return (JSON.parse(atob(t.split(".")[1]))?.exp || 0) * 1000;
    } catch {
      return 0;
    }
  };

  // Запас в минуту: подключение не должно стартовать с почти мёртвым токеном.
  if (token && expiresAt(token) - Date.now() > 60_000) return token;
  if (!refresh) return token;

  try {
    const res = await fetch(`${API_URL}/token/refresh/`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ refresh }),
    });
    if (!res.ok) return token;
    const data = await res.json();
    if (data.access) {
      localStorage.setItem("access_token", data.access);
      return data.access;
    }
  } catch {
    /* сеть подведёт — пробуем старым токеном */
  }
  return token;
}

function authHeaders() {
  const token = localStorage.getItem("access_token");
  return {
    "Content-Type": "application/json",
    Authorization: token ? `Bearer ${token}` : "",
  };
}

// Добавим функцию для загрузки файлов
async function fetchWithAuthMultipart(input: RequestInfo, init?: RequestInit): Promise<Response> {
  const token = localStorage.getItem("access_token");
  const authInit = {
    ...init,
    headers: {
      ...(init?.headers || {}),
      Authorization: token ? `Bearer ${token}` : "",
    },
  };

  let res = await fetch(input, authInit);

  // Если access token устарел — пробуем обновить (та же логика что и в fetchWithAuth)
  if (res.status === 401) {
    const refreshToken = localStorage.getItem("refresh_token");
    if (!refreshToken) throw new Error("Unauthorized: no refresh token");

    try {
      const refreshRes = await fetch(`${API_URL}/token/refresh/`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ refresh: refreshToken }),
      });

      if (!refreshRes.ok) {
        localStorage.removeItem("access_token");
        localStorage.removeItem("refresh_token");
        throw new Error("Refresh token expired, please login again");
      }

      const data = await refreshRes.json();
      localStorage.setItem("access_token", data.access);

      const retryInit = {
        ...authInit,
        headers: {
          ...(authInit.headers as Record<string, string>),
          Authorization: `Bearer ${data.access}`,
        },
      };
      res = await fetch(input, retryInit);
    } catch (err) {
      throw err;
    }
  }

  return res;
}


export const api = {
  // ===== AUTH =====
  register: async (username: string, password: string): Promise<AuthResponse> => {
    const res = await fetchWithAuth(`${API_URL}/auth/register/`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, password }),
    });

    if (!res.ok) {
      const fullResponseText = await res.text();
      console.log("🔴🔴🔴 ПОЛНЫЙ ОТВЕТ СЕРВЕРА (register):");
      console.log("----------------------------------------");
      console.log(fullResponseText);
      console.log("----------------------------------------");
      console.log("Длина ответа:", fullResponseText.length, "символов");
      
      const error = new Error(`Register failed: ${res.status} ${res.statusText}`);
      (error as any).fullResponse = fullResponseText;
      throw error;
    }

    return res.json();
  },

  login: async (username: string, password: string): Promise<{ access: string; refresh: string }> => {
    const res = await fetchWithAuth(`${API_URL}/token/`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, password }),
    });

    if (!res.ok) {
      const fullResponseText = await res.text();
      console.log("🔴🔴🔴 ПОЛНЫЙ ОТВЕТ СЕРВЕРА (login):");
      console.log("----------------------------------------");
      console.log(fullResponseText);
      console.log("----------------------------------------");
      console.log("Длина ответа:", fullResponseText.length, "символов");
      
      const error = new Error(`Login failed: ${res.status} ${res.statusText}`);
      (error as any).fullResponse = fullResponseText;
      throw error;
    }

    const data = await res.json();
    localStorage.setItem("access_token", data.access);
    localStorage.setItem("refresh_token", data.refresh);
    return data;
  },

  logout: async (): Promise<AuthResponse> => {
    localStorage.removeItem("access_token");
    localStorage.removeItem("refresh_token");
    return { message: "Logged out" };
  },

  // ===== PROFILES =====
  getCurrentUser: async (): Promise<Profile> => {
    const res = await fetchWithAuth(`${API_URL}/profiles/current/`, {
      method: "GET",
      headers: authHeaders(),
    });
    if (!res.ok) throw new Error("Failed to get current user");
    return res.json();
  },

  getProfile: async (profileId?: string): Promise<Profile> => {
    if (profileId) {
      const res = await fetchWithAuth(`${API_URL}/profiles/${profileId}/`, {
        method: "GET",
        headers: authHeaders(),
      });
      return res.json();
    } else {
      return api.getCurrentUser();
    }
  },

  searchUsers: async (query: string): Promise<Profile[]> => {
    const res = await fetchWithAuth(`${API_URL}/profiles/?search=${encodeURIComponent(query)}`, {
      method: "GET",
      headers: authHeaders(),
    });
    if (!res.ok) throw new Error(`Search failed: ${res.status}`);
    return res.json();
  },

  getProfileById: async (profileId: string): Promise<Profile> => {
    const res = await fetchWithAuth(`${API_URL}/profiles/${profileId}/`, {
      method: "GET",
      headers: authHeaders(),
    });
    return res.json();
  },

  // ===== CHATS =====
  getChats: async (): Promise<Chat[]> => {
    const res = await fetchWithAuth(`${API_URL}/chats/`, {
      method: "GET",
      headers: authHeaders(),
    });
    return res.json();
  },

  getChatParticipants: async (chatId: string): Promise<Profile[]> => {
    const res = await fetchWithAuth(`${API_URL}/chats/${chatId}/participants/`, {
      method: "GET",
      headers: authHeaders(),
    });
    if (!res.ok) throw new Error("Failed to get chat participants");
    return res.json();
  },

  createChat: async (participantIds: string[], group?: { name: string; avatarUrl?: string }): Promise<Chat> => {
    const res = await fetchWithAuth(`${API_URL}/chats/`, {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({
        participants: participantIds,
        ...(group ? { is_group: true, name: group.name, avatar_url: group.avatarUrl || undefined } : {}),
      }),
    });
    if (!res.ok) {
      const errorData = await res.json();
      if (res.status === 400 && errorData.detail?.includes("exists")) {
        const error = new Error("exists");
        (error as any).chatId = errorData.chat_id;
        throw error;
      }
      throw new Error(errorData.detail || "Failed to create chat");
    }
    return res.json();
  },

  createDirectChat: async (friendId: string): Promise<Chat> => {
    try {
      return await api.createChat([friendId]);
    } catch (error: any) {
      if (error.message === "exists") {
        const err = new Error("exists") as any;
        err.chatId = error.chatId;
        throw err;
      }
      throw error;
    }
  },

  getChat: async (chatId: string): Promise<Chat> => {
    const res = await fetchWithAuth(`${API_URL}/chats/${chatId}/`, {
      method: "GET",
      headers: authHeaders(),
    });
    return res.json();
  },

  // ===== MESSAGES =====
  getMessages: async (chatId: string): Promise<any[]> => {
    const res = await fetchWithAuth(`${API_URL}/messages/?chat=${chatId}`, {
      method: "GET",
      headers: authHeaders(),
    });
    return res.json();
  },

  sendMessage: async (chatId: string, content: string, soundId?: string, replyToId?: string): Promise<any> => {
    const res = await fetchWithAuth(`${API_URL}/messages/`, {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({ chat: chatId, content, sound_id: soundId || undefined, reply_to_id: replyToId || undefined }),
    });
    return res.json();
  },

  // ===== MESSAGE READ STATUS =====
  markMessageAsRead: async (messageId: string): Promise<void> => {
    const res = await fetchWithAuth(`${API_URL}/messages/${messageId}/mark_as_read/`, {
      method: "POST",
      headers: authHeaders(),
    });
    if (!res.ok) throw new Error("Failed to mark message as read");
    return res.json();
  },

  markChatAsRead: async (chatId: string): Promise<void> => {
    const res = await fetchWithAuth(`${API_URL}/messages/mark_chat_as_read/`, {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({ chat_id: chatId }),
    });
    if (!res.ok) throw new Error("Failed to mark chat as read");
    return res.json();
  },

  getUnreadCount: async (): Promise<UnreadCountResponse> => {
    const res = await fetchWithAuth(`${API_URL}/messages/unread_count/`, {
      method: "GET",
      headers: authHeaders(),
    });
    if (!res.ok) throw new Error("Failed to get unread count");
    return res.json();
  },

  // ===== FRIENDSHIPS =====
  getFriends: async (): Promise<Profile[]> => {
    const res = await fetchWithAuth(`${API_URL}/friendships/`, {
      method: "GET",
      headers: authHeaders(),
    });
    return res.json();
  },

  deleteChat: async (chatId: string): Promise<void> => {
    const res = await fetchWithAuth(`${API_URL}/chats/${chatId}/`, {
      method: "DELETE",
      headers: authHeaders(),
    });
    if (!res.ok) throw new Error("Failed to delete chat");
  },

  leaveChat: async (chatId: string): Promise<void> => {
    const res = await fetchWithAuth(`${API_URL}/chats/${chatId}/leave/`, {
      method: "POST",
      headers: authHeaders(),
    });
    if (!res.ok) throw new Error("Failed to leave chat");
  },

  addFriend: async (friendId: string): Promise<any> => {
    const res = await fetchWithAuth(`${API_URL}/friendships/`, {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({ to_user: friendId }),
    });
    return res.json();
  },
// ===== FILE UPLOAD =====
  uploadFile: async (file: File, compress?: string): Promise<{
    file_url: string;
    file_name: string;
    file_size: number;
  }> => {
    const formData = new FormData();
    formData.append('file', file);
    if (compress) formData.append('compress', compress);

    const res = await fetchWithAuthMultipart(`${API_URL}/upload/`, {
      method: "POST",
      body: formData,
    });

    if (!res.ok) {
      const errorText = await res.text();
      console.error("Upload error:", errorText);
      throw new Error(`File upload failed: ${res.status} ${res.statusText}`);
    }

    return res.json();
  },

  sendMessageWithFile: async (chatId: string, fileData: {
    file_url: string;
    file_name: string;
    file_size: number;
  }, content?: string, soundId?: string, replyToId?: string): Promise<any> => {
    const res = await fetchWithAuth(`${API_URL}/messages/`, {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({
        chat: chatId,
        content: content || null,
        file_url: fileData.file_url,
        file_name: fileData.file_name,
        file_size: fileData.file_size,
        sound_id: soundId || undefined,
        reply_to_id: replyToId || undefined
      }),
    });
    return res.json();
  },

  // ===== ГОЛОСОВЫЕ СООБЩЕНИЯ =====
  uploadVoice: async (file: File): Promise<{ file_url: string; file_name: string }> => {
    const formData = new FormData();
    formData.append("file", file);
    const res = await fetchWithAuthMultipart(`${API_URL}/voice/upload/`, {
      method: "POST",
      body: formData,
    });
    if (!res.ok) throw new Error(`Voice upload failed: ${res.status}`);
    return res.json();
  },

  sendMessageWithVoice: async (chatId: string, voiceUrl: string, duration: number): Promise<any> => {
    const res = await fetchWithAuth(`${API_URL}/messages/`, {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({ chat: chatId, voice_url: voiceUrl, voice_duration: duration }),
    });
    if (!res.ok) throw new Error("Не удалось отправить голосовое");
    return res.json();
  },

  // Настройки группы (название, аватар) — только для админа-создателя.
  configureGroup: async (chatId: string, data: { name?: string; avatarUrl?: string }): Promise<ChatInfo> => {
    const body: Record<string, string> = {};
    if (data.name !== undefined) body.name = data.name;
    if (data.avatarUrl !== undefined) body.avatar_url = data.avatarUrl;
    const res = await fetchWithAuth(`${API_URL}/chats/${chatId}/configure/`, {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const e = await res.json().catch(() => ({}));
      throw new Error(e.error || "Не удалось сохранить группу");
    }
    return res.json();
  },

  addChatParticipants: async (chatId: string, participantIds: string[]): Promise<any> => {
    const res = await fetchWithAuth(`${API_URL}/chats/${chatId}/add_participants/`, {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({ participants: participantIds }),
    });
    if (!res.ok) throw new Error("Не удалось добавить участников");
    return res.json();
  },

  sendMessageWithVideo: async (chatId: string, videoUrl: string, duration: number): Promise<any> => {
    const res = await fetchWithAuth(`${API_URL}/messages/`, {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({ chat: chatId, video_url: videoUrl, video_duration: duration }),
    });
    if (!res.ok) throw new Error("Не удалось отправить видео-сообщение");
    return res.json();
  },

  // ===== ЗВОНКИ =====
  // ICE-серверы (STUN + TURN с кредами) приходят с сервера — в сборке ничего
  // секретного, и TURN можно поменять без релиза.
  getIceServers: async (): Promise<RTCIceServer[]> => {
    try {
      const res = await fetchWithAuth(`${API_URL}/ice-servers/`, {
        method: "GET",
        headers: authHeaders(),
      });
      if (!res.ok) throw new Error(String(res.status));
      const data = await res.json();
      return data.iceServers || [];
    } catch {
      return [{ urls: "stun:stun.l.google.com:19302" }];
    }
  },

  // ===== ЗВУКИ УВЕДОМЛЕНИЙ (аудио-стикеры) =====
  // Временная подписанная ссылка на приватное вложение (S3). Маркер s3://key.
  signMedia: async (marker: string): Promise<string> => {
    const key = marker.replace(/^s3:\/\//, "");
    const res = await fetchWithAuth(`${API_URL}/media/sign/?key=${encodeURIComponent(key)}`, {
      method: "GET",
      headers: authHeaders(),
    });
    if (!res.ok) throw new Error("sign failed");
    const d = await res.json();
    return d.url as string;
  },

  getNotificationSounds: async (): Promise<NotificationSoundInfo[]> => {
    const res = await fetchWithAuth(`${API_URL}/sounds/`, {
      method: "GET",
      headers: authHeaders(),
    });
    if (!res.ok) return [];
    return res.json();
  },

  // ===== СТИКЕРЫ =====
  // Перенесено из веб-версии: бэкенд стикеры поддерживает давно, в мобильном
  // приложении их просто не было.
  getMyStickerPacks: async (): Promise<any[]> => {
    const res = await fetchWithAuth(`${API_URL}/sticker-packs/my_packs/`, {
      method: "GET",
      headers: authHeaders(),
    });
    if (!res.ok) throw new Error("Failed to load sticker packs");
    return res.json();
  },

  getStickers: async (packId?: string): Promise<any[]> => {
    const url = packId ? `${API_URL}/stickers/?pack=${packId}` : `${API_URL}/stickers/`;
    const res = await fetchWithAuth(url, {
      method: "GET",
      headers: authHeaders(),
    });
    if (!res.ok) throw new Error("Failed to load stickers");
    return res.json();
  },

  sendMessageWithSticker: async (chatId: string, stickerId: string, content?: string, replyToId?: string): Promise<any> => {
    const res = await fetchWithAuth(`${API_URL}/messages/`, {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({
        chat: chatId,
        content: content || null,
        sticker_id: stickerId,
        reply_to_id: replyToId || undefined,
      }),
    });
    if (!res.ok) throw new Error("Failed to send sticker");
    return res.json();
  },


  // Создание наборов прямо в приложении: сначала файл уходит на сервер и
  // возвращает ссылку, затем стикер привязывается к набору.
  uploadSticker: async (file: File): Promise<{ file_url: string; file_name: string }> => {
    const formData = new FormData();
    formData.append("file", file);
    const res = await fetchWithAuthMultipart(`${API_URL}/stickers/upload/`, {
      method: "POST",
      body: formData,
    });
    if (!res.ok) throw new Error("Не удалось загрузить файл стикера");
    return res.json();
  },

  createStickerPack: async (name: string, description?: string, isPublic = true): Promise<any> => {
    const res = await fetchWithAuth(`${API_URL}/sticker-packs/`, {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({ name, description, is_public: isPublic }),
    });
    if (!res.ok) throw new Error("Не удалось создать набор");
    return res.json();
  },

  createSticker: async (packId: string, fileUrl: string, fileName: string, order = 0): Promise<any> => {
    const res = await fetchWithAuth(`${API_URL}/stickers/`, {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({ pack: packId, file_url: fileUrl, file_name: fileName, order }),
    });
    if (!res.ok) throw new Error("Не удалось добавить стикер");
    return res.json();
  },


  // ===== ПРОФИЛЬ =====
  updateProfile: async (profileId: string, data: { username?: string; bio?: string }): Promise<any> => {
    const res = await fetchWithAuth(`${API_URL}/profiles/${profileId}/`, {
      method: "PATCH",
      headers: authHeaders(),
      body: JSON.stringify(data),
    });
    if (!res.ok) {
      let msg = "Не удалось сохранить профиль";
      try {
        const body = await res.json();
        msg = body.username?.[0] || body.bio?.[0] || body.error || msg;
      } catch { /* тело не JSON */ }
      throw new Error(msg);
    }
    return res.json();
  },

  uploadAvatar: async (file: File): Promise<{ avatar_url: string }> => {
    const formData = new FormData();
    formData.append("file", file);
    const res = await fetchWithAuthMultipart(`${API_URL}/avatar/upload/`, {
      method: "POST",
      body: formData,
    });
    if (!res.ok) throw new Error("Не удалось загрузить аватар");
    return res.json();
  },


  // Регистрация FCM-токена устройства. Профиль берётся из сессии на сервере.
  registerPushToken: async (token: string, platform: string): Promise<any> => {
    const res = await fetchWithAuth(`${API_URL}/push/register/`, {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({ token, platform }),
    });
    if (!res.ok) throw new Error("Не удалось зарегистрировать устройство");
    return res.json();
  },

};