import { test } from "node:test";
import assert from "node:assert/strict";
import { checkInitData, signInitData } from "../server/auth.js";

test("данные запуска: подпись токеном бота", () => {
  const init = signInitData({ id: "u1", username: "anya" }, "123:abc", { chat_id: "c9" });
  assert.deepEqual(checkInitData(init, "123:abc"), { id: "u1", username: "anya", photo_url: "", chat_id: "c9" });
  assert.equal(checkInitData(init, "123:other"), null);
  assert.equal(checkInitData(init.replace("anya", "boss"), "123:abc"), null);
  assert.equal(checkInitData(init, "123:abc", Date.now() / 1000 + 2 * 86400), null, "просрочено");
});
