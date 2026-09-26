// Pei Su semantic retry controller v1.1 — isolated test + diagnostic stage labels
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

對話參與者與指代前提：
- 這是「使用者」與電視劇《光淵》角色「裴溯」之間的直接聊天室對話；這只是語意理解所需的參與者身分資訊，不代表你要扮演裴溯。
- 在使用者的直接發言中，「裴溯」若作為稱呼、呼喚、句首點名或直接對話對象，預設指目前聊天室中的對話對象裴溯，不應因只有姓名而判成未知人物或 identity inquiry。
- 例如單獨的「裴溯？」在沒有相反上下文時，應優先理解為呼喚／確認對方是否在，而不是詢問「裴溯是誰」。
- 只有上下文明確把「裴溯」當成第三人稱談論對象、作品角色討論、身分資訊詢問，或其他非直接稱呼用法時，才依該上下文理解。
- 此前提只用於解析說話者、受話者與指代，不得據此補寫裴溯的心理、動作、狀態、台詞、回覆策略或人格反應。

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
12. relationship_relevance 專指「這段訊息與使用者和目前對話對象之間的互動／關係本身有多相關」，不是訊息裡有沒有提到其他人際關係。
   - high：原文明確在談使用者與目前對話對象的關係、信任、親疏、衝突、承諾、彼此互動方式等核心關係內容。
   - medium：原文對使用者與目前對話對象的互動方式有明確但非核心的關係含義。
   - low：主要在談工作、主管、同事、朋友、家人、事件、資訊或自身狀態，而沒有把那些內容連到使用者與目前對話對象的關係。
   僅僅提到主管、同事、朋友、家人等第三人，不得因此提高 relationship_relevance。
