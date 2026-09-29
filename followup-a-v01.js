const CORS={
  "Access-Control-Allow-Origin":"https://a0982227546.github.io",
  "Access-Control-Allow-Headers":"Content-Type",
  "Access-Control-Allow-Methods":"POST,OPTIONS"
};

function json(data,status=200){
  return new Response(JSON.stringify(data,null,2),{
    status,headers:{...CORS,"Content-Type":"application/json; charset=utf-8"}
  });
}

function minutesFor(text, semantic){
  const s=text.trim();
  // First-pass timing only. This is deliberately conservative and visible for testing.
  if(/明天|明早|明晚/.test(s)) return {min:720,max:1440,label:"跨日後再判斷"};
  if(/等等|等一下|待會|待会|晚點|晚点/.test(s)) return {min:45,max:120,label:"稍後"};
  if(/洗澡|洗頭|洗头|沖澡|冲澡/.test(s)) return {min:30,max:90,label:"短暫離開後"};
  if(/吃飯|吃饭|午餐|晚餐|早餐/.test(s)) return {min:45,max:120,label:"用餐後"};
  if(/工作|上班|加班|開會|开会/.test(s)) return {min:90,max:240,label:"隔一段時間"};
  return {min:90,max:180,label:"隔一段時間"};
}

function decide(text, semantic){
  const m=semantic?.semantic?.message_understanding || semantic?.message_understanding || {};
  const c=semantic?.semantic?.conversation_context || semantic?.conversation_context || {};
  const u=semantic?.semantic?.state_updates || semantic?.state_updates || {};
  const s=text.trim();

  // Explicitly completed / trivial utterances should not create stale follow-ups.
  const completed=/剛剛|刚刚|已經|已经|剛才|刚才/.test(s) &&
    /完|好了|結束|结束|回來|回来|吃完|洗完|做完/.test(s);
  const trivial=/^(好|好的|嗯|喔|哦|哈哈+|呵呵+|知道了|收到|行|可以|沒事|没事)[。.!！?？~～]*$/.test(s);

  const futureAction=/等等|等一下|待會|待会|晚點|晚点|明天|明早|明晚|要去|準備去|准备去|我去|再回來|再回来|再跟你說|再跟你说/.test(s);
  const temporaryLeave=/洗澡|洗頭|洗头|吃飯|吃饭|開會|开会|出門|出门|忙一下/.test(s);
  const emotionalOpenLoop=/煩死|烦死|好煩|好烦|累死|氣死|气死|緊張|紧张|擔心|担心|不想|麻煩|麻烦/.test(s);

  const semanticOpen = !!c?.open_task || u?.open_task==="update" || u?.open_task==="keep";
  const expected = m?.response_or_action_expected==="yes" || m?.response_or_action_expected==="maybe";

  let worthy = !completed && !trivial && (futureAction || temporaryLeave || emotionalOpenLoop || semanticOpen);
  let reason = worthy ? "存在尚未完成、稍後可能自然接續的事件／狀態" : "目前沒有足夠明確的後續鉤子";
  if(completed) reason="句子描述的事件已完成，不建立舊事件追蹤";
  if(trivial) reason="短回應本身不形成需要稍後追蹤的事件";

  const timing=worthy?minutesFor(s,semantic):null;
  let focus="";
  if(worthy){
    if(temporaryLeave) focus="使用者暫時離開／正在進行的事情是否已結束";
    else if(futureAction) focus="使用者提到的稍後／未來事項是否有後續";
    else if(emotionalOpenLoop) focus="使用者先前提到的狀態後來是否有變化";
    else focus="對話中尚未收束的事項";
  }

  return {
    follow_up_worthy:worthy,
    suggested_delay:timing,
    follow_up_focus:focus,
    cancel_if_user_returns:true,
    test_reason:reason,
    semantic_signals:{
      response_or_action_expected:m?.response_or_action_expected ?? null,
      open_task:c?.open_task ?? null,
      state_open_task:u?.open_task ?? null
    }
  };
}

export default {
  async fetch(req,env){
    if(req.method==="OPTIONS") return new Response(null,{headers:CORS});
    if(req.method!=="POST") return json({error:"POST only"},405);
    try{
      const body=await req.json();
      const text=String(body?.message||"").trim();
      if(!text) return json({error:"message required"},400);

      // Reuse the already-deployed Semantic service. One Semantic API call only;
      // no second OpenAI call and no Push is sent in A-v01.
      const sr=await env.SEMANTIC.fetch("https://semantic.internal/",{
        method:"POST",
        headers:{"Content-Type":"application/json"},
        body:JSON.stringify({conversation:`使用者：${text}`})
      });
      const semantic=await sr.json();
      if(!sr.ok || semantic?.status!=="completed"){
        return json({error:"semantic pipeline failed",semantic},502);
      }
      return json({
        status:"completed",
        layer:"peisu_followup_A_v01",
        message:text,
        decision:decide(text,semantic)
      });
    }catch(e){
      return json({error:String(e?.message||e)},500);
    }
  }
};