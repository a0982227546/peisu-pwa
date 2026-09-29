import webpush from "web-push";
const ORIGIN="https://a0982227546.github.io";
const CORS={"Access-Control-Allow-Origin":ORIGIN,"Access-Control-Allow-Headers":"Content-Type","Access-Control-Allow-Methods":"GET,POST,OPTIONS"};
const json=(x,s=200)=>new Response(JSON.stringify(x),{status:s,headers:{"Content-Type":"application/json; charset=utf-8",...CORS}});
const valid=s=>!!(s&&s.endpoint&&s.keys&&s.keys.p256dh&&s.keys.auth);

async function sendPush(env,sub,body){
  webpush.setVapidDetails(env.VAPID_SUBJECT,env.VAPID_PUBLIC_KEY,env.VAPID_PRIVATE_KEY);
  return webpush.sendNotification(sub,JSON.stringify({
    title:"裴溯",body,
    icon:"https://a0982227546.github.io/peisu-pwa/icon-192.png",
    badge:"https://a0982227546.github.io/peisu-pwa/icon-192.png",
    url:"https://a0982227546.github.io/peisu-pwa/"
  }),{TTL:60});
}
async function runDue(env){
  const raw=await env.KV.get("scheduled_push_primary");
  if(!raw)return;
  let job;
  try{job=JSON.parse(raw)}catch{await env.KV.delete("scheduled_push_primary");return}
  if(!job.dueAt||Date.now()<job.dueAt)return;
  await env.KV.delete("scheduled_push_primary");
  const saved=await env.KV.get("push_subscription_primary");
  if(!saved)throw new Error("No saved push subscription");
  const sub=JSON.parse(saved);
  if(!valid(sub))throw new Error("Saved subscription invalid");
  await sendPush(env,sub,job.body||"v04｜5 分鐘延遲測試。");
}
export default{
  async fetch(request,env){
    if(request.method==="OPTIONS")return new Response(null,{headers:CORS});
    const url=new URL(request.url);
    if(url.pathname==="/")return json({ok:true,service:"peisu-push-v01",mode:"web-push-v04"});
    if(url.pathname==="/public-key"&&request.method==="GET")return env.VAPID_PUBLIC_KEY?json({publicKey:env.VAPID_PUBLIC_KEY}):json({ok:false,error:"Missing public key"},500);

    if(url.pathname==="/send-test"&&request.method==="POST"){
      const b=await request.json().catch(()=>null);
      if(!b||!valid(b.subscription))return json({ok:false,error:"Invalid subscription"},400);
      try{await sendPush(env,b.subscription,"真 Push 測試。");return json({ok:true})}
      catch(e){return json({ok:false,error:String(e?.message||e)},500)}
    }
    if(url.pathname==="/save-subscription"&&request.method==="POST"){
      const b=await request.json().catch(()=>null);
      if(!b||!valid(b.subscription))return json({ok:false,error:"Invalid subscription"},400);
      await env.KV.put("push_subscription_primary",JSON.stringify(b.subscription));
      return json({ok:true,saved:true});
    }
    if(url.pathname==="/send-saved-test"&&request.method==="POST"){
      const saved=await env.KV.get("push_subscription_primary");
      if(!saved)return json({ok:false,error:"No saved subscription"},404);
      try{await sendPush(env,JSON.parse(saved),"v03｜頁面關閉測試。");return json({ok:true})}
      catch(e){return json({ok:false,error:String(e?.message||e)},500)}
    }
    if(url.pathname==="/schedule-v04-test"&&request.method==="POST"){
      if(!await env.KV.get("push_subscription_primary"))return json({ok:false,error:"No saved subscription"},404);
      const dueAt=Date.now()+5*60*1000;
      await env.KV.put("scheduled_push_primary",JSON.stringify({dueAt,body:"v04｜5 分鐘延遲測試。",createdAt:Date.now()}));
      return json({ok:true,dueAt,dueAtIso:new Date(dueAt).toISOString()});
    }
    return json({ok:false,error:"Not found"},404);
  },
  async scheduled(controller,env,ctx){await runDue(env);}
};
