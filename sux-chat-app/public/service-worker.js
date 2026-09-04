// Старая PWA ставила service worker с кэшем всего приложения. Этот файл
// заменяет его: снимает регистрацию, чистит кэши и перезагружает вкладки,
// чтобы дальше грузилась актуальная сборка с сервера.
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.map((k) => caches.delete(k)));
    await self.registration.unregister();
    const clients = await self.clients.matchAll({ type: "window" });
    clients.forEach((c) => c.navigate(c.url));
  })());
});
