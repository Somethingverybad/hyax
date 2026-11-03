// Пропускная: эмулятор лежит за пропуском, который сервер выдаёт по данным
// запуска WYX тем, кто в списке допуска. Без пропуска грузится только эта страница.
(async function () {
  var WA = window.WYX && window.WYX.WebApp;
  var text = document.getElementById("gateText");
  var r, body = {};
  try {
    r = await fetch("api/session", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ initData: (WA && WA.initData) || "" }),
    });
    body = await r.json().catch(function () { return {}; });
  } catch (e) {
    text.textContent = "Нет связи с сервером. Закройте и откройте приложение ещё раз.";
    return;
  }
  if (r.ok && body.pass) {
    try {
      await import("./s/" + body.pass + "/app.js");
    } catch (e) {
      text.textContent = "Не удалось загрузить эмулятор. Закройте и откройте приложение ещё раз.";
      return;
    }
    document.getElementById("gate").classList.add("hidden");
    document.getElementById("setup").classList.remove("hidden");
    return;
  }
  if (WA && WA.ready) WA.ready();
  text.textContent = r.status === 403
    ? "Ретро-ПК — закрытый. Ваш аккаунт @" + (body.username || "?") + " не в списке. Попросите владельца бота добавить вас."
    : "Ретро-ПК открывается только из мессенджера WYX: найдите бота @heroesIII и нажмите «Открыть».";
})();
