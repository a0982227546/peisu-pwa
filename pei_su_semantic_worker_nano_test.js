// Pei Su semantic-understanding proxy v0.7 — GPT-5 nano isolated test
// Separate experiment: do not overwrite the working GPT-5 v0.7 Worker.
// Keep OPENAI_API_KEY as a server-side secret.

const SYSTEM = `
你是「對話語意理解器」，不是角色扮演模型。
你的唯一工作是理解使用者提供的連續對話，輸出結構化互動事件。
禁止替裴溯寫台詞，禁止決定裴溯應如何反應，禁止模仿裴溯人格。

重要規則：
1. 每則訊息可同時包含多個 acts，不可只抓第一個詞或第一個意圖。
2. 必須判斷是否延續前文、修正前文、取消舊框架、補充未完成事項。
3. 「算了」不必然代表 withdraw；要讀完整句及上下文。
4. 短訊息可跨 turn 組合成一個互動行為。
5. clarification/repair 是原互動子流程，澄清後要回到原未完成事項。
6. 追蹤 decision_owner 與 obligations。
7. 不確定就明確降低 confidence 並列 uncertainties；禁止把猜測包裝成 high confidence。
8. relationship_relevance 只描述事件與關係的相關度，不決定親密回覆。
9. 只分析最後一則使用者訊息，但要使用前文判斷它的功能與 state_updates。
`;

const schema = {
  type:"object", additionalProperties:false,
  properties:{
    conversation_context:{
      type:"object", additionalProperties:false,
      properties:{
        current_topic:{type:["string","null"]},
        open_task:{type:["object","null"],properties:{},additionalProperties:false},
        interaction_state:{type:"string",enum:["ordinary","light","teasing","serious","probe","conflict","info_defense","intimate","practical","danger","vulnerable"]},
        decision_owner:{type:["string","null"],enum:["user","pei","shared","undecided",null]},
        obligations:{type:"array",items:{type:"string"}}
      },required:["current_topic","open_task","interaction_state","decision_owner","obligations"]
    },
    message_understanding:{
      type:"object", additionalProperties:false,
      properties:{
        acts:{type:"array",items:{type:"string"}},
        continuation_of_previous:{type:"boolean"},
        repairs_or_reframes_previous:{type:"boolean"},
        explicit_content:{type:"array",items:{type:"string"}},
        implied_content:{type:"array",items:{type:"string"}},
        user_state_or_attitude:{type:"array",items:{type:"string"}},
        relationship_relevance:{type:"string",enum:["low","medium","high"]},
        risk:{type:"string",enum:["none","low","medium","high","urgent"]},
        response_or_action_expected:{type:"string",enum:["no","maybe","yes"]},
        confidence:{type:"string",enum:["low","medium","high"]},
        uncertainties:{type:"array",items:{type:"string"}}
      },required:["acts","continuation_of_previous","repairs_or_reframes_previous","explicit_content","implied_content","user_state_or_attitude","relationship_relevance","risk","response_or_action_expected","confidence","uncertainties"]
    },
    state_updates:{
      type:"object",additionalProperties:false,
      properties:{
        open_task:{type:"string",enum:["keep","update","resolve","cancel","none"]},
        decision_owner:{type:"string",enum:["keep","user","pei","shared","undecided"]},
        obligation_updates:{type:"array",items:{type:"string"}}
      },required:["open_task","decision_owner","obligation_updates"]
    }
  },required:["conversation_context","message_understanding","state_updates"]
};

export default {
 async fetch(request, env) {
  const cors={"Access-Control-Allow-Origin":"*","Access-Control-Allow-Headers":"Content-Type","Access-Control-Allow-Methods":"POST,OPTIONS"};
  if(request.method==="OPTIONS") return new Response(null,{headers:cors});
  if(request.method!=="POST") return Response.json({error:"POST only"},{status:405,headers:cors});
  try{
    const {conversation}=await request.json();
    if(!conversation || typeof conversation!=="string") return Response.json({error:"conversation required"},{status:400,headers:cors});
    const r=await fetch("https://api.openai.com/v1/responses",{
      method:"POST",
      headers:{"Authorization":`Bearer ${env.OPENAI_API_KEY}`,"Content-Type":"application/json"},
      body:JSON.stringify({
        model:"gpt-5-nano",
        store:false,
        instructions:SYSTEM,
        input:conversation.slice(-12000),
        text:{format:{type:"json_schema",name:"pei_semantic_event",strict:true,schema}}
      })
    });
    const data=await r.json();
    if(!r.ok) return Response.json({error:data?.error?.message||"OpenAI API error"},{status:r.status,headers:cors});
    const outputText=data.output?.flatMap(x=>x.content||[]).find(x=>x.type==="output_text")?.text;
    if(!outputText) return Response.json({error:"No structured output"},{status:502,headers:cors});
    return new Response(outputText,{headers:{...cors,"Content-Type":"application/json; charset=utf-8"}});
  }catch(e){
    return Response.json({error:String(e?.message||e)},{status:500,headers:cors});
  }
 }
};