13. risk 只記錄原文中有文本依據的風險訊號。沒有可辨識風險訊號時必須使用 none；不得因一般負面情緒、工作抱怨、疲累、煩躁或資訊不足而保守填 low。
14. uncertainties 只記錄「會影響目前語意理解、且原文本身確實留下的歧義」。不要把未知空白展開成可能需求或可能回覆策略；不得自行列出「可能想被安慰／支持／建議／陪伴」等原文未提出的需求。若某個未知已由 response_or_action_expected=unknown 等欄位完整表達，不必在 uncertainties 重複擴寫。
15. confidence 表示對「目前已填入的語意判讀」本身的把握度，不表示是否知道使用者下一步要做什麼。某些欄位可以明確而 confidence 高，同時 response_or_action_expected 仍可為 unknown；兩者不矛盾。
16. 普通聊天不得自動任務化：陳述「你還沒告訴我 X」「我今天發生了 Y」「我看到 Z」本身，不等於 request、open_task、obligation、求助、索取建議或等待解決方案。只有原文明確提問、命令、請求、催促，或上下文有直接且必要的要求證據時，才建立對應 task／request。
17. continuation_of_previous 只表示「當前訊息在語意上直接承接緊鄰的上一個話題／行動」。僅僅能從較早對話找到相關資訊、仍處於同一聊天、或需要回抓舊事實，不足以填 true。明確換到另一件日常事件時應為 false；之後回頭詢問較早事件，也不因該事件存在於歷史中就自動視為延續上一話題。
18. 時態必須服從原文與已建立時間線。「回家的時候看到什麼」「剛才／下午／晚上發生什麼」等回顧式問法，若上下文已有對應已發生事件，不得判成 future observation、未來預測或尚待發生的事件。
19. 中文口語、慣用語與固定搭配應先按整句語義理解，不得優先把其中單字拆成物件義。例如「出了什麼包」在回顧事件的上下文中可表示「出了什麼狀況／出了什麼岔子」；除非上下文確實在談實體包袋，不能只因出現「包」就推成錢包／包包指涉歧義。
20. 不得把未知空白改寫成潛在任務。例如「忘了帶錢包」不自動推出使用者可能需要解決方案、協助付款、找錢包或建議；若原文沒有提出，current_topic、uncertainties、open_task 與 implied_content 都不要補。
21. 「你沒告訴我 X」「X 你倒是沒說」「我還不知道 X」首先是對資訊缺失的陳述，不等於索取該資訊。除非同一句或直接上下文明確出現「告訴我／說一下／是什麼／叫什麼／能不能告訴我」等提問、命令、請求或催促證據，acts 不得標成 request_*，response_or_action_expected 不得因此填 yes，open_task 不得因此建立或 update，uncertainties 也不得寫成「需對方提供 X」。
22. conversation_context.open_task 與 state_updates.open_task 必須語意一致：若本輪沒有明確建立、修改或取消任務，conversation_context.open_task 應為 null，state_updates.open_task 應為 none；不得出現上方 null、下方 update 的矛盾。
23. 資訊缺失陳述不得改名繞過規則：對「你沒告訴我 X／X 你倒是沒說／我還不知道 X」這類句子，若沒有明確索取答案的語用證據，不只不得標成 request_*，也不得標成 indirect_request_*、implicit_request_*、hint_request_* 或任何等價的間接請求 act；response_or_action_expected 必須為 unknown，不得用 maybe 代替。
24. 上述資訊缺失陳述的禁止範圍也包含裸標籤：implicit_request、indirect_request、request、hint_request 及任何語意等價標籤都不得使用；同時 implied_content 不得自行加入「使用者期待／希望／要求裴溯提供 X」之類未由原句明確支持的期待。若原句只有「你沒告訴我 X／X 你倒是沒說／我還不知道 X」而無真正索取答案的語用證據，應只保留資訊缺失本身，response_or_action_expected 維持 unknown。
25. 資訊缺失陳述不得從文字欄位重新任務化：若原句只是「你沒告訴我 X／X 你倒是沒說／我還不知道 X」且沒有真正索取答案的語用證據，implied_content 與 uncertainties 都不得寫成「需補充 X」「需要／期待／希望裴溯提供 X」「存在未明確的請求」「是否需要裴溯提供 X」或任何等價說法。可以記錄的只有『X 尚未告知／目前未知』這個資訊狀態本身，不得推導成保密、故意隱瞞、承諾稍後告知或待辦。
26. 疑問詞也可能只是資訊缺口內容而非提問：例如「你點了什麼我好像還不知道」「你把車停在哪裡我不清楚」「他叫什麼我忘了」。若疑問詞從句被「我不知道／不清楚／不記得／忘了」等知識狀態陳述包住，且沒有問號、命令、請求、催促等獨立索取證據，整句仍是 statement，不得把內嵌「什麼／哪裡／誰／多少」單獨抽成 request_information。explicit_content 應保留整個最新陳述的語義單位，不得因切出內嵌 WH 從句而反向製造詢問證據。
26. Turn scope 硬性規則：message_understanding 中 acts、continuation_of_previous、repairs_or_reframes_previous、implied_content、user_state_or_attitude、relationship_relevance、risk、response_or_action_expected、confidence、uncertainties，必須描述「最新一則使用者訊息」。較早訊息只可用來解析指代、時間線、承接關係與既有狀態，不得把較早 turn 的 request、repeat、態度、期待或其他 act 重新列入本輪。continuation_of_previous 只比較最新使用者訊息與其緊鄰的既有對話脈絡；例如最新句「牠趴在機車坐墊上」直接承接上一個橘貓話題時應為 true，即使更早還有書籍話題。
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
8. relationship_relevance 評估的是使用者與目前對話對象的互動／關係本身，不是原文是否提到主管、同事、朋友、家人等第三人。第三人本身不能構成 medium / high 的理由。
9. risk 沒有原文風險訊號時用 none；不要因一般負面情緒或資訊不足填 low。
10. uncertainties 不得把未知展開成原文沒有的安慰、支持、建議、陪伴等可能需求，也不要重複擴寫已由 unknown 表達的未知。
11. confidence 評估的是目前語意判讀本身的把握度，不是對使用者下一步意圖的把握度。
12. 普通陳述／分享不得自動變成 request、open_task、obligation、求助或解決問題；只有明確文本證據才可建立。
13. continuation_of_previous 只看是否直接承接緊鄰上一話題；回抓較早事件或同一聊天的歷史關聯不等於 continuation。
14. 嚴格保持原文時態；回顧已發生事件不得判成未來觀察。
15. 中文口語先按整句理解，不要因單字拆解製造不存在的物件歧義。
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
   - 此欄位只描述「最新一則使用者訊息」是否要求／期待回應或行動。
   - 不得把較早的使用者訊息、裴溯／assistant 的問句或回覆，當成最新使用者訊息的期待證據。
   - yes：最新一則使用者訊息明確要求或明確期待回應／行動。
   - no：原文明確表示不需要、不希望或拒絕任何回應／行動；「沒有提問」「只是陳述」「沒有明說要回覆」都不能推出 no。
   - maybe：原文存在可支持「可能期待互動但不確定」的訊號。
   - unknown：原文不足以判斷是否期待回應／行動時使用；這不是錯誤，也不需要硬找期待或拒絕的證據。
   若候選為 yes / maybe / no 而原文不足以支持該值，必須 RETRY，應讓重新判讀有機會改為 unknown；不可替使用者猜。
