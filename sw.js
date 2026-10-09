// factz.ro: primește notificările „Ultima oră”. Nu păstrează nimic în cache.
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", e => e.waitUntil(self.clients.claim()));
self.addEventListener("push", e => {
  let d = {}; try { d = e.data ? e.data.json() : {}; } catch (er) { d = { body: e.data ? e.data.text() : "" }; }
  e.waitUntil(self.registration.showNotification(d.title || "factz.ro", { body: d.body || "", icon: "/icon-192.png", badge: "/icon-192.png", tag: d.tag || "factz", data: { url: d.url || "/" } }));
});
self.addEventListener("notificationclick", e => {
  e.notification.close();
  const url = new URL((e.notification.data && e.notification.data.url) || "/", self.location.origin).href;
  e.waitUntil(self.clients.matchAll({ type: "window", includeUncontrolled: true }).then(ws => {
    for (const w of ws) if (w.url.startsWith(self.location.origin) && "focus" in w) return w.navigate(url).then(x => (x || w).focus());
    return self.clients.openWindow(url);
  }));
});
