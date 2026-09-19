// Pei Su semantic retry controller v1 — isolated test + diagnostic stage labels
// Flow: original conversation -> nano r4 -> validator -> at most ONE nano retry -> validator
// This controller itself does not reinterpret semantics.
// Required Cloudflare secrets/vars:
//   OPENAI_API_KEY
// Required Cloudflare Service Binding:
//   VALIDATOR -> peisu-semantic-validator-v1
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
10. response_or_action_expected：
   - yes = 原文明確要求或明確期待回應／行動。
   - no = 原文明確表示不需要、不希望或拒絕任何回應／行動。
   - maybe = 原文有支持「可能期待互動」的訊號，但仍不能確定。
   - unknown = 原文不足以判斷是否期待回應／行動。不要因為「沒有提問／只是陳述」就填 no。
11. 使用者提出「如果／到時候／看到某狀態就做 X」之類的條件式要求時，可以在 explicit_content / acts 中理解並保留該要求；但除非原文或系統狀態已明確確認技術能力與任務建立成功，不得把它寫成已成立的 obligations 或 obligation_updates。尤其不得把「看到我在線」「到時提醒我」等要求自行升格成背景監控、偵測在線狀態、排程或通知能力。
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
        response_or_action_expected:{type:"string",enum:["no","maybe","yes","unknown"]},
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
    ? `\n\n這是一次且僅一次的重新判讀。上一版未通過忠實度／驗證檢查。請重新從原始對話產生完整 semantic。\n
上一版的具體問題：\n- ${retryReasons.join("\n- ")}\n
重新判讀時必須遵守：
1. 問題代表「推論類型」有問題，不只是某個單字；禁止用同義詞保留同一個無證據推論。
2. implied_content、user_state_or_attitude、relationship_relevance、response_or_action_expected，以及新增的需求／偏好／義務，都必須有原文具體支持。
3. 有充分證據的理解必須保留；不要因為被退回就把所有內容改成 unknown、none 或空陣列。
4. 原文只能支持較窄意思時，只保留較窄意思。
5. 不加入裴溯應如何回覆的策略，不推斷未明說的個人資料。
6. response_or_action_expected 的 yes / maybe / no 都需要原文證據；若三者都沒有足夠證據，使用 unknown。「沒有提問／只是陳述」本身不等於 no。
7. 條件式要求可以保留在 explicit_content / acts；但不能因為使用者提出要求，就在 obligations / obligation_updates 中宣告背景監控、在線偵測、排程、通知等能力或已建立任務。
不要評論修改，只輸出完整 semantic JSON。`
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

async function validate(env, conversation, semantic){
  if(!env.VALIDATOR || typeof env.VALIDATOR.fetch!=="function") {
    throw diagnosticError("VALIDATOR_BINDING", "VALIDATOR Service Binding is missing");
  }
  let r;
  try {
    r=await env.VALIDATOR.fetch("https://validator.internal/",{
      method:"POST",
      headers:{"Content-Type":"application/json"},
      body:JSON.stringify({conversation, semantic})
    });
  } catch(e) {
    throw diagnosticError("VALIDATOR_FETCH", String(e?.message||e), {transport:"service_binding"});
  }
  const {data}=await readJsonOrDiagnose(r,"VALIDATOR_RESPONSE");
  if(!r.ok) throw diagnosticError("VALIDATOR_API", data?.error||"Validator error", {http_status:r.status,transport:"service_binding"});
  return data;
}

const reviewerSchema = {
  type:"object",
  additionalProperties:false,
  properties:{
    status:{type:"string",enum:["PASS","RETRY"]},
    issues:{
      type:"array",
      items:{
        type:"object",
        additionalProperties:false,
        properties:{
          field:{type:"string"},
          value:{type:"string"},
          reason:{type:"string"}
        },
        required:["field","value","reason"]
      }
    }
  },
  required:["status","issues"]
};