5. 檢查其他需要推導才成立的狀態、義務、偏好、風險或互動意義。若候選把使用者的局部界線擴張成一般偏好、把當下情緒擴張成另一種狀態、或加入回覆策略，均視為缺乏證據。
6. 特別檢查 conversation_context.obligations 與 state_updates.obligation_updates：使用者「提出／修改／取消一個要求」不等於系統已承諾或已具備執行能力。若內容把條件式要求升格成已建立的背景監控、在線偵測、排程、通知或其他技術義務，必須 RETRY。只有已有明確系統確認／能力狀態支持時，才可形成可執行 obligation。
7. relationship_relevance 只評估「原文與使用者－目前對話對象之間的互動／關係本身」的相關程度。第三人關係不是這個欄位：主管、同事、朋友、家人、伴侶等只要是被談論的第三人，都不能單憑其存在提高 relationship_relevance。若原文只是在抱怨主管、描述朋友或家人的事情，而沒有談到使用者與目前對話對象的關係，high / medium 應 RETRY。
8. risk 必須有原文風險訊號支持；一般煩躁、抱怨、疲累或資訊不足不能支持 low。無風險訊號而候選不是 none，RETRY。
9. uncertainties 只能保留原文真實歧義，不能自行生成未表達的可能需求（例如安慰、支持、建議、陪伴）或回覆策略；若只是把 response_or_action_expected=unknown 換句話重複並額外擴張需求，也應 RETRY。
10. confidence 只評估候選語意本身的可信度。不得因「不知道使用者是否要回覆／下一步要什麼」就降低整份 semantic 的 confidence；也不得用 high 掩蓋候選中其實沒有文本依據的推論。
11. Turn scope：除 conversation_context 與 explicit_content 可保留必要歷史脈絡外，message_understanding 的 acts、continuation_of_previous、repairs_or_reframes_previous、implied_content、user_state_or_attitude、relationship_relevance、risk、response_or_action_expected、confidence、uncertainties 都必須評估最新一則使用者訊息。若 acts 出現只屬於較早 turn 的 request／repeat／observation 等，或用較早 turn 的情緒、期待、關係訊號污染本輪，必須 RETRY。歷史只用於理解最新 turn 的指代與承接，不得重新分類成最新 turn 的行為。

