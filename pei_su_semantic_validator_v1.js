// Pei Su 語意驗證器 v1 — 獨立測試（CORS 修正版）
// 輸入：nano r4 語意 JSON。輸出：PASS / FIX / RETRY。
// 不呼叫 AI；不重解讀使用者；不決定裴溯回覆。

const clone = x => JSON.parse(JSON.stringify(x));
const arr = x => Array.isArray(x) ? x : [];
const norm = s => (s ?? "").replace(/\s+/g," ").trim();

const replyStrategy = [
  /應(該|採取|使用|給予|提供|提醒)/,
  /中性.*(聆聽|回應)/,
  /提供.*(空間|支持)/,
  /回應.*(語氣|風格)/,
  /如何回(應|覆)/
];
const tech = [
  /monitor/i, /detect/i,
  /在線狀態.*(偵測|檢測|監控|追蹤)/,
  /技術.*(能力|可行性)/,
  /是否具備.*能力/
];

function nearDup(a,b){
  a=norm(a); b=norm(b);
  if(!a||!b) return false;
  if(a===b) return true;
  return (a.includes(b)||b.includes(a)) && Math.abs(a.length-b.length)<=6;
}
function matchesAny(s, regs){ return regs.some(r=>r.test(String(s))); }

function validate(input){
  const x=clone(input);
  const reasons=[], fixes=[];
  const mu=x.message_understanding||{};
  const su=x.state_updates||{};
  const cc=x.conversation_context||{};

  // FIX：無資訊的 neutral
  if(arr(mu.user_state_or_attitude).some(v=>String(v).toLowerCase()==="neutral")){
    mu.user_state_or_attitude=arr(mu.user_state_or_attitude).filter(v=>String(v).toLowerCase()!=="neutral");
    fixes.push("移除無資訊的 user_state_or_attitude: neutral");
  }

  // FIX：明確重複 explicit 的 implied
  const explicit=arr(mu.explicit_content);
  const oldImp=arr(mu.implied_content);
  const newImp=oldImp.filter(v=>!explicit.some(e=>nearDup(v,e)));
  if(newImp.length!==oldImp.length){
    mu.implied_content=newImp;
    fixes.push("移除與 explicit_content 明確重複的 implied_content");
  }

  // FIX：孤立的回覆策略／技術能力文字，只能從 implied/uncertainties 刪除
  for(const key of ["implied_content","uncertainties"]){
    const old=arr(mu[key]);
    const kept=old.filter(v=>!matchesAny(v,replyStrategy)&&!matchesAny(v,tech));
    if(kept.length!==old.length){
      mu[key]=kept;
      fixes.push(`移除 ${key} 中不屬於語意層的回覆策略或技術能力文字`);
    }
  }

  // RETRY：監控/技術能力已污染 obligations
  const obligations=[...arr(cc.obligations),...arr(su.obligation_updates)];
  if(obligations.some(v=>matchesAny(v,tech)||/monitor_online|detect_online|status_detection/i.test(String(v)))){
    reasons.push("技術能力或在線監控被寫入 obligations/state_updates，需要 nano 重新判讀");
  }

  // RETRY：uncertainties 表示「是否期待回應」不確定，但核心欄位卻 no + high
  const responseUncertain=arr(mu.uncertainties).some(v=>/是否.*(期待|需要).*回(應|覆)|是否需要回(應|覆)/.test(String(v)));
  if(responseUncertain && mu.response_or_action_expected==="no" && mu.confidence==="high"){
    reasons.push("response_or_action_expected=no + confidence=high 與「是否期待回應仍不確定」互相矛盾");
  }

  // RETRY：acts 已呈現 request→cancel→replacement，但跨 turn / repair / update 沒保留
  const acts=arr(mu.acts).map(v=>String(v).toLowerCase());
  const hasReq=acts.some(v=>/request|提醒|reminder/.test(v));
  const hasCancel=acts.some(v=>/cancel|取消|不用提醒/.test(v));
  const hasReplacement=acts.some(v=>/replace|conditional|condition|scold|罵|取代|set_/.test(v));
  if(hasReq&&hasCancel&&hasReplacement){
    if(mu.continuation_of_previous!==true ||
       mu.repairs_or_reframes_previous!==true ||
       su.open_task!=="update"){
      reasons.push("已偵測 request→cancel→replacement，但 continuation / repair / open_task update 關係不一致");
    }
  }

  if(reasons.length){
    return {status:"RETRY",reasons,fixes_applied:fixes,semantic:x};
  }
  if(fixes.length){
    return {status:"FIX",fixes_applied:fixes,semantic:x};
  }
  return {status:"PASS",semantic:x};
}

const cors = {
  "Access-Control-Allow-Origin":"*",
  "Access-Control-Allow-Headers":"Content-Type",
  "Access-Control-Allow-Methods":"POST,OPTIONS"
};

export default {
  async fetch(request){
    if(request.method==="OPTIONS") return new Response(null,{status:204,headers:cors});
    if(request.method!=="POST")
      return Response.json({error:"POST only"},{status:405,headers:cors});
    try{
      const body=await request.json();
      return Response.json(validate(body),{headers:cors});
    }catch(e){
      return Response.json({error:String(e?.message||e)},{status:400,headers:cors});
    }
  }
};
