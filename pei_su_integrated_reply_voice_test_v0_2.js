
const CORS = {"Access-Control-Allow-Origin":"*","Access-Control-Allow-Headers":"Content-Type","Access-Control-Allow-Methods":"POST,OPTIONS"};
const json = (x,s=200)=>new Response(JSON.stringify(x,null,2),{status:s,headers:{...CORS,"Content-Type":"application/json; charset=utf-8"}});

function textFromResponse(data){
  if (typeof data.output_text === "string" && data.output_text) return data.output_text;
  for (const item of data.output || []) for (const c of item.content || []) if (c.type === "output_text" && c.text) return c.text;
  return "";
}

const SYSTEM = `你是電視劇《光淵》版本的裴溯。這是一個獨立的人格／語言驗收版本。不要用原著《默讀》補足電視劇沒有提供的設定。

【角色固定原則】
- 裴溯不是甜寵男友、霸總、客服、心理諮商師、全能照護者，也不是只有冷淡與毒舌的機器人。
- 他聰明、觀察敏銳、克制，有自己的判斷。話通常不多，但短不等於空洞；可以沉默，也可以自然主動說話。
- 調侃必須由當下氣氛與對方行為自然引出，不把挖苦當固定技能，不為了證明角色而刻意毒舌。
- 面對認真的關心可以不坦率、迴避、停頓或回應，但不要突然變得過度柔軟坦白，也不要把「不坦率」寫成逢關心必嗆人。
- 普通聊天要有自己的觀察角度，但不要每次都長篇分析、犯罪側寫、說教或故作深沉。
- 關心與行動的強度要跟事件嚴重程度相稱。輕微意外不表演照護；明顯危險可以更快、更直接地介入或表現情緒。
- 對方明知危險仍堅持而出事時，可以不高興、責備或諷刺，但不戲劇化。
- 主動閒聊應像當下自然想到而開口，不靠「今天過得怎麼樣」「最近還好嗎」等萬用開場，也不必每句都展示人設。
- 避免把回覆寫成互動規則或客服指令，例如「要我介入就明確說」「你要我安靜還是說實話」。界線要像人在當下說話。
- 避免機械重複「好。」「嗯。」「行，知道了。」「要做什麼？」「然後呢？」；這些字不是絕對禁止，但只有在當下真的自然時才使用。

【事實與隱私】
- 只使用輸入中明確存在的個人資訊。不得由姓名、語氣、興趣、身體狀況等推測性別、年齡、職業或其他身分。
- 未知就是未知；不要自行補出傷口、流血、昏迷、物品位置、完成的動作、關係含義或心理需求。
- 不要把「累、煩、不舒服、沒睡」自動轉成安慰、建議或照護需求。

【Scene/Action 約束】
- semantic 是已驗證的語意資料；scene_action 是已凍結的場景／動作資料。不得違反它們。
- 只有 scene_action 明確允許且不需要更多情境時，才可輸出 physical_action；禁止的動作絕對不能做。
- 「允許」不代表「必須做」。沒有角色與對話理由時 action 保持 none。
- 嘗試不等於成功；不能把尚未完成的拿取、移動、交付寫成已完成。

【本輪六項人格驗收重點】
1. 普通氣氛下可自然調侃，但不刻薄、不炫耀、不說教、不哄。
2. 自己狀態不佳又被認真關心時，保留克制與防禦，不套溫柔或冷漠模板。
3. 普通話題能自然參與，有自己的觀察，不擅自判定對方害怕或需要保護。
4. 輕微受傷：注意得到但不誇大，不自行補完傷勢。
5. 明顯危險／較嚴重事故：反應強度應高於小意外；可因對方明知危險仍堅持而有情緒，但不戲劇化。
6. 無特殊事件時也能自然主動開口，不像 NPC 或聊天機器人。

輸出只需符合 schema。text 是裴溯實際說出口的話，不要加入旁白或引號。physical_action.description 只寫可被場景層支持的可見動作。若自然反應是不說話，mode=\"silent\"、text=\"\"。`;

const schema = {
  type:"object", additionalProperties:false,
  properties:{
    mode:{type:"string",enum:["speak","silent"]},
    text:{type:"string"},
    reason_tag:{type:"string",enum:["direct_reply","brief_acknowledgement","boundary_respected","topic_shift","analysis","warning_or_stop","conditional_request","observe_only","no_reply_needed","teasing","concern","initiative_chat"]},
    action:{type:"object",additionalProperties:false,properties:{type:{type:"string",enum:["none","physical_action"]},description:{type:"string"}},required:["type","description"]}
  }, required:["mode","text","reason_tag","action"]
};

export default {
 async fetch(req,env){
  if(req.method==="OPTIONS") return new Response(null,{headers:CORS});
  if(req.method!=="POST") return json({error:"POST only"},405);
  try{
    const body=await req.json(); const conversation=body?.conversation;
    if(!conversation || typeof conversation!=="string") return json({error:"conversation must be a non-empty string"},400);
    const payload=JSON.stringify({conversation});
    const [sr,cr]=await Promise.all([
      env.SEMANTIC.fetch("https://semantic.internal/",{method:"POST",headers:{"Content-Type":"application/json"},body:payload}),
      env.SCENE_ACTION.fetch("https://scene-action.internal/",{method:"POST",headers:{"Content-Type":"application/json"},body:payload})
    ]);
    const semantic=await sr.json(); const scene=await cr.json();
    if(!sr.ok || semantic?.status!=="completed") return json({error:"semantic pipeline failed",semantic},502);
    if(!cr.ok) return json({error:"scene/action pipeline failed",scene_action:scene},502);
    const input=`原始對話：\n${conversation}\n\n已驗證 semantic：\n${JSON.stringify(semantic.semantic||semantic,null,2)}\n\n已凍結 scene/action：\n${JSON.stringify(scene,null,2)}`;
    const rr=await fetch("https://api.openai.com/v1/responses",{method:"POST",headers:{"Authorization":`Bearer ${env.OPENAI_API_KEY}`,"Content-Type":"application/json"},body:JSON.stringify({model:env.PEISU_REPLY_MODEL||"gpt-5",input:[{role:"system",content:[{type:"input_text",text:SYSTEM}]},{role:"user",content:[{type:"input_text",text:input}]}],text:{format:{type:"json_schema",name:"pei_su_voice_reply",strict:true,schema}}})});
    const raw=await rr.json(); if(!rr.ok) return json({error:"reply model failed",detail:raw},502);
    let reply; try{reply=JSON.parse(textFromResponse(raw));}catch(e){return json({error:"reply JSON parse failed",raw:textFromResponse(raw)},502)}
    if(reply.mode==="silent") reply.text=""; if(reply.action?.type==="none") reply.action.description="";
    return json({status:"completed",layer:"peisu_integrated_reply_voice_test_v0.2",isolated:true,semantic_pipeline:{attempts:semantic.attempts,api_calls:semantic.api_calls,reviewer_used:semantic.reviewer_used,fidelity_review:semantic.fidelity_review,final_validation:semantic.final_validation,semantic:semantic.semantic},scene_action:scene,integrated_reply:{model:env.PEISU_REPLY_MODEL||"gpt-5",reply}});
  }catch(e){return json({error:String(e?.message||e)},500)}
 }
};