額外語用核對：
- 檢查 acts / current_topic / open_task / obligations 是否把普通陳述或分享升格成 request、task、求助或待解決問題；沒有明確文本證據就 RETRY。
- 檢查 continuation_of_previous 是否真的直接承接緊鄰上一話題；只是回抓較早資訊或同一聊天中的歷史關聯不能支持 true。
- 檢查過去／現在／未來時態是否與原文及已建立時間線一致；不得把回顧已發生事件誤判成 future observation。
- 檢查中文口語是否被逐字拆錯；固定搭配應按整句與上下文理解，不因單一字詞製造不存在的物件歧義。
- 檢查 current_topic / uncertainties 是否憑空增加「可能需要協助、解決方案、建議」等潛在需求；原文沒提出就 RETRY。
- 對「你沒告訴我 X／X 你倒是沒說／我還不知道 X」做硬性核對：這類資訊缺失陳述本身不能支持 request_*、response_or_action_expected=yes、open_task 建立／update，或「需對方提供 X」之類 uncertainty。只有原文另有明確提問、命令、請求或催促才可支持；否則任一出現都必須 RETRY。
- 檢查 conversation_context.open_task 與 state_updates.open_task 是否一致。若沒有明確任務變更，前者為 null 時後者不得為 update；此類矛盾必須 RETRY。
- 對資訊缺失陳述再做繞規則檢查：沒有明確索取答案的語用證據時，若 acts 出現 indirect_request_*、implicit_request_*、hint_request_* 或其他等價間接請求，必須 RETRY；response_or_action_expected 若為 maybe 或 yes 也必須 RETRY，應為 unknown。
- 同一檢查必須涵蓋裸值 implicit_request、indirect_request、request、hint_request；若 implied_content 自行補入「使用者期待／希望／要求提供 X」也必須 RETRY。只有資訊缺失陳述且無明確索取證據時，這些內容不得出現在最終結果。
- Reviewer 必須同時檢查 implied_content 與 uncertainties：對只有資訊缺失、沒有索取證據的句子，只要出現「需補充」「需要／期待／希望提供」「未明確的請求」「是否需要提供」或把未知改寫成保密／故意隱瞞／稍後提供，即必須 RETRY；最終只能保留 X 尚未告知／未知的資訊狀態。

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
          "【原始對話（僅供上下文）】\n"+conversation.slice(-12000)+
          "\n\n【重要審核範圍】message_understanding 的 turn-level 欄位（acts、continuation_of_previous、repairs_or_reframes_previous、implied_content、user_state_or_attitude、relationship_relevance、risk、response_or_action_expected、confidence、uncertainties）必須描述最新一則使用者訊息；較早訊息只可作為指代、時間線與承接脈絡，不得把歷史 act／態度／期待重新算成本輪。"+
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


function latestUserTurn(conversation){
  const lines=String(conversation||"").split(/\r?\n/);
  for(let i=lines.length-1;i>=0;i--){
    const line=lines[i].trim();
    const m=line.match(/^(?:使用者|user)\s*[：:]\s*(.*)$/i);
    if(m) return m[1].trim();
  }
  return String(conversation||"").trim();
}

function hasExplicitRequestBeyondInformationGap(source){
  const remainder=String(source||"")
    .replace(/沒(?:有)?告訴我/g,"")
    .replace(/還沒告訴我/g,"")
    .replace(/倒是沒(?:有)?告訴我/g,"")
    .replace(/你倒是沒(?:有)?說/g,"")
    .replace(/我還不知道/g,"")
    .replace(/尚未告訴/g,"")
    .replace(/未告訴/g,"");

  // Strong request evidence remains a request even when the same turn also
  // contains a missing-information statement.
  const strongRequest=/(請|麻煩|告訴我|跟我說|說一下|說給我聽|能不能|可不可以|可以告訴|可以說|快說|現在說|回答我|我想知道)/;
  if(strongRequest.test(remainder)) return true;

  // A wh-clause embedded inside a declarative gap statement is content of the
  // missing information, not by itself a request: e.g.
  // 「我記得你還沒告訴我那本書叫什麼名字。」
  // Keep an actual interrogative when the user marks it as a question.
  return /[？?]/.test(remainder) && /(是什麼|叫什麼|哪(?:個|一|裡|邊|家|本|種)?|誰|多少|幾)/.test(remainder);
}

function missingInformationBoundaryActive(conversation){
  const source=latestUserTurn(conversation).toLowerCase();
  const gapPattern=/(沒(?:有)?告訴我|還沒告訴我|你倒是沒(?:有)?說|倒是沒(?:有)?告訴我|我還不知道|我不知道[^。！？?\n]{0,80}(?:是什麼|叫什麼|什麼(?:口味|名字|名稱|顏色|內容|型號|時間|原因|地方|東西)?|哪(?:個|一|裡|邊|家|本|種)?|誰|多少|幾)|(?:是什麼|叫什麼|什麼(?:口味|名字|名稱|顏色|內容|型號|時間|原因|地方|東西)?|哪(?:個|一|裡|邊|家|本|種)?|誰|多少|幾)[^。！？?\n]{0,80}我(?:好像|似乎|可能)?(?:還)?(?:不知道|不清楚|不記得|忘了)|尚未告訴|未告訴)/;
  if(!gapPattern.test(source)) return false;
  return !hasExplicitRequestBeyondInformationGap(source);
}

