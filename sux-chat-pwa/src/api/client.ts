const API_URL = import.meta.env.VITE_API_URL || "https://sux.cardiokit.beget.tech/api";

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
  register: async (email: string, password: string, username: string): Promise<AuthResponse> => {
    const res = await fetchWithAuth(`${API_URL}/auth/register/`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password, username }),
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

  login: async (email: string, password: string): Promise<{ access: string; refresh: string }> => {
    const res = await fetchWithAuth(`${API_URL}/token/`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: email, password }),
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
};