const ARRIVAL_API = "https://peisu-push-history-arrival-test-v02.a0982227546.workers.dev";

self.addEventListener("push", event => {
  event.waitUntil((async()=>{
    let data = {};
    try { data = event.data ? event.data.json() : {}; } catch { data = {body:event.data ? event.data.text() : ""}; }
    const id = String(data.id || "");
    const title = data.title || "裴溯";
    const body = data.body || "";

    if(id){
      try {
        await fetch(ARRIVAL_API + "/mark-arrived", {
          method:"POST",
          headers:{"Content-Type":"application/json"},
          body:JSON.stringify({id})
        });
      } catch(e) {
        // Do not suppress the notification if arrival acknowledgement temporarily fails.
      }
    }

    await self.registration.showNotification(title, {
      body,
      icon:data.icon || "../icon-192.png",
      badge:data.badge || "../icon-192.png",
      tag:id || "peisu-arrival-test-v02",
      data:{url:data.url || "./", id}
    });
  })());
});

self.addEventListener("notificationclick", event => {
  event.notification.close();
  const target = event.notification.data?.url || "./";
  event.waitUntil((async()=>{
    const list = await clients.matchAll({type:"window", includeUncontrolled:true});
    for(const c of list){
      if("focus" in c && c.url.startsWith(self.location.origin)){
        await c.focus();
        if("navigate" in c) await c.navigate(target);
        return;
      }
    }
    if(clients.openWindow) await clients.openWindow(target);
  })());
});
