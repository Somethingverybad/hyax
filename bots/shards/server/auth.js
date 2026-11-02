// Кто открыл мини-приложение: проверка данных запуска WYX тем же способом,
// что в backend/chat/webapp.py (check_init_data).

import { createHmac, timingSafeEqual } from "node:crypto";

const MAX_AGE = 24 * 3600;

/** → {id, username, photo_url, chat_id} или null. */
export function checkInitData(initData, botToken, now = Date.now() / 1000) {
  if (!initData || !botToken || initData.length > 4096) return null;
  const fields = new URLSearchParams(initData);
  const got = fields.get("hash") || "";
  fields.delete("hash");
  const check = [...fields.keys()].sort().map((k) => `${k}=${fields.get(k)}`).join("\n");
  const secret = createHmac("sha256", "WebAppData").update(botToken).digest();
  const want = createHmac("sha256", secret).update(check).digest("hex");
  if (got.length !== want.length || !timingSafeEqual(Buffer.from(got), Buffer.from(want))) return null;
  if (now - Number(fields.get("auth_date") || 0) > MAX_AGE) return null;
  let user;
  try { user = JSON.parse(fields.get("user") || "{}"); } catch { return null; }
  if (!user?.id) return null;
  return { id: String(user.id), username: String(user.username || "игрок").slice(0, 32), photo_url: user.photo_url || "", chat_id: fields.get("chat_id") || "" };
}

/** Подписать данные запуска — для тестов и локальной проверки. */
export function signInitData(user, botToken, extra = {}) {
  const fields = { auth_date: String(Math.floor(Date.now() / 1000)), query_id: "test", user: JSON.stringify(user), ...extra };
  const check = Object.keys(fields).sort().map((k) => `${k}=${fields[k]}`).join("\n");
  const secret = createHmac("sha256", "WebAppData").update(botToken).digest();
  fields.hash = createHmac("sha256", secret).update(check).digest("hex");
  return new URLSearchParams(fields).toString();
}
