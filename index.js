import webpush from "web-push";
const ALLOW_ORIGIN="https://a0982227546.github.io";
const cors={"Access-Control-Allow-Origin":ALLOW_ORIGIN,"Access-Control-Allow-Methods":"GET,POST,OPTIONS","Access-Control-Allow-Headers":"Content-Type"};
const json=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:{"content-type":"application/json; charset=utf-8",...cors}});
const valid=s=>!!(s?.endpoint&&s?.keys?.p256dh&&s?.keys?.auth);
async function send(env,sub,body){
 if(!env.VAPID_PUBLIC_KEY||!env.VAPID_PRIVATE_KEY||!env.VAPID_SUBJECT) throw new Error("VAPID configuration missing");
 webpush.setVapidDetails(env.VAPID_SUBJECT,env.VAPID_PUBLIC_KEY,env.VAPID_PRIVATE_KEY);
 return webpush.sendNotification(sub,JSON.stringify({title:"裴溯",body,icon:"https://a0982227546.github.io/peisu-pwa/icon-192.png",badge:"https://a0982227546.github.io/peisu-pwa/icon-192.png",url:"https://a0982227546.github.io/peisu-pwa/"}),{TTL:60});
}
export default{async fetch(request,env){
 if(request.method==="OPTIONS") return new Response(null,{headers:cors});
 const url=new URL(request.url);
 if(url.pathname==="/") return json({ok:true,service:"peisu-push-v01",mode:"web-push-v03"});
 if(url.pathname==="/public-key"&&request.method==="GET"){
  if(!env.VAPID_PUBLIC_KEY)return json({ok:false,error:"VAPID_PUBLIC_KEY missing"},500);
  return json({ok:true,publicKey:env.VAPID_PUBLIC_KEY});
 }
 if(url.pathname==="/send-test"&&request.method==="POST"){
  let b;try{b=await request.json()}catch{return json({ok:false,error:"invalid JSON"},400)}
  if(!valid(b?.subscription))return json({ok:false,error:"invalid subscription"},400);
  try{await send(env,b.subscription,"真 Push 測試。");return json({ok:true,sent:true})}
  catch(e){return json({ok:false,error:e?.message||String(e),statusCode:e?.statusCode||null},502)}
 }
 if(url.pathname==="/save-subscription"&&request.method==="POST"){
  if(!env.KV)return json({ok:false,error:"KV binding missing"},500);
  let b;try{b=await request.json()}catch{return json({ok:false,error:"invalid JSON"},400)}
  if(!valid(b?.subscription))return json({ok:false,error:"invalid subscription"},400);
  await env.KV.put("push_subscription_primary",JSON.stringify(b.subscription));
  return json({ok:true,saved:true});
 }
 if(url.pathname==="/send-saved-test"&&request.method==="POST"){
  if(!env.KV)return json({ok:false,error:"KV binding missing"},500);
  const raw=await env.KV.get("push_subscription_primary");
  if(!raw)return json({ok:false,error:"saved subscription missing"},404);
  let sub;try{sub=JSON.parse(raw)}catch{return json({ok:false,error:"saved subscription invalid"},500)}
  try{await send(env,sub,"v03｜頁面關閉測試。");return json({ok:true,sent:true,source:"kv"})}
  catch(e){return json({ok:false,error:e?.message||String(e),statusCode:e?.statusCode||null},502)}
 }
 return json({ok:false,error:"not found"},404);
}};