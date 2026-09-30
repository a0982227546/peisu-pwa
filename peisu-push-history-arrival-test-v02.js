import webpush from "web-push";

const ORIGIN = "https://a0982227546.github.io";
const CORS = {
  "Access-Control-Allow-Origin": ORIGIN,
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Allow-Methods": "GET,POST,OPTIONS"
};
const json = (x, s=200) => new Response(JSON.stringify(x), {status:s, headers:{"Content-Type":"application/json; charset=utf-8", ...CORS}});
const valid = s => !!(s && s.endpoint && s.keys && s.keys.p256dh && s.keys.auth);

const SUB_KEY = "push_history_arrival_test_subscription_v01";
const INBOX_KEY = "push_history_arrival_test_inbox_v01";

async function loadInbox(env){
  try { const a = JSON.parse(await env.KV.get(INBOX_KEY) || "[]"); return Array.isArray(a) ? a : []; }
  catch { return []; }
}
async function saveInbox(env, a){
  await env.KV.put(INBOX_KEY, JSON.stringify(a.slice(-20)));
}
async function sendPush(env, sub, message){
  webpush.setVapidDetails(env.VAPID_SUBJECT, env.VAPID_PUBLIC_KEY, env.VAPID_PRIVATE_KEY);
  return webpush.sendNotification(sub, JSON.stringify({
    id: message.id,
    title: "裴溯",
    body: message.body,
    sentAt: message.sentAt,
    icon: "https://a0982227546.github.io/peisu-pwa/icon-192.png",
    badge: "https://a0982227546.github.io/peisu-pwa/icon-192.png",
    url: "https://a0982227546.github.io/peisu-pwa/push-arrival-test-v02/"
  }), {TTL:60});
}

export default {
  async fetch(request, env){
    if(request.method === "OPTIONS") return new Response(null, {headers:CORS});
    const url = new URL(request.url);

    if(url.pathname === "/") return json({ok:true, service:"peisu-push-history-arrival-test-v02"});
    if(url.pathname === "/public-key" && request.method === "GET") return env.VAPID_PUBLIC_KEY ? json({publicKey:env.VAPID_PUBLIC_KEY}) : json({ok:false,error:"Missing public key"},500);

    if(url.pathname === "/save-test-subscription" && request.method === "POST"){
      const b = await request.json().catch(()=>null);
      if(!b || !valid(b.subscription)) return json({ok:false,error:"Invalid subscription"},400);
      await env.KV.put(SUB_KEY, JSON.stringify(b.subscription));
      return json({ok:true,saved:true});
    }

    if(url.pathname === "/send-arrival-test" && request.method === "POST"){
      const saved = await env.KV.get(SUB_KEY);
      if(!saved) return json({ok:false,error:"No test subscription. Open the v02 test page first."},404);
      const b = await request.json().catch(()=>({}));
      const body = (b && typeof b.body === "string" && b.body.trim()) ? b.body.trim() : "師兄？";
      const id = `push-arrival-test-${Date.now()}-${crypto.randomUUID()}`;
      const sentAt = new Date().toISOString();
      const msg = {id, body, sentAt, arrivedAt:null};

      // IMPORTANT:
      // Persist the pending message BEFORE sending the Push.
      // The device can receive the Push immediately; its Service Worker may call
      // /mark-arrived before sendPush() returns. Saving first prevents that race.
      const inbox = await loadInbox(env);
      inbox.push(msg);
      await saveInbox(env, inbox);

      try {
        await sendPush(env, JSON.parse(saved), msg);
        return json({ok:true,id,body,sentAt});
      } catch(e){
        // Push did not send: remove only this unsent test message.
        const rollback = (await loadInbox(env)).filter(x => x && x.id !== id);
        await saveInbox(env, rollback);
        return json({ok:false,error:String(e?.message||e)},500);
      }
    }

    if(url.pathname === "/mark-arrived" && request.method === "POST"){
      const b = await request.json().catch(()=>null);
      const id = String(b?.id || "");
      if(!id) return json({ok:false,error:"Missing id"},400);
      const inbox = await loadInbox(env);
      const m = inbox.find(x => x && x.id === id);
      if(!m) return json({ok:false,error:"Message not found"},404);
      if(!m.arrivedAt) m.arrivedAt = new Date().toISOString();
      await saveInbox(env, inbox);
      return json({ok:true,id,arrivedAt:m.arrivedAt});
    }

    if(url.pathname === "/arrived-messages" && request.method === "GET"){
      const inbox = await loadInbox(env);
      return json({ok:true,messages:inbox.filter(x => x && x.arrivedAt).map(({id,body,sentAt,arrivedAt})=>({id,body,sentAt,arrivedAt}))});
    }

    if(url.pathname === "/arrival-status" && request.method === "GET"){
      return json({ok:true,messages:await loadInbox(env)});
    }

    if(url.pathname === "/clear-arrival-test" && request.method === "POST"){
      await env.KV.delete(INBOX_KEY);
      return json({ok:true,cleared:true});
    }

    return json({ok:false,error:"Not found"},404);
  }
};
