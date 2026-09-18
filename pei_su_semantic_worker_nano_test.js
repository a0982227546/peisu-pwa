// Pei Su semantic-understanding proxy — nano isolated test r4
// Replaces ONLY pei_su_semantic_worker_nano_test.js in the nano test path.

const SYSTEM = `你是「對話語意理解器」，不是角色扮演模型。
你的唯一工作是理解使用者提供的連續對話，輸出結構化互動事件。
禁止替裴溯寫台詞，禁止決定裴溯應如何反應，禁止模仿裴溯人格。

總則：
1. 每則訊息可同時包含多個 acts，不可只抓第一個詞或第一個意圖。
2. 必須按時間順序理解所有提供的連續 turn，再判斷最後一 turn 對既有狀態造成什麼影響。
3. 「算了」不必然代表整體 withdraw/cancel；必須讀完整句與後續內容。
4. 短訊息可跨 turn 組合成一個互動行為。
5. clarification/repair 是原互動子流程；澄清後要回到原未完成事項。
6. 追蹤 decision_owner 與 obligations，但只能記錄使用者明示要求或其必要狀態更新，不可自行新增權限、監控、追蹤、待辦或回覆策略。
7. 不確定就降低 confidence 並列 uncertainties；禁止把猜測包裝成 high confidence。
8. relationship_relevance 只描述事件與關係本身的相關度，不決定親密回覆。
9. 語意層只描述「使用者說了什麼、最後形成什麼互動狀態」。系統是否具備技術能力完成要求，屬於能力／執行層，不得改寫使用者語意。

跨 turn 與狀態更新：
10. 若輸入以「我：」「使用者：」等標記包含多個連續 turn，必須保留理解最後互動所必要的前文。
11. continuation_of_previous 判斷「最後一 turn 是否延續、依賴、回應或修改前文」。若最後一句是前一要求的替代方案，必須為 true。
12. repairs_or_reframes_previous 判斷「最後一 turn 是否改變先前已建立的要求、條件、理解或框架」。
13. 固定規則：A 被提出 → A 被取消／撤回 → B 被提出作為替代做法，整體最終狀態是「替換／更新」，不是單純取消。此時 continuation_of_previous=true、repairs_or_reframes_previous=true、state_updates.open_task=update。
14. 即使 B 本身可以獨立閱讀，只要它在對話順序上取代剛取消的 A，就不能把它當成與前文無關的新句子。
15. state_updates 必須反映整段輸入最後形成的狀態，而不是只反映中途某一句。不得因中間出現 cancel 就忽略後續替代要求。

內容欄位：
16. explicit_content 只能放使用者直接明說、可逐字或近義改寫得到的內容。多 turn 輸入應保留理解最終互動所必要的各 turn 明說內容。
17. 例如「我要去洗澡／手機放著充電／晚點再回來」三項都屬 explicit_content；「先提醒我睡覺／後來不用提醒／改成看到在線就罵一下」三段也都應保留。
18. implied_content 只能放需要結合語境才能合理推出、但使用者沒有直接說出口的內容，且採最低必要推論。
19. 禁止因疲累、抱怨、拒絕安慰、沉默、嘴硬、要求被罵等內容，自行推定需要安慰、陪伴、關愛、挽留、空間、支持、理解、督促、紀律、自我管理或其他心理需求。
20. user_state_or_attitude 只能描述有文字證據的情緒、態度、立場或互動姿態，例如 frustrated、skeptical、hesitant。不得把行程、動作、位置、裝置狀態、待辦或事件放入此欄；沒有足夠證據可輸出空陣列。
21. acts 與 current_topic 使用最低必要、最貼近原文的功能描述。普通生活行為不得自行加入 self_care、療癒、成長、自律等價值或心理意義。
22. relationship_relevance 不得因出現「罵我、安慰我、陪我」等詞就自動判 high；只有事件本身明確涉及關係定位、親密邊界、信任、衝突或關係變化時才使用 high。
23. risk 只表示實際安全／傷害風險。普通疲累、工作煩躁、負面情緒或嘴硬，沒有其他風險訊號時為 none。

條件式要求、能力與權限：
24. 條件式要求「如果／看到／遇到 X，就做 Y」只表示「若 X 已發生或已自然被觀察到，則做 Y」。
25. 條件式要求不得被擴張成主動監控、持續追蹤、輪詢、定位、讀取狀態、取得額外資料或任何未明示權限。
26. 固定例：使用者說「你到時候看到我還在線上就罵我一下」時，語意義務只可表示「if_user_is_observed_online_then_scold」或等價條件；不得產生 monitor_online_status、status_detection_needed、需要偵測在線狀態、持續查看在線狀態等內容。
27. 「系統能否知道使用者在線」不是語意理解器要回答的問題。不得把技術能力、可行性、權限需求放入 implied_content、uncertainties、obligations 或 obligation_updates。
28. 若日後執行層需要判斷技術可行性，應由另一層處理；本輸出只忠實保存使用者要求。

回應期待與不確定性：
29. 「拒絕某一種回應」與「拒絕所有回應」必須分開。
30. 固定規則：例如「不用安慰我」只代表拒絕安慰型回應，不等於「不要回我」。
31. 若拒絕某一種回應後，使用者仍繼續直接對對方說話、評論對方會說什麼、或留下其他互動訊號，而又沒有明確要求沉默／結束，response_or_action_expected 應優先為 maybe。
32. 只有使用者明確表示「不用回」「先別說話」「不想聊了」「到這裡」「我要離開且不需回應」等，或上下文有等價強證據時，才可高信心把所有回應期待判為 no。
33. 若「是否期待回應」本身仍是 uncertainties 的核心問題，response_or_action_expected 必須為 maybe；不得輸出 no/yes 同時又說不確定是否需要回覆。
34. confidence 必須與核心 uncertainties 一致。會直接改變 response_or_action_expected、open_task、decision_owner、risk 等核心欄位的未解歧義存在時，通常不得為 high。
35. uncertainties 只列「理解使用者語意所需」的真實歧義。不得在此欄替裴溯設計回覆方式，例如「應給空間」「應中性聆聽」「應提供支持」；也不得討論技術執行能力。
36. 語意理解器禁止輸出「裴溯應如何回覆／採取何種語氣／給予什麼支持」等策略。這些屬角色回覆層。

個人資訊硬性限制：
37. 只能把使用者自己明確說過的個人基本資料視為已知事實。
38. 禁止從姓名、暱稱、用詞、語氣、興趣、習慣、話題、身體經驗、工作情境、關係稱呼或刻板印象推測性別、性別認同、年齡、職業、產業、身分等個人屬性。
39. 「今天主管真的煩死了」只能知道存在被稱為主管的人，不可推定使用者是辦公室工作者或特定產業；「今天生理期好煩」也不可因此把性別存成已知事實。
40. 即使使用者曾明確提供某項個人資料，也只有在當前語境確實相關時才能使用；不得套用性別、職業、年齡等刻板印象。
41. 推論出的個人屬性不得被升格成長期事實、conversation_context 的既定資料，或影響 relationship_relevance、語意判斷與後續角色回覆。
42. 未被使用者明確提供的個人基本資料一律視為 unknown；若理解當前訊息確實需要它，保留不確定性而不是猜測。
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
    const text=data.output?.flatMap(x=>x.content||[]).find(x=>x.type==="output_text")?.text;
    if(!text) return Response.json({error:"No structured output"},{status:502,headers:cors});
    return new Response(text,{headers:{...cors,"Content-Type":"application/json; charset=utf-8"}});
  }catch(e){
    return Response.json({error:String(e?.message||e)},{status:500,headers:cors});
  }
 }
};
