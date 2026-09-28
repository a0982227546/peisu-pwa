self.addEventListener("push", event => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch (_) {
    data = { body: event.data ? event.data.text() : "" };
  }
  const title = data.title || "裴溯";
  const options = {
    body: data.body || "真 Push 測試。",
    icon: data.icon || "../../icon-192.png",
    badge: data.badge || "../../icon-192.png",
    tag: "peisu-true-push-v02",
    renotify: true,
    data: { url: data.url || "../../" }
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener("notificationclick", event => {
  event.notification.close();
  const target = new URL(event.notification.data?.url || "../../", self.location.href).href;
  event.waitUntil(
    clients.matchAll({type:"window", includeUncontrolled:true}).then(list => {
      for (const c of list) {
        if ("focus" in c) {
          c.navigate(target);
          return c.focus();
        }
      }
      return clients.openWindow ? clients.openWindow(target) : undefined;
    })
  );
});