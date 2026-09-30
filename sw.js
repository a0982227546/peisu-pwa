const CACHE_NAME = "peisu-pwa-official-v1";
const APP_SHELL = [
  "./index.html",
  "./manifest.webmanifest",
  "./icon-192.png",
  "./icon-512.png"
];

self.addEventListener("install", event => {
  event.waitUntil(caches.open(CACHE_NAME).then(cache => cache.addAll(APP_SHELL)));
  self.skipWaiting();
});

self.addEventListener("activate", event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k.startsWith("peisu-pwa-") && k !== CACHE_NAME)
        .map(k => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", event => {
  if (event.request.method !== "GET") return;
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin) return;

  if (event.request.mode === "navigate") {
    event.respondWith(fetch(event.request).catch(() => caches.match("./index.html")));
    return;
  }

  event.respondWith(
    caches.match(event.request).then(cached =>
      cached || fetch(event.request).then(response => {
        if (response && response.ok) {
          const copy = response.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(event.request, copy));
        }
        return response;
      })
    )
  );
});

// Proactive Push → chat-history arrival gate.
// Existing cache/offline handlers above are unchanged.
const PROACTIVE_PUSH_API = "https://peisu-push-b-v01.a0982227546.workers.dev";

self.addEventListener("push", event => {
  event.waitUntil((async () => {
    let data = {};
    try {
      data = event.data ? event.data.json() : {};
    } catch {
      data = { body: event.data ? event.data.text() : "" };
    }

    const id = String(data.id || "");
    const title = data.title || "裴溯";
    const body = data.body || "";

    // Unlock chat visibility only after this device actually receives the Push.
    if (id) {
      try {
        await fetch(PROACTIVE_PUSH_API + "/mark-arrived", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id })
        });
      } catch (e) {
        // Notification still appears even if the acknowledgement temporarily fails.
      }
    }

    await self.registration.showNotification(title, {
      body,
      icon: data.icon || "./icon-192.png",
      badge: data.badge || "./icon-192.png",
      tag: id || "peisu-proactive-push",
      data: { url: data.url || "./", id }
    });
  })());
});

self.addEventListener("notificationclick", event => {
  event.notification.close();
  const target = event.notification.data?.url || "./";
  event.waitUntil((async () => {
    const list = await clients.matchAll({ type: "window", includeUncontrolled: true });
    for (const client of list) {
      if ("focus" in client && client.url.startsWith(self.location.origin)) {
        await client.focus();
        if ("navigate" in client) await client.navigate(target);
        return;
      }
    }
    if (clients.openWindow) await clients.openWindow(target);
  })());
});
