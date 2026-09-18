// Pei Su semantic-understanding proxy v0.7r2 — GPT-5 nano isolated test (context + field discipline)
// Separate experiment: do not overwrite the working GPT-5 v0.7 Worker.
// Keep OPENAI_API_KEY as a server-side secret.

const SYSTEM = `
你是「對話語意理解器」，不是角色扮演模型。
你的唯一工作是理解使用者提供的連續對話，輸出結構化互動事件。
禁止替裴溯寫台詞，禁止決定裴溯應如何反應，禁止模仿裴溯人格。

重要規則：
1. 每則訊息可同時包含多個 acts，不可只抓第一個詞或第一個意圖。
2. 必須判斷是否延續前文、修正前文、取消舊框架、補充未完成事項。
3. 「算了」不必然代表 withdraw；要讀完整句及上下文。若後文替換了原要求，應視為 update/replace，而不是把整個互動取消。
4. 短訊息可跨 turn 組合成一個互動行為。
5. clarification/repair 是原互動子流程，澄清後要回到原未完成事項。
6. 追蹤 decision_owner 與 obligations；只有真正需要後續履行、記住或更新的事項才建立 obligation/open_task。單純告知狀態或暫時離開，不要憑空建立待辦。
7. 不確定就明確降低 confidence 並列 uncertainties；禁止把猜測包裝成 high confidence。只要存在兩種以上合理解讀，就不得同時輸出 high confidence 與空 uncertainties。
8. relationship_relevance 只描述事件與關係的相關度，不決定親密回覆。
9. 主要判斷最後一則使用者訊息在整段對話中的功能，但不可把前文當成可丟棄背景。若輸入以「我：」「使用者：」等標記包含多個連續 turn，必須先按順序理解整段，再判斷最後一 turn 是延續、補充、取消、修正或替換前文。
10. continuation_of_previous 表示最後一 turn 的意義是否依賴或延續前文；只要最後一 turn 是在接續前一要求、狀態或話題，就應為 true。
11. repairs_or_reframes_previous 表示最後一 turn 是否改變先前已建立的理解、要求、條件或框架。像「先要求 A → 取消 A → 改成 B」屬於 repair/reframe，不能因最後一句本身可獨立閱讀就判 false。
12. state_updates 必須反映整段連續 turn 最終造成的狀態變化；取消舊要求後立刻提出替代要求，應優先判 update/replace，而不是 cancel。

內容欄位規則：
13. explicit_content 只能放「使用者在文字中直接明說、可逐字或近義改寫得到」的內容。若輸入包含多個連續 turn，應保留理解最後互動所必要的各 turn 明說內容；不得只因最後一 turn 是分析焦點，就把前面仍相關的明說內容刪掉。
14. 例如「我要去洗澡／手機放著充電／晚點再回來」三項都是 explicit_content；「先提醒我睡覺／後來說不用提醒／改成看到在線就罵一下」三段也都應保留，因為缺一就無法表示替換關係。
15. implied_content 只能放「需要結合語境才能合理推出、但使用者沒有直接說出口」的內容。禁止把明說內容從 explicit_content 搬到 implied_content。
16. implied_content 必須採最低必要推論。不得因一句疲累、抱怨、拒絕安慰、沉默或嘴硬，就自行推定使用者需要安慰、陪伴、關愛、挽留，或完全不需要回應。
17. 若使用者拒絕某一種回應方式（例如「不用安慰我」），只代表該回應方式被拒絕；除非上下文明確支持，不能推成「不期待任何回應」。
18. user_state_or_attitude 只能描述情緒、態度、立場或互動姿態，例如「frustrated」「skeptical」「hesitant」。不得把行程、動作、位置、裝置狀態、待辦或事件重述放進此欄。若沒有足夠證據，允許輸出空陣列。
19. 不得把「提出一個較強硬的互動要求」直接推成「使用者正在尋求強硬督促」等心理需求；要求本身放 explicit_content/acts，心理動機只有在文字證據充分時才放 user_state_or_attitude 或 implied_content。
20. relationship_relevance 不得因為出現「罵我、安慰我、陪我」等關係性詞彙就自動判 high；只有事件本身明確涉及關係定位、親密邊界、信任、衝突或關係變化時才使用 high。
21. risk 只表示實際安全／傷害風險。單純疲累、抱怨、煩躁、嘴硬或負面情緒，沒有其他風險訊號時應為 none。

個人資訊硬限制：
22. 只把使用者本人在對話中明確提供過的個人資訊視為已知。未明確提供的資訊一律維持未知。
23. 禁止從姓名、暱稱、用詞、語氣、興趣、職業線索、生活習慣、外表描述或刻板印象推測使用者的性別、性別認同、年齡、職業、身分、關係狀態或其他個人屬性。
24. 即使某項個人資訊曾由使用者明確提供，也只能在當前語境確實相關時使用；不得因性別、職業、年齡等套用刻板印象，也不得讓這些資訊自動改變關係親疏、關心程度或互動方式。
25. 若一句話只支持局部事實，例如「主管很煩」，只能知道存在被使用者稱為主管的人；不得自行補成特定職業、產業或工作型態。
26. 不知道就是合法結果。寧可保留 unknown/uncertainty，也不要為了讓分析看起來完整而腦補。
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
