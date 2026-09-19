// Pei Su semantic retry controller v1 — isolated test + diagnostic stage labels
// Flow: original conversation -> nano r4 -> validator -> at most ONE nano retry -> validator
// This controller itself does not reinterpret semantics.
// Required Cloudflare secrets/vars:
//   OPENAI_API_KEY
// Optional:
//   VALIDATOR_URL (defaults to the current standalone validator)

const VALIDATOR_URL_DEFAULT =
  "https://peisu-semantic-validator-v1.a0982227546.workers.dev";
const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Allow-Methods": "POST,OPTIONS"
};

const SYSTEM = `
你是「對話語意理解器」，不是角色扮演模型。
只理解使用者提供的連續對話並輸出結構化互動事件。
禁止替裴溯寫台詞、決定裴溯如何反應、模仿裴溯人格。
硬性規則：
1. explicit_content 保留使用者明說的內容；implied_content 只放必要且有文本依據的隱含內容。
2. 不確定就降低 confidence 並寫 uncertainties，不可把猜測寫成事實。
3. 不推斷使用者未明說的性別、性別認同、年齡、職業、產業、身份等個人資料。
4. 不把「不用安慰」擴張成「不要任何情感支持」或「不要回應」。
5. request A → cancel A → replacement B：整體仍延續前文；repairs_or_reframes_previous=true；open_task 應反映更新而非只取消。
6. 條件式要求不代表取得監控、偵測、追蹤能力；語意層不討論技術可行性。
7. uncertainties 只描述語意上的不確定，不提供回覆策略。
8. user_state_or_attitude 不要填 neutral，也不要把事件/動作當態度。
9. 只做最少必要推論。
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
      type:"object",additionalProperties:false,
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

function diagnosticError(stage, message, extra={}){
  const e = new Error(message);
  e.stage = stage;
  e.extra = extra;
  return e;
}

async function readJsonOrDiagnose(response, stage){
  const raw = await response.text();
  let data;
  try {
    data = raw ? JSON.parse(raw) : null;
  } catch (_) {
    throw diagnosticError(stage, `Non-JSON response: ${raw.slice(0,500) || "(empty body)"}`, {
      http_status: response.status,
      content_type: response.headers.get("content-type") || null
    });
  }
  return {data, raw};
}

async function runNano(env, conversation, retryReasons=null){
  const feedback = retryReasons?.length
    ? `\n\n這是一次且僅一次的重新判讀。上一版被驗證器擋下，原因：\n- ${retryReasons.join("\n- ")}\n請重新從原始對話判讀；不要為了迎合驗證器而直接改欄位。`
    : "";
  let r;
  try {
    r=await fetch("https://api.openai.com/v1/responses",{
      method:"POST",
      headers:{
        "Authorization":`Bearer ${env.OPENAI_API_KEY}`,
        "Content-Type":"application/json"
      },
      body:JSON.stringify({
        model:"gpt-5-nano",
        store:false,
        instructions:SYSTEM+feedback,
        input:conversation.slice(-12000),
        text:{format:{type:"json_schema",name:"pei_semantic_event",strict:true,schema}}
      })
    });
  } catch(e) {
    throw diagnosticError("OPENAI_FETCH", String(e?.message||e));
  }
  const {data}=await readJsonOrDiagnose(r,"OPENAI_RESPONSE");
  if(!r.ok) throw diagnosticError("OPENAI_API", data?.error?.message||"OpenAI API error", {http_status:r.status});
  const text=data?.output?.flatMap(x=>x.content||[]).find(x=>x.type==="output_text")?.text;
  if(!text) throw diagnosticError("OPENAI_STRUCTURED_OUTPUT","No structured output");
  try {
    return JSON.parse(text);
  } catch(e) {
    throw diagnosticError("OPENAI_OUTPUT_PARSE", String(e?.message||e));
  }
}

async function validate(env, semantic){
  const url=env.VALIDATOR_URL||VALIDATOR_URL_DEFAULT;
  let r;
  try {
    r=await fetch(url,{
      method:"POST",
      headers:{"Content-Type":"application/json"},
      body:JSON.stringify(semantic)
    });
  } catch(e) {
    throw diagnosticError("VALIDATOR_FETCH", String(e?.message||e), {validator_url:url});
  }
  const {data}=await readJsonOrDiagnose(r,"VALIDATOR_RESPONSE");
  if(!r.ok) throw diagnosticError("VALIDATOR_API", data?.error||"Validator error", {http_status:r.status,validator_url:url});
  return data;
}

export default {
  async fetch(request,env){
    if(request.method==="OPTIONS") return new Response(null,{status:204,headers:cors});
    if(request.method!=="POST") return Response.json({error:"POST only"},{status:405,headers:cors});
    try{
      const {conversation}=await request.json();
      if(!conversation||typeof conversation!=="string")
        return Response.json({error:"conversation required"},{status:400,headers:cors});

      const firstSemantic=await runNano(env,conversation);
      const firstValidation=await validate(env,firstSemantic);
      if(firstValidation.status!=="RETRY"){
        return Response.json({
          status:"completed",
          attempts:1,
          final_validation:firstValidation.status,
          semantic:firstValidation.semantic,
          debug:{
            original_conversation:conversation,
            first_semantic:firstSemantic,
            first_validation:firstValidation
          }
        },{headers:cors});
      }

      const secondSemantic=await runNano(env,conversation,firstValidation.reasons||[]);
      const secondValidation=await validate(env,secondSemantic);
      if(secondValidation.status==="RETRY"){
        return Response.json({
          status:"validation_failed",
          attempts:2,
          reasons:secondValidation.reasons||[],
          debug:{
            original_conversation:conversation,
            first_semantic:firstSemantic,
            first_validation:firstValidation,
            second_semantic:secondSemantic,
            second_validation:secondValidation
          }
        },{status:422,headers:cors});
      }

      return Response.json({
        status:"completed",
        attempts:2,
        final_validation:secondValidation.status,
        semantic:secondValidation.semantic,
        debug:{
          original_conversation:conversation,
          first_semantic:firstSemantic,
          first_validation:firstValidation,
          second_semantic:secondSemantic,
          second_validation:secondValidation
        }
      },{headers:cors});
    }catch(e){
      return Response.json({
        error:"diagnostic_failure",
        stage:e?.stage||"CONTROLLER",
        message:String(e?.message||e),
        details:e?.extra||{}
      },{status:500,headers:cors});
    }
  }
};
