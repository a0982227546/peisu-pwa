import webpush from "web-push";

const ORIGIN="https://a0982227546.github.io";
const CORS={
  "Access-Control-Allow-Origin":ORIGIN,
  "Access-Control-Allow-Headers":"Content-Type",
  "Access-Control-Allow-Methods":"GET,POST,OPTIONS"
};
const json=(x,s=200)=>new Response(JSON.stringify(x),{
  status:s,headers:{"Content-Type":"application/json; charset=utf-8",...CORS}
});
const valid=s=>!!(s&&s.endpoint&&s.keys&&s.keys.p256dh&&s.keys.auth);

const TZ_OFFSET_MS=8*60*60*1000;
const STATE_KEY="push_b_v01_state";
const SUB_KEY="push_subscription_primary";
const COOLDOWN_DAYS=3;
const DAILY_CHANCE=0.30;

const GREETINGS=[
  {body:"在？",weight:30,start:0,end:1439},
  {body:"師兄？",weight:30,start:0,end:1439},
  {body:"早",weight:15,start:300,end:390},
  {body:"睡了？",weight:12.5,start:0,end:60},
  {body:"還沒睡？",weight:12.5,start:90,end:150}
];

function localParts(ms=Date.now()){
  const d=new Date(ms+TZ_OFFSET_MS);
  return {
    y:d.getUTCFullYear(),m:d.getUTCMonth()+1,day:d.getUTCDate(),
    hour:d.getUTCHours(),minute:d.getUTCMinutes()
  };
}
function dateKey(ms=Date.now()){
  const p=localParts(ms);
  return `${p.y}-${String(p.m).padStart(2,"0")}-${String(p.day).padStart(2,"0")}`;
}
function localMidnightUtcMs(ms=Date.now()){
  const p=localParts(ms);
  return Date.UTC(p.y,p.m-1,p.day)-TZ_OFFSET_MS;
}
function dayDiff(aKey,bKey){
  const [ay,am,ad]=aKey.split("-").map(Number);
  const [by,bm,bd]=bKey.split("-").map(Number);
  return Math.round((Date.UTC(by,bm-1,bd)-Date.UTC(ay,am-1,ad))/86400000);
}
function pickGreeting(){
  let x=Math.random()*100,sum=0;
  for(const g of GREETINGS){sum+=g.weight;if(x<sum)return g}
  return GREETINGS[GREETINGS.length-1];
}
function pickDueAt(g,now=Date.now()){
  const midnight=localMidnightUtcMs(now);
  const minute=g.start+Math.floor(Math.random()*(g.end-g.start+1));
  return midnight+minute*60000;
}
async function sendPush(env,sub,body){
  webpush.setVapidDetails(env.VAPID_SUBJECT,env.VAPID_PUBLIC_KEY,env.VAPID_PRIVATE_KEY);
  return webpush.sendNotification(sub,JSON.stringify({
    title:"裴溯",body,
    icon:"https://a0982227546.github.io/peisu-pwa/icon-192.png",
    badge:"https://a0982227546.github.io/peisu-pwa/icon-192.png",
    url:"https://a0982227546.github.io/peisu-pwa/"
  }),{TTL:60});
}
async function getState(env){
  const raw=await env.KV.get(STATE_KEY);
  if(!raw)return {lastDecisionDate:null,lastPushDate:null,pending:null};
  try{return JSON.parse(raw)}catch{return {lastDecisionDate:null,lastPushDate:null,pending:null}}
}
async function putState(env,state){await env.KV.put(STATE_KEY,JSON.stringify(state))}

async function runB(env){
  const saved=await env.KV.get(SUB_KEY);
  if(!saved)return;

  const now=Date.now(),today=dateKey(now);
  const state=await getState(env);

  // 先處理今天已排好的問候。
  if(state.pending){
    if(now>=state.pending.dueAt){
      const sub=JSON.parse(saved);
      if(!valid(sub))throw new Error("Saved subscription invalid");
      await sendPush(env,sub,state.pending.body);
      state.lastPushDate=today;
      state.pending=null;
      await putState(env,state);
    }
    return;
  }

  // 每個本地日只做一次「今天要不要出現」判定。
  if(state.lastDecisionDate===today)return;
  state.lastDecisionDate=today;

  // 主動後 3 個完整日子絕對安靜。
  if(state.lastPushDate && dayDiff(state.lastPushDate,today)<=COOLDOWN_DAYS){
    await putState(env,state); return;
  }

  // 安靜期後，每天 30% 機率取得一次主動資格。
  if(Math.random()>=DAILY_CHANCE){
    await putState(env,state); return;
  }

  const g=pickGreeting();
  const dueAt=pickDueAt(g,now);

  // 若今天抽中的合法時間已經過了，就不硬補發；明天重新抽。
  if(dueAt<=now){
    await putState(env,state); return;
  }

  state.pending={body:g.body,dueAt,createdAt:now};
  await putState(env,state);
}

export default{
  async fetch(request,env){
    if(request.method==="OPTIONS")return new Response(null,{headers:CORS});
    const url=new URL(request.url);

    if(url.pathname==="/")return json({
      ok:true,service:"peisu-push-b-v01",mode:"random-greeting",
      apiCost:"0",cooldownDays:COOLDOWN_DAYS,dailyChance:DAILY_CHANCE,
      greetings:GREETINGS.map(x=>({body:x.body,weight:x.weight,start:x.start,end:x.end}))
    });

    if(url.pathname==="/public-key"&&request.method==="GET")
      return env.VAPID_PUBLIC_KEY?json({publicKey:env.VAPID_PUBLIC_KEY}):json({ok:false,error:"Missing public key"},500);

    if(url.pathname==="/save-subscription"&&request.method==="POST"){
      const b=await request.json().catch(()=>null);
      if(!b||!valid(b.subscription))return json({ok:false,error:"Invalid subscription"},400);
      await env.KV.put(SUB_KEY,JSON.stringify(b.subscription));
      return json({ok:true,saved:true});
    }

    // 僅供部署後確認 B 狀態，不會呼叫 OpenAI。
    if(url.pathname==="/b-status"&&request.method==="GET"){
      return json({ok:true,state:await getState(env),today:dateKey()});
    }

    return json({ok:false,error:"Not found"},404);
  },

  async scheduled(controller,env,ctx){
    ctx.waitUntil(runB(env));
  }
};