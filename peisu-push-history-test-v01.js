import webpush from "web-push";

const ORIGIN = "https://a0982227546.github.io";
const SUB_KEY = "push_subscription_primary";
const INBOX_KEY = "push_history_test_inbox_v01";
const MAX_MESSAGES = 20;

const CORS = {
  "Access-Control-Allow-Origin": ORIGIN,
  "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  "Cache-Control": "no-store"
};

function json(data, status=200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {"Content-Type":"application/json; charset=utf-8", ...CORS}
  });
}

async function getSubscription(env) {
  const raw = await env.KV.get(SUB_KEY);
  if (!raw) return null;
  try {
    const s = JSON.parse(raw);
    if (s?.endpoint && s?.keys?.p256dh && s?.keys?.auth) return s;
  } catch {}
  return null;
}

async function getInbox(env) {
  const raw = await env.KV.get(INBOX_KEY);
  if (!raw) return [];
  try {
    const a = JSON.parse(raw);
    return Array.isArray(a) ? a : [];
  } catch {
    return [];
  }
}

async function putInbox(env, messages) {
  await env.KV.put(INBOX_KEY, JSON.stringify(messages.slice(-MAX_MESSAGES)));
}

async function sendPush(env, sub, body) {
  webpush.setVapidDetails(
    env.VAPID_SUBJECT,
    env.VAPID_PUBLIC_KEY,
    env.VAPID_PRIVATE_KEY
  );
  return webpush.sendNotification(sub, JSON.stringify({
    title: "裴溯",
    body,
    icon: `${ORIGIN}/peisu-pwa/icon-192.png`,
    badge: `${ORIGIN}/peisu-pwa/icon-192.png`,
    url: `${ORIGIN}/peisu-pwa/peisu_push_history_test_v01.html`
  }), {TTL:300});
}

export default {
  async fetch(request, env) {
    if (request.method === "OPTIONS") return new Response(null, {status:204, headers:CORS});
    const url = new URL(request.url);

    if (url.pathname === "/") {
      return json({ok:true, mode:"push-history-test-v01", productionBStateTouched:false});
    }

    if (url.pathname === "/pending-messages" && request.method === "GET") {
      return json({ok:true, messages:await getInbox(env)});
    }

    if (url.pathname === "/clear-test-inbox" && request.method === "POST") {
      await env.KV.delete(INBOX_KEY);
      return json({ok:true, cleared:true});
    }

    if (url.pathname === "/send-history-test" && request.method === "POST") {
      const sub = await getSubscription(env);
      if (!sub) return json({ok:false,error:"找不到 push_subscription_primary"},404);

      let body = "師兄？";
      try {
        const req = await request.json();
        if (typeof req?.body === "string" && req.body.trim()) body = req.body.trim();
      } catch {}

      const sentAt = new Date().toISOString();
      const id = `push-history-test-${Date.now()}-${crypto.randomUUID()}`;

      // Important: only create the chat-history event after Web Push reports success.
      await sendPush(env, sub, body);

      const inbox = await getInbox(env);
      inbox.push({id, body, sentAt});
      await putInbox(env, inbox);

      return json({ok:true, sent:true, message:{id,body,sentAt}});
    }

    return json({ok:false,error:"Not found"},404);
  }
};
