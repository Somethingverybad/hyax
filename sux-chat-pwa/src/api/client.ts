// API URL: использует переменную окружения или значение по умолчанию
// В продакшене (Docker) используем относительный путь, так как PWA и API на одном домене
// Для локальной разработки: http://localhost:8000/api
const API_URL = import.meta.env.VITE_API_URL || 
  (import.meta.env.DEV 
    ? "http://localhost:8000/api" 
    : "/api");  // Относительный путь для работы через nginx

// WebSocket URL
export const WS_URL = import.meta.env.VITE_WS_URL || 
  (import.meta.env.DEV 
    ? "ws://localhost:8000/ws" 
    : `${window.location.protocol === 'https:' ? 'wss:' : 'ws:'}//${window.location.host}/ws`);

function buildIceServers(): RTCIceServer[] {
  const servers: RTCIceServer[] = [{ urls: "stun:stun.l.google.com:19302" }];
  const turnUrl = import.meta.env.VITE_TURN_URL;
  const turnUsername = import.meta.env.VITE_TURN_USERNAME;
  const turnCredential = import.meta.env.VITE_TURN_CREDENTIAL;

  if (turnUrl && turnUsername && turnCredential) {
    servers.push({
      urls: turnUrl,
      username: turnUsername,
      credential: turnCredential,
    });
  }

  return servers;
}