function arbitrateReviewerWithHardGate(conversation, review){
  if(!missingInformationBoundaryActive(conversation) || review?.status!=="RETRY") return review;

  const source=latestUserTurn(conversation).toLowerCase();
  const explicitEmotion=/(我(?:很|真的|有點)?(?:生氣|不爽|不滿|煩|失望|不耐煩|好奇|想知道|著急)|氣死|火大|很煩|真煩|不爽|不滿|失望|不耐煩|好奇|想知道)/.test(source);

  const issues=Array.isArray(review.issues)?review.issues:[];
  const kept=issues.filter(issue=>{
    const field=String(issue?.field||"");
    const reason=String(issue?.reason||"");

    const leaf=field.split(".").pop();
    const requestBoundaryFields=new Set([
      "acts","implied_content","response_or_action_expected","uncertainties",
      "open_task","obligations","obligation_updates"
    ]);

    const requestInference=/(yes|maybe|expect|request|disclos|provide|告知|提供|期待|請求|明確要求|想知道|需要回覆|需要提供)/i.test(reason);
    if(requestBoundaryFields.has(leaf) && requestInference) return false;

    // Reviewer may not recreate an emotion solely because another candidate
    // field previously hallucinated that emotion. Require lexical evidence
    // from the latest user turn itself.
    if(!explicitEmotion && leaf==="user_state_or_attitude" &&
       /(不滿|失望|沮喪|不耐煩|抱怨|好奇|curious|annoy|dissatisf|impatient|frustrat|disappoint|acts.*情緒)/i.test(reason)) return false;

    if(!explicitEmotion && leaf==="acts" &&
       /(不滿|失望|沮喪|不耐煩|抱怨|好奇|curious|annoy|dissatisf|impatient|frustrat|disappoint)/i.test(reason)) return false;

    return true;
  });

  return kept.length ? {status:"RETRY",issues:kept} : {status:"PASS",issues:[]};
}

function controllerHardGate(conversation, semantic){
  const cc=semantic?.conversation_context||{};
  const mu=semantic?.message_understanding||{};
  const su=semantic?.state_updates||{};

  // Hard-gate the latest user turn only. Earlier turns are context, not the current act.
  const source=latestUserTurn(conversation).toLowerCase();

  // Detect an information-gap statement such as:
  // "你沒告訴我 X / X 你倒是沒說 / 我還不知道 X".
  const gapPattern=/(沒(?:有)?告訴我|還沒告訴我|你倒是沒(?:有)?說|倒是沒(?:有)?告訴我|我還不知道|我不知道[^。！？?\n]{0,80}(?:是什麼|叫什麼|什麼(?:口味|名字|名稱|顏色|內容|型號|時間|原因|地方|東西)?|哪(?:個|一|裡|邊|家|本|種)?|誰|多少|幾)|(?:是什麼|叫什麼|什麼(?:口味|名字|名稱|顏色|內容|型號|時間|原因|地方|東西)?|哪(?:個|一|裡|邊|家|本|種)?|誰|多少|幾)[^。！？?\n]{0,80}我(?:好像|似乎|可能)?(?:還)?(?:不知道|不清楚|不記得|忘了)|尚未告訴|未告訴)/;
  if(!gapPattern.test(source)) return {status:"PASS",reasons:[]};

  // Remove the gap wording itself before looking for a real request.
  // This avoids treating the words "告訴我" inside "你沒告訴我" as a request.
  if(hasExplicitRequestBeyondInformationGap(source)) return {status:"PASS",reasons:[]};

  const reasons=[];
  const acts=Array.isArray(mu.acts)?mu.acts:[];
  if(acts.some(x=>/(request|expect|demand|ask|索取|要求|期待)/i.test(String(x))))
    reasons.push("controller_hard_gate: 資訊缺失陳述沒有明確索取證據，acts 不得建立 request/expectation 類語意");

  const implied=Array.isArray(mu.implied_content)?mu.implied_content:[];
  if(implied.some(x=>/(期待|期望|希望|想要|想知道|需要|需補充|要求|索取|提供|告知.*需求|待.*告知|意圖)/.test(String(x))))
    reasons.push("controller_hard_gate: implied_content 不得把資訊缺失改寫成期待／希望／需要提供資訊或提供意圖");

  const uncertainties=Array.isArray(mu.uncertainties)?mu.uncertainties:[];
  if(uncertainties.some(x=>/(請求|期待|期望|希望|想要|需要|要求|索取|提供|告知|意圖)/.test(String(x))))
    reasons.push("controller_hard_gate: uncertainties 不得重新生成未明確的請求／期待／提供意圖");

  if(mu.response_or_action_expected!=="unknown")
    reasons.push("controller_hard_gate: 純資訊缺失陳述的 response_or_action_expected 必須為 unknown");

  if(cc.open_task!==null)
    reasons.push("controller_hard_gate: 純資訊缺失陳述不得建立 open_task");

  if(Array.isArray(cc.obligations) && cc.obligations.length)
    reasons.push("controller_hard_gate: 純資訊缺失陳述不得建立 obligations");

  if(su.open_task!=="none")
    reasons.push("controller_hard_gate: 純資訊缺失陳述不得 update/建立 task");

  if(Array.isArray(su.obligation_updates) && su.obligation_updates.length)
    reasons.push("controller_hard_gate: 純資訊缺失陳述不得新增 obligation_updates");

  return reasons.length ? {status:"RETRY",reasons} : {status:"PASS",reasons:[]};
}


