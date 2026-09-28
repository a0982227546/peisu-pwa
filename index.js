import webpush from "web-push";

const ALLOW_ORIGIN = "https://a0982227546.github.io";
const cors = {
  "Access-Control-Allow-Origin": ALLOW_ORIGIN,
  "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};
const json = (data, status = 200) => new Response(JSON.stringify(data), {
  status,
  headers: { "content-type": "application/json; charset=utf-8", ...cors },
});

export default {
  async fetch(request, env) {
    if (request.method === "OPTIONS") return new Response(null, { headers: cors });
    const url = new URL(request.url);

    if (url.pathname === "/") {
      return json({ ok: true, service: "peisu-push-v01", mode: "web-push-test" });
    }

    if (url.pathname === "/public-key" && request.method === "GET") {
      if (!env.VAPID_PUBLIC_KEY) return json({ ok: false, error: "VAPID_PUBLIC_KEY missing" }, 500);
      return json({ ok: true, publicKey: env.VAPID_PUBLIC_KEY });
    }

    if (url.pathname === "/send-test" && request.method === "POST") {
      if (!env.VAPID_PUBLIC_KEY || !env.VAPID_PRIVATE_KEY || !env.VAPID_SUBJECT) {
        return json({ ok: false, error: "VAPID secrets missing" }, 500);
      }
      let body;
      try { body = await request.json(); } catch { return json({ ok: false, error: "invalid JSON" }, 400); }
      const subscription = body?.subscription;
      if (!subscription?.endpoint || !subscription?.keys?.p256dh || !subscription?.keys?.auth) {
        return json({ ok: false, error: "invalid subscription" }, 400);
      }

      webpush.setVapidDetails(env.VAPID_SUBJECT, env.VAPID_PUBLIC_KEY, env.VAPID_PRIVATE_KEY);
      const payload = JSON.stringify({
        title: "裴溯",
        body: "真 Push 測試。",
        icon: "https://a0982227546.github.io/peisu-pwa/icon-192.png",
        badge: "https://a0982227546.github.io/peisu-pwa/icon-192.png",
        url: "https://a0982227546.github.io/peisu-pwa/"
      });
      try {
        await webpush.sendNotification(subscription, payload, { TTL: 60 });
        return json({ ok: true, sent: true });
      } catch (e) {
        return json({ ok: false, error: e?.message || String(e), statusCode: e?.statusCode || null }, 502);
      }
    }

    return json({ ok: false, error: "not found" }, 404);
  }
};