export const ICE_SERVERS = buildIceServers();



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

  // Если access token устарел — пробуем обновить
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
    // Для login не используем fetchWithAuth, так как токена еще нет
    const res = await fetch(`${API_URL}/token/`, {
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

  createChat: async (participantIds: string[]): Promise<Chat> => {
    const res = await fetchWithAuth(`${API_URL}/chats/`, {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({ participants: participantIds }),
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

  sendMessage: async (chatId: string, content: string): Promise<any> => {
    const res = await fetchWithAuth(`${API_URL}/messages/`, {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({ chat: chatId, content }),
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
  uploadFile: async (file: File): Promise<{
    file_url: string;
    file_name: string;
    file_size: number;
  }> => {
    const formData = new FormData();
    formData.append('file', file);

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
  }, content?: string): Promise<any> => {
    const res = await fetchWithAuth(`${API_URL}/messages/`, {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({
        chat: chatId,
        content: content || null,
        file_url: fileData.file_url,
        file_name: fileData.file_name,
        file_size: fileData.file_size
      }),
    });
    return res.json();
  },

  // ===== STICKERS =====
  uploadSticker: async (file: File): Promise<{
    file_url: string;
    file_name: string;
  }> => {
    const formData = new FormData();
    formData.append('file', file);

    const res = await fetchWithAuthMultipart(`${API_URL}/stickers/upload/`, {
      method: "POST",
      body: formData,
    });

    if (!res.ok) {
      const errorText = await res.text();
      console.error("Sticker upload error:", errorText);
      throw new Error(`Sticker upload failed: ${res.status} ${res.statusText}`);
    }

    return res.json();
  },

  createStickerPack: async (name: string, description?: string, isPublic: boolean = true): Promise<any> => {
    const res = await fetchWithAuth(`${API_URL}/sticker-packs/`, {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({ name, description, is_public: isPublic }),
    });
    if (!res.ok) throw new Error("Failed to create sticker pack");
    return res.json();
  },

  getStickerPacks: async (): Promise<any[]> => {
    const res = await fetchWithAuth(`${API_URL}/sticker-packs/`, {
      method: "GET",
      headers: authHeaders(),
    });
    return res.json();
  },

  getMyStickerPacks: async (): Promise<any[]> => {
    const res = await fetchWithAuth(`${API_URL}/sticker-packs/my_packs/`, {
      method: "GET",
      headers: authHeaders(),
    });
    return res.json();
  },

  saveStickerPack: async (packId: string): Promise<void> => {
    const res = await fetchWithAuth(`${API_URL}/sticker-packs/${packId}/save/`, {
      method: "POST",
      headers: authHeaders(),
    });
    if (!res.ok) throw new Error("Failed to save sticker pack");
  },

  unsaveStickerPack: async (packId: string): Promise<void> => {
    const res = await fetchWithAuth(`${API_URL}/sticker-packs/${packId}/unsave/`, {
      method: "POST",
      headers: authHeaders(),
    });
    if (!res.ok) throw new Error("Failed to unsave sticker pack");
  },

  createSticker: async (packId: string, fileUrl: string, fileName: string, emoji?: string, order?: number): Promise<any> => {
    const res = await fetchWithAuth(`${API_URL}/stickers/`, {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({
        pack: packId,
        file_url: fileUrl,
        file_name: fileName,
        emoji: emoji || null,
        order: order || 0,
      }),
    });
    if (!res.ok) throw new Error("Failed to create sticker");
    return res.json();
  },

  getStickers: async (packId?: string): Promise<any[]> => {
    const url = packId 
      ? `${API_URL}/stickers/?pack=${packId}`
      : `${API_URL}/stickers/`;
    const res = await fetchWithAuth(url, {
      method: "GET",
      headers: authHeaders(),
    });
    return res.json();
  },

  sendMessageWithSticker: async (chatId: string, stickerId: string, content?: string): Promise<any> => {
    const res = await fetchWithAuth(`${API_URL}/messages/`, {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({
        chat: chatId,
        content: content || null,
        sticker_id: stickerId,
      }),
    });
    return res.json();
  },

  deleteStickerPack: async (packId: string): Promise<void> => {
    const res = await fetchWithAuth(`${API_URL}/sticker-packs/${packId}/`, {
      method: "DELETE",
      headers: authHeaders(),
    });
    if (!res.ok) throw new Error("Failed to delete sticker pack");
  },

  deleteSticker: async (stickerId: string): Promise<void> => {
    const res = await fetchWithAuth(`${API_URL}/stickers/${stickerId}/`, {
      method: "DELETE",
      headers: authHeaders(),
    });
    if (!res.ok) throw new Error("Failed to delete sticker");
  },

  getStickerPackById: async (packId: string): Promise<any> => {
    const res = await fetchWithAuth(`${API_URL}/sticker-packs/${packId}/`, {
      method: "GET",
      headers: authHeaders(),
    });
    if (!res.ok) throw new Error("Failed to get sticker pack");
    return res.json();
  },

  shareStickerPack: async (packId: string): Promise<{ share_code: string }> => {
    const res = await fetchWithAuth(`${API_URL}/sticker-packs/${packId}/share/`, {
      method: "POST",
      headers: authHeaders(),
    });
    if (!res.ok) throw new Error("Failed to generate share code");
    return res.json();
  },

  importStickerPackByCode: async (shareCode: string): Promise<any> => {
    const res = await fetchWithAuth(`${API_URL}/sticker-packs/import/`, {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({ share_code: shareCode }),
    });
    if (!res.ok) throw new Error("Failed to import sticker pack");
    return res.json();
  },

  // ===== VOICE MESSAGES =====
  uploadVoice: async (file: Blob): Promise<{
    file_url: string;
    file_name: string;
  }> => {
    const formData = new FormData();
    formData.append('file', file, 'voice.webm');

    const res = await fetchWithAuthMultipart(`${API_URL}/voice/upload/`, {
      method: "POST",
      body: formData,
    });

    if (!res.ok) {
      const errorText = await res.text();
      console.error("Voice upload error:", errorText);
      throw new Error(`Voice upload failed: ${res.status} ${res.statusText}`);
    }

    return res.json();
  },

  sendMessageWithVoice: async (chatId: string, voiceUrl: string, duration: number, content?: string): Promise<any> => {
    const res = await fetchWithAuth(`${API_URL}/messages/`, {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({
        chat: chatId,
        content: content || null,
        voice_url: voiceUrl,
        voice_duration: duration,
      }),
    });
    return res.json();
  },

  // ===== PROFILE MANAGEMENT =====
  // Примечание: основные методы getProfile() и getProfileById() уже определены выше
  // Здесь только дополнительные методы для управления профилем
  
  getMyProfile: async (): Promise<any> => {
    const res = await fetchWithAuth(`${API_URL}/profiles/me/`, {
      method: "GET",
      headers: authHeaders(),
    });
    if (!res.ok) throw new Error("Failed to get my profile");
    return res.json();
  },

  updateMyProfile: async (bio: string): Promise<any> => {
    const res = await fetchWithAuth(`${API_URL}/profiles/update_me/`, {
      method: "PATCH",
      headers: authHeaders(),
      body: JSON.stringify({ bio }),
    });
    if (!res.ok) throw new Error("Failed to update profile");
    return res.json();
  },

  uploadAvatar: async (file: File): Promise<{ avatar_url: string }> => {
    const formData = new FormData();
    formData.append('file', file);

    const res = await fetchWithAuthMultipart(`${API_URL}/avatar/upload/`, {
      method: "POST",
      body: formData,
    });

    if (!res.ok) {
      const errorText = await res.text();
      console.error("Avatar upload error:", errorText);
      throw new Error(`Avatar upload failed: ${res.status} ${res.statusText}`);
    }

    return res.json();
  },
};