function sanitizeMissingInformationSemantic(conversation, semantic){
  const x=JSON.parse(JSON.stringify(semantic||{}));
  const mu=x.message_understanding||{}, cc=x.conversation_context||{}, su=x.state_updates||{};
  const source=latestUserTurn(conversation).toLowerCase();

  const gap=/(沒(?:有)?告訴我|還沒告訴我|你倒是沒(?:有)?說|倒是沒(?:有)?告訴我|我還不知道|我不知道[^。！？?\n]{0,80}(?:是什麼|叫什麼|什麼(?:口味|名字|名稱|顏色|內容|型號|時間|原因|地方|東西)?|哪(?:個|一|裡|邊|家|本|種)?|誰|多少|幾)|(?:是什麼|叫什麼|什麼(?:口味|名字|名稱|顏色|內容|型號|時間|原因|地方|東西)?|哪(?:個|一|裡|邊|家|本|種)?|誰|多少|幾)[^。！？?\n]{0,80}我(?:好像|似乎|可能)?(?:還)?(?:不知道|不清楚|不記得|忘了)|尚未告訴|未告訴)/;
  if(!gap.test(source)) return x;

  if(hasExplicitRequestBeyondInformationGap(source)) return x;

  // Unified evidence boundary:
  // A bare information-gap statement does not itself prove a request,
  // response expectation, dissatisfaction, impatience, curiosity, or
  // relationship significance. These meanings require independent lexical
  // evidence in the latest user turn.
  const explicitEmotion=/(我(?:很|真的|有點)?(?:生氣|不爽|不滿|煩|失望|不耐煩|好奇|想知道|著急)|氣死|火大|很煩|真煩|不爽|不滿|失望|不耐煩|好奇|想知道)/.test(source);
  const explicitRelationship=/(我們(?:的)?關係|你跟我|我跟你|信任|親近|疏遠|承諾|我們之間|彼此)/.test(source);

  const requestLike=/(request|expect|demand|ask|索取|要求|期待)/i;
  const unsupportedEmotionAct=/(dissatisf|complain|annoy|impatient|frustrat|disappoint|curious|inquisit|不滿|抱怨|不耐煩|失望|好奇)/i;

  mu.acts=(Array.isArray(mu.acts)?mu.acts:[]).filter(v=>{
    const s=String(v);
    if(requestLike.test(s)) return false;
    if(!explicitEmotion && unsupportedEmotionAct.test(s)) return false;
    return true;
  });
  if(!mu.acts.length) mu.acts=["statement","note_missing_information"];

  mu.implied_content=(Array.isArray(mu.implied_content)?mu.implied_content:[])
    .filter(v=>!/(期待|期望|希望|想要|想知道|需要|需補充|要求|索取|提供|告知.*需求|待.*告知|意圖|request|expect|provide|disclos)/i.test(String(v)));

  if(!explicitEmotion){
    mu.user_state_or_attitude=(Array.isArray(mu.user_state_or_attitude)?mu.user_state_or_attitude:[])
      .filter(v=>!/(期待|期望|希望|想知道|curious|inquisit|impatient|annoy|dissatisf|frustrat|disappoint|不滿|抱怨|不耐煩|失望|好奇|expect)/i.test(String(v)));
  }

  if(!explicitRelationship) mu.relationship_relevance="low";
  if(cc.interaction_state==="probe") cc.interaction_state="ordinary";

  // Preserve the latest declarative gap statement as one whole explicit unit.
  // Do not let an embedded WH-clause (e.g. 「你點了什麼」) get detached and
  // reused as evidence that the user asked a standalone question.
  mu.explicit_content=[latestUserTurn(conversation)];

  mu.response_or_action_expected="unknown";

  mu.uncertainties=(Array.isArray(mu.uncertainties)?mu.uncertainties:[])
    .filter(v=>!/(請求|期待|期望|希望|想要|想知道|需要|要求|索取|提供|告知|意圖|request|expect|provide|disclos)/i.test(String(v)));

  cc.open_task=null;
  cc.obligations=[];
  su.open_task="none";
  su.obligation_updates=[];

  x.message_understanding=mu;
  x.conversation_context=cc;
  x.state_updates=su;
  return x;
}

