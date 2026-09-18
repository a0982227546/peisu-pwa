// Pei Su semantic validator v1 — isolated test
// Input: nano r4 semantic JSON. Output: PASS / FIX / RETRY.
// No AI call. It must not reinterpret the user's conversation.

const clone=x=>JSON.parse(JSON.stringify(x));
const arr=x=>Array.isArray(x)?x:[];
const norm=x=>String(x??"").replace(/\s+/g,"").toLowerCase();

const replyStrategy=[
 /應(該|採取|使用|給予|提供)/,/中性(聆聽|回應)/,/給.*空間/,
 /提供.*支持/,/回應.*(語氣|風格)/,/如何回(應|覆)/,/有用回(應|覆)/
];
const tech=[
 /monitor[_ -]?online/i,/status[_ -]?detection/i,
 /在線狀態.*(偵測|檢測|監控|追蹤)/,/(偵測|檢測|監控|追蹤).*在線狀態/,
 /技術.*(能力|可行性)/
];

function any(s,rs){return rs.some(r=>r.test(String(s)))}
function traditional(s){
 const m={"用户":"使用者","回应":"回應","获得":"獲得","对话":"對話","怀疑":"懷疑",
 "态度":"態度","语气":"語氣","风格":"風格","进一步":"進一步","信息":"資訊",
 "不确定":"不確定","应该":"應該","进行":"進行","在线":"在線","状态":"狀態",
 "检测":"檢測","监控":"監控","继续":"繼續"};
 let o=String(s??""); for(const [a,b] of Object.entries(m)) o=o.split(a).join(b); return o;
}
function normalize(v){
 if(Array.isArray(v)) return v.map(normalize);
 if(v&&typeof v==="object"){for(const k of Object.keys(v))v[k]=normalize(v[k]);return v}
 return typeof v==="string"?traditional(v):v;
}
function neutral(s){return ["neutral","中性","無特殊情緒","沒有特殊情緒"].includes(norm(s))}
function duplicate(s,explicit){
 const n=norm(s); if(!n)return false;
 return explicit.some(e=>{const x=norm(e);return x&&(n===x||(n.includes(x)&&n.length<=x.length+12))});
}

export function validateSemantic(input){
 const result=normalize(clone(input)), fixes=[], retry=[];
 const mu=result?.message_understanding??{}, su=result?.state_updates??{}, cc=result?.conversation_context??{};

 if(Array.isArray(mu.user_state_or_attitude)){
  const n=mu.user_state_or_attitude.length;
  mu.user_state_or_attitude=mu.user_state_or_attitude.filter(x=>!neutral(x));
  if(mu.user_state_or_attitude.length!==n) fixes.push("移除沒有實質資訊的 neutral 態度標籤");
 }

 if(Array.isArray(mu.implied_content)){
  const ex=arr(mu.explicit_content), keep=[];
  for(const x of mu.implied_content){
   if(duplicate(x,ex)) fixes.push(`移除重複 explicit_content 的 implied_content：${x}`);
   else keep.push(x);
  }
  mu.implied_content=keep;
 }

 for(const field of ["implied_content","uncertainties"]){
  if(Array.isArray(mu[field])){
   const keep=[];
   for(const x of mu[field]){
    if(any(x,replyStrategy)) fixes.push(`移除混入語意層的回覆策略：${x}`);
    else if(any(x,tech)) fixes.push(`移除技術能力／監控描述：${x}`);
    else keep.push(x);
   }
   mu[field]=keep;
  }
 }

 if([...arr(mu.acts),...arr(mu.user_state_or_attitude)].some(x=>any(x,replyStrategy)))
  retry.push("回覆策略已影響核心語意欄位，需重新判斷");
 if(arr(cc.obligations).some(x=>any(x,tech)))
  retry.push("未明示的技術監控／偵測已進入 obligations，需重新判斷");
 if(arr(su.obligation_updates).some(x=>any(x,tech)))
  retry.push("未明示的技術監控／偵測已進入 obligation_updates，需重新判斷");

 const responseUncertain=arr(mu.uncertainties).some(x=>
  /(是否.*(需要|期待).*(回應|回覆)|是否仍然期待回應|是否需要回覆)/.test(String(x)));
 if(responseUncertain&&mu.response_or_action_expected!=="maybe")
  retry.push("是否期待回應仍屬核心不確定性，但 response_or_action_expected 不是 maybe");
 if(responseUncertain&&mu.confidence==="high")
  retry.push("核心回應期待仍不確定，但 confidence 為 high");

 const acts=arr(mu.acts).map(norm);
 const request=acts.some(x=>/request|提醒|要求/.test(x));
 const cancel=acts.some(x=>/cancel|取消|撤回|refusal/.test(x));
 const replace=acts.some(x=>/replace|repair|set.*condition|conditional|替代|改成/.test(x));
 if(request&&cancel&&replace){
  if(mu.continuation_of_previous!==true) retry.push("已辨認提出→取消→替代，但 continuation_of_previous 不是 true");
  if(mu.repairs_or_reframes_previous!==true) retry.push("已辨認提出→取消→替代，但 repairs_or_reframes_previous 不是 true");
  if(su.open_task!=="update") retry.push("已辨認提出→取消→替代，但 state_updates.open_task 不是 update");
 }

 const reasons=[...new Set(retry)], fs=[...new Set(fixes)];
 if(reasons.length)return {status:"RETRY",result,fixes:fs,reasons};
 if(fs.length)return {status:"FIX",result,fixes:fs,reasons:[]};
 return {status:"PASS",result,fixes:[],reasons:[]};
}

export default {async fetch(request){
 if(request.method!=="POST")return Response.json({error:"POST only"},{status:405});
 try{return Response.json(validateSemantic(await request.json()))}
 catch(e){return Response.json({error:String(e?.message||e)},{status:400})}
}};