const REVIEWER_SYSTEM = `
你是「語意忠實度審核員」，不是第二個語意理解器，也不是角色扮演模型。
你的唯一任務是做「原文證據核對」：候選 semantic 中每一個不是逐字明說的判斷，都必須能由原始對話中的具體文字直接支持。

審核方法（必須逐項執行）：
1. 逐項檢查 implied_content 的每一項。
2. 逐項檢查 user_state_or_attitude 的每一項。
3. 檢查 relationship_relevance；medium/high 必須有原文明確顯示關係層面的內容，不能只因為語氣強烈、抱怨、拒絕安慰或質疑回覆就提高。
4. 檢查 response_or_action_expected：
   - yes：原文明確要求或明確期待回應／行動。
   - no：原文明確表示不需要、不希望或拒絕任何回應／行動；「沒有提問」「只是陳述」「沒有明說要回覆」都不能推出 no。
   - maybe：原文存在可支持「可能期待互動但不確定」的訊號。
   - unknown：原文不足以判斷是否期待回應／行動時使用；這不是錯誤，也不需要硬找期待或拒絕的證據。
   若候選為 yes / maybe / no 而原文不足以支持該值，必須 RETRY，應讓重新判讀有機會改為 unknown；不可替使用者猜。
5. 檢查其他需要推導才成立的狀態、義務、偏好、風險或互動意義。若候選把使用者的局部界線擴張成一般偏好、把當下情緒擴張成另一種狀態、或加入回覆策略，均視為缺乏證據。
6. 特別檢查 conversation_context.obligations 與 state_updates.obligation_updates：使用者「提出／修改／取消一個要求」不等於系統已承諾或已具備執行能力。若內容把條件式要求升格成已建立的背景監控、在線偵測、排程、通知或其他技術義務，必須 RETRY。只有已有明確系統確認／能力狀態支持時，才可形成可執行 obligation。

證據標準：
- PASS 的理由必須是「原文有足夠文字證據」，不是「這個推論合理、常見、可能成立」。
- 「可能」「大概」「may」「likely」等弱化措辭仍然需要原文證據。
- 不可用常識、心理學推測、典型聊天模式、角色關係或先驗印象補足證據。
- 不可從「工作很煩」自行推出 tired、stress、exhausted 等不同狀態，除非原文另有支持。
- 不可從「你不用安慰我」推出「希望少回覆／不要回覆／只要中性實用回覆」；它只直接限制安慰。
- 不可從「你大概也不知道要說什麼」推出對方能力低、回覆無效或沒有作用；只能保留原文實際支持的質疑範圍。
- 不推斷未明說的性別、性別認同、年齡、職業、產業、身份。
- 若某項找不到足夠原文證據，status 必須 RETRY，並在 issues 中指出 field、候選 value、以及「原文缺少哪種證據」。
- 只要任一受審項目不合格，整體就是 RETRY。
- 只有所有受審項目都有充分證據時才 PASS。

限制：
- 不產生新的 semantic，不改欄位。
- 不提出替代答案。
- 不評估裴溯應如何回覆。
- 不因為候選整體看起來自然或合理就放寬標準。
`;

function needsSemanticReview(semantic){
  const mu=semantic?.message_understanding||{};
  if(Array.isArray(mu.implied_content) && mu.implied_content.length) return true;
  if(Array.isArray(mu.user_state_or_attitude) && mu.user_state_or_attitude.length) return true;

  // medium/high relationship relevance is itself a contextual inference.
  if(mu.relationship_relevance==="medium" || mu.relationship_relevance==="high") return true;

  // yes / maybe / no are all semantic judgments and all require evidence review.
  if(["yes","maybe","no","unknown"].includes(mu.response_or_action_expected)) return true;

  return false;
}

async function reviewSemantic(env, conversation, semantic){
  let r;
  try{
    r=await fetch("https://api.openai.com/v1/responses",{
      method:"POST",
      headers:{
        "Authorization":`Bearer ${env.OPENAI_API_KEY}`,
        "Content-Type":"application/json"
      },
      body:JSON.stringify({
        model:"gpt-5-nano",
        store:false,
        instructions:REVIEWER_SYSTEM,
        input:
          "【原始對話】\n"+conversation.slice(-12000)+
          "\n\n【候選 semantic】\n"+JSON.stringify(semantic),
        text:{format:{
          type:"json_schema",
          name:"pei_semantic_fidelity_review",
          strict:true,
          schema:reviewerSchema
        }}
      })
    });
  }catch(e){
    throw diagnosticError("REVIEWER_FETCH",String(e?.message||e));
  }

  const {data}=await readJsonOrDiagnose(r,"REVIEWER_RESPONSE");
  if(!r.ok) throw diagnosticError(
    "REVIEWER_API",
    data?.error?.message||"Reviewer API error",
    {http_status:r.status}
  );
  const text=data?.output?.flatMap(x=>x.content||[])
    .find(x=>x.type==="output_text")?.text;
  if(!text) throw diagnosticError("REVIEWER_STRUCTURED_OUTPUT","No structured output");
  try{
    return JSON.parse(text);
  }catch(e){
    throw diagnosticError("REVIEWER_OUTPUT_PARSE",String(e?.message||e));
  }
}

function reviewerReasons(review){
  return (review?.issues||[]).map(
    x=>`${x.field}: ${x.value} — ${x.reason}`
  );
}

