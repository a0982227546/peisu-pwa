import webpush from "web-push";

const SUB_KEY="push_subscription_primary";
const TEST_KEY="push_b_v01_one_shot_test_done";

const valid=s=>!!(s&&s.endpoint&&s.keys&&s.keys.p256dh&&s.keys.auth);

async function sendPush(env,sub){
  webpush.setVapidDetails(
    env.VAPID_SUBJECT,
    env.VAPID_PUBLIC_KEY,
    env.VAPID_PRIVATE_KEY
  );
  return webpush.sendNotification(sub,JSON.stringify({
    title:"裴溯",
    body:"師兄？",
    icon:"https://a0982227546.github.io/peisu-pwa/icon-192.png",
    badge:"https://a0982227546.github.io/peisu-pwa/icon-192.png",
    url:"https://a0982227546.github.io/peisu-pwa/"
  }),{TTL:60});
}

async function runOnce(env){
  // 已成功測過就永遠不再重複送。
  if(await env.KV.get(TEST_KEY)) return;

  const saved=await env.KV.get(SUB_KEY);
  if(!saved) return;

  const sub=JSON.parse(saved);
  if(!valid(sub)) throw new Error("Saved subscription invalid");

  // 先送成功，再寫完成標記；失敗時下個 Cron 才能重試。
  await sendPush(env,sub);
  await env.KV.put(TEST_KEY,JSON.stringify({
    done:true,
    sentAt:Date.now(),
    body:"師兄？"
  }));
}

export default{
  async fetch(){
    return new Response("B-v01 one-shot Push test");
  },
  async scheduled(controller,env,ctx){
    ctx.waitUntil(runOnce(env));
  }
};