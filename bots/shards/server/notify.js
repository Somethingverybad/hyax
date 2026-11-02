// Бот игры в WYX: отвечает на сообщения кнопкой «Играть» и пишет в личку,
// когда пришёл ход игрока, которого нет в игре. Без токена — молчит.

import WebSocket from "ws";
import { readFileSync, writeFileSync } from "node:fs";

export function createNotifier({ token, api, ws, appUrl, file, reply = true, log = console }) {
  // Личные чаты с ботом: id пользователя → id чата. Узнаём из входящих сообщений.
  let chats = {};
  try { chats = JSON.parse(readFileSync(file, "utf8")); } catch { /* первый запуск */ }
  const save = () => { try { writeFileSync(file, JSON.stringify(chats)); } catch (e) { log.error("chats.json", e.message); } };
  const headers = { Authorization: `Bot ${token}`, "Content-Type": "application/json" };

  async function send(chatId, content, url = appUrl, text = "⚔️ Играть") {
    const r = await fetch(`${api}/messages/`, {
      method: "POST", headers,
      body: JSON.stringify({ chat: chatId, content, buttons: [[{ text, web_app: { url } }]] }),
    });
    if (!r.ok) throw new Error(`messages: ${r.status}`);
  }

  async function listen() {
    const r = await fetch(`${api}/profiles/current/`, { headers });
    if (!r.ok) throw new Error(`whoami: ${r.status}`);
    const me = await r.json();
    await new Promise((resolve) => {
      const sock = new WebSocket(`${ws}/user/${me.id}/?token=${token}`);
      const ping = setInterval(() => sock.readyState === WebSocket.OPEN && sock.ping(), 30000);
      sock.on("open", () => log.info(`бот на связи: @${me.username}`));
      sock.on("message", (raw) => {
        let body;
        try { body = JSON.parse(raw.toString()).data || {}; } catch { return; }
        if (body.type !== "new_message") return;
        const m = body.message || {};
        const from = m.sender?.id;
        const chat = body.chat_id || m.chat;
        if (!from || !chat || String(from) === String(me.id)) return;
        if (body.chat_kind && body.chat_kind !== "direct") return;
        if (chats[from] !== String(chat)) { chats[from] = String(chat); save(); }
        // Бот может открывать другое приложение — тогда о партиях только уведомления.
        if (reply) send(chat, "Осколки Короны — пошаговая стратегия на 2–4 игрока: герои, замки, бои на гексах.\n\n"
          + "Создайте партию и позовите друзей кодом комнаты — или сыграйте против компьютера. "
          + "Когда придёт ваш ход, я напишу сюда.").catch((e) => log.warn("ответ боту:", e.message));
      });
      sock.on("close", () => { clearInterval(ping); resolve(); });
      sock.on("error", (e) => log.warn("сокет бота:", e.message));
    });
  }

  if (token && api && ws) {
    (async () => {
      for (;;) {
        try { await listen(); } catch (e) { log.warn("бот:", e.message); }
        await new Promise((r) => setTimeout(r, 5000));
      }
    })();
  }

  return {
    /** Ход пришёл: написать игроку, если знаем его личный чат с ботом. */
    async turn(uid, text, code) {
      const chat = chats[uid];
      if (!token || !chat) return;
      const url = `${appUrl}${appUrl.includes("?") ? "&" : "?"}room=${encodeURIComponent(code)}`;
      try { await send(chat, text, url, "▶️ К партии"); } catch (e) { log.warn("уведомление:", e.message); }
    },
  };
}