export default {
  async fetch(request,env){
    if(request.method==="OPTIONS") return new Response(null,{status:204,headers:cors});
    if(request.method!=="POST") return Response.json({error:"POST only"},{status:405,headers:cors});
    try{
      const {conversation}=await request.json();
      if(!conversation||typeof conversation!=="string")
        return Response.json({error:"conversation required"},{status:400,headers:cors});

      // API call #1: first semantic understanding.
      const firstSemantic=await runNano(env,conversation);
      const firstValidation=await validate(env,conversation,firstSemantic);

      // Mechanical validator RETRY goes directly to the one allowed regeneration.
      if(firstValidation.status==="RETRY"){
        const reasons=firstValidation.reasons||[];
        const secondSemantic=await runNano(env,conversation,reasons); // API call #2
        const secondValidation=await validate(env,conversation,secondSemantic);

        if(secondValidation.status==="RETRY"){
          return Response.json({
            status:"validation_failed",
            attempts:2,
            api_calls:2,
            reviewer_used:false,
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

        const secondClean=secondValidation.semantic;

        // After a mechanical-validator retry, the regenerated semantic must still
        // pass the same semantic-fidelity gate. This is API call #3 at most.
        if(needsSemanticReview(secondClean)){
          const secondReview=await reviewSemantic(env,conversation,secondClean); // API call #3

          if(secondReview.status==="RETRY"){
            return Response.json({
              status:"validation_failed",
              attempts:2,
              api_calls:3,
              reviewer_used:true,
              fidelity_review:"SECOND_RETRY_BLOCKED",
              reasons:reviewerReasons(secondReview),
              debug:{
                original_conversation:conversation,
                first_semantic:firstSemantic,
                first_validation:firstValidation,
                second_semantic:secondSemantic,
                second_validation:secondValidation,
                second_review:secondReview
              }
            },{status:422,headers:cors});
          }

          return Response.json({
            status:"completed",
            attempts:2,
            api_calls:3,
            reviewer_used:true,
            fidelity_review:"SECOND_PASS",
            final_validation:secondValidation.status,
            semantic:secondClean,
            debug:{
              original_conversation:conversation,
              first_semantic:firstSemantic,
              first_validation:firstValidation,
              second_semantic:secondSemantic,
              second_validation:secondValidation,
              second_review:secondReview
            }
          },{headers:cors});
        }

        return Response.json({
          status:"completed",
          attempts:2,
          api_calls:2,
          reviewer_used:false,
          final_validation:secondValidation.status,
          semantic:secondClean,
          debug:{
            original_conversation:conversation,
            first_semantic:firstSemantic,
            first_validation:firstValidation,
            second_semantic:secondSemantic,
            second_validation:secondValidation
          }
        },{headers:cors});
      }

      const firstClean=firstValidation.semantic;

      // No added/inferred semantics: skip the AI reviewer entirely.
      if(!needsSemanticReview(firstClean)){
        return Response.json({
          status:"completed",
          attempts:1,
          api_calls:1,
          reviewer_used:false,
          final_validation:firstValidation.status,
          semantic:firstClean,
          debug:{
            original_conversation:conversation,
            first_semantic:firstSemantic,
            first_validation:firstValidation
          }
        },{headers:cors});
      }

      // API call #2: fidelity reviewer. It can only PASS or request one RETRY.
      const firstReview=await reviewSemantic(env,conversation,firstClean);

      if(firstReview.status==="PASS"){
        return Response.json({
          status:"completed",
          attempts:1,
          api_calls:2,
          reviewer_used:true,
          final_validation:firstValidation.status,
          fidelity_review:"PASS",
          semantic:firstClean,
          debug:{
            original_conversation:conversation,
            first_semantic:firstSemantic,
            first_validation:firstValidation,
            first_review:firstReview
          }
        },{headers:cors});
      }

      // API call #3: one and only semantic regeneration.
      const retryReasons=reviewerReasons(firstReview);
      const secondSemantic=await runNano(env,conversation,retryReasons);
      const secondValidation=await validate(env,conversation,secondSemantic);

      // Hard stop: no fourth API call and no second reviewer call.
      if(secondValidation.status==="RETRY"){
        return Response.json({
          status:"validation_failed",
          attempts:2,
          api_calls:3,
          reviewer_used:true,
          reasons:secondValidation.reasons||retryReasons,
          debug:{
            original_conversation:conversation,
            first_semantic:firstSemantic,
            first_validation:firstValidation,
            first_review:firstReview,
            second_semantic:secondSemantic,
            second_validation:secondValidation
          }
        },{status:422,headers:cors});
      }

      return Response.json({
        status:"completed",
        attempts:2,
        api_calls:3,
        reviewer_used:true,
        fidelity_review:"RETRY_APPLIED",
        final_validation:secondValidation.status,
        semantic:secondValidation.semantic,
        debug:{
          original_conversation:conversation,
          first_semantic:firstSemantic,
          first_validation:firstValidation,
          first_review:firstReview,
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