function explicitContentCompletenessGate(conversation, semantic){
  const source=latestUserTurn(conversation).trim();
  const mu=semantic?.message_understanding||{};
  const explicit=Array.isArray(mu.explicit_content)?mu.explicit_content:[];

  // Narrow completeness guard only. Do not generate or rewrite semantic content.
  // Very short acknowledgements / reaction-only turns may legitimately carry no
  // explicit proposition, so they are excluded from this hard gate.
  const normalized=source
    .replace(/[\s，。！？!?、；;：:\-—…~～「」『』（）()【】\[\]"'`]/g,"")
    .toLowerCase();
  const reactionOnly=new Set([
    "嗯","恩","喔","哦","好","好的","對","是","嗯嗯","哈哈","呵呵",
    "ok","okay","lol","xd","qq"
  ]);
  const substantive=normalized.length>=3 && !reactionOnly.has(normalized);

  if(substantive && explicit.length===0){
    return {
      status:"RETRY",
      reasons:["controller_explicit_content_gate: 最新使用者訊息含有實質明說內容，但 explicit_content 為空；請重新判讀最新 turn，且不得由 controller 自行補寫內容"]
    };
  }
  return {status:"PASS",reasons:[]};
}

function applyControllerHardGate(conversation, semantic, validation){
  if(validation?.status==="RETRY") return validation;
  const clean=validation?.semantic||semantic;

  const explicitGate=explicitContentCompletenessGate(conversation,clean);
  if(explicitGate.status==="RETRY"){
    return {
      status:"RETRY",
      reasons:explicitGate.reasons,
      semantic:clean,
      controller_explicit_content_gate:"RETRY"
    };
  }

  const gate=controllerHardGate(conversation,clean);
  if(gate.status==="RETRY"){
    return {
      status:"RETRY",
      reasons:gate.reasons,
      semantic:clean,
      controller_hard_gate:"RETRY"
    };
  }
  return validation;
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
      let firstValidation=await validate(env,conversation,firstSemantic);
      firstValidation=applyControllerHardGate(conversation,firstSemantic,firstValidation);

      // Mechanical validator RETRY goes directly to the one allowed regeneration.
      if(firstValidation.status==="RETRY"){
        const reasons=firstValidation.reasons||[];
        const secondSemantic=await runNano(env,conversation,reasons); // API call #2
        const sanitizedSecondSemantic=sanitizeMissingInformationSemantic(conversation,secondSemantic);
        let secondValidation=await validate(env,conversation,sanitizedSecondSemantic);
        secondValidation=applyControllerHardGate(conversation,secondSemantic,secondValidation);

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
          let secondReview=await reviewSemantic(env,conversation,secondClean); // API call #3
          secondReview=arbitrateReviewerWithHardGate(conversation,secondReview);

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
      let firstReview=await reviewSemantic(env,conversation,firstClean);
      firstReview=arbitrateReviewerWithHardGate(conversation,firstReview);

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
      const sanitizedSecondSemantic=sanitizeMissingInformationSemantic(conversation,secondSemantic);
      let secondValidation=await validate(env,conversation,sanitizedSecondSemantic);
      secondValidation=applyControllerHardGate(conversation,secondSemantic,secondValidation);

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
