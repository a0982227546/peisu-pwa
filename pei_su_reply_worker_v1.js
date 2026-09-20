// Pei Su reply layer v1 — isolated test
// Input: { conversation, semantic }
// Output: { mode:"speak"|"silent", text, reason_tag }
// Required secret: OPENAI_API_KEY
// Optional var: PEISU_REPLY_MODEL (default: gpt-5; can be changed without rewriting this Worker)

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Allow-Methods": "POST,OPTIONS"
};

const replySchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    mode: { type: "string", enum: ["speak","silent"] },
    text: { type: "string" },
    reason_tag: {
      type: "string",
      enum: [
        "direct_reply",
        "brief_acknowledgement",
        "boundary_respected",
        "topic_shift",
        "analysis",
        "warning_or_stop",
        "conditional_request",
        "observe_only",
        "no_reply_needed"
      ]
    }
  },
  required: ["mode","text","reason_tag"]
};

const SYSTEM = `你是《光·淵》電視劇版「裴溯」的回覆生成層。
你不是語意分析器、客服、心理諮商師，也不是旁白。你只決定裴溯此刻是否開口，以及若開口，他實際會說什麼。

【來源與角色邊界】
1. 只使用電視劇版裴溯的角色方向；不要拿原著《默讀》的設定補空缺。
2. 不把裴溯寫成甜寵男友、霸總、全程毒舌、心理諮商師或萬能照護者。
3. 不為了「像角色」硬塞金句、文學腔、案件式分析或刻薄話。
4. 不讀心。semantic 中 unknown / uncertainties 仍然是未知，不能自行補答案。
5. 不推斷未明說的性別、年齡、職業、身份、心理需求或關係意義。

【回覆習慣】
6. 日常通常短；只有真的需要分析時才拉長。
7. 他可以觀察到事情但不一定說破；也允許不回覆。
8. 使用者明確設下的界線只作用在那個範圍，不得擴張。
9. 使用者拒絕安慰，不等於拒絕所有互動；不要套「尊重你的感受／如果你需要我可以……」之類客服模板。
10. 使用者要求換話題，就換話題，不追問被拒絕的內容。
11. 遇到取消→替代的新要求，要依最新要求理解，不把已取消內容復活。
12. 條件式要求可以理解，但不要假裝自己已具備背景監控、在線偵測、排程或通知能力。
13. 危險或需要制止時可以直接；一般情緒不自動升級成危機。
14. 關係親近也不自動高甜、黏人或過度安撫。
15. 若 mode="silent"，text 必須是空字串。
16. 若 mode="speak"，text 只能是裴溯真正會發出的訊息，不要附分析、括號說明、角色名或引號。
17. 使用者只是陳述「累、煩、不想睡、腳痠、不舒服」等狀態時，不要自動切換成照護模式。除非使用者明確要求建議，否則不要主動安排散步、喝水、休息、睡覺、定時間、呼吸、轉移注意力等行動。
18. 不要因為想顯得關心而替使用者規劃下一步，也不要在沒有必要時用「先……再……」「去……」「給自己……」「到了就……」這類指令式照護句型。
19. 日常狀態陳述優先考慮：短回應、就事回應、帶一點裴溯自己的觀察，或乾脆不說；不要把每次情緒／疲累陳述都轉成解決問題。
20. 除非原始對話本身要求繼續話題或需要取得資訊，否則不要習慣性在句尾加問題來延長對話。
21. 關心可以存在，但應藏在裴溯的措辭、注意力與分寸裡，不要變成通用的健康建議、陪伴話術或照顧清單。
22. 對「累但還不想睡」這類沒有明確求助的日常陳述，不得自行推導成「需要清醒」「需要低耗能活動」「需要陪聊」「需要被安慰」；semantic 若沒有明確支持，就維持未知。

【使用 semantic 的方式】
semantic 是已通過前置理解／驗證的資料。把 explicit_content、界線、取消／替代關係當成主要依據。
implied_content 只能作為次要參考，不能把它再擴張一層。
不要把 obligations 當成系統技術能力證明。
不要在回覆中提到 semantic、Validator、Reviewer、模型或規則。`;

async function callReply(env, conversation, semantic) {
  const model = env.PEISU_REPLY_MODEL || "gpt-5";
  const body = {
    model,
    input: [
      { role: "system", content: [{ type: "input_text", text: SYSTEM }] },
      { role: "user", content: [{
        type: "input_text",
        text:
`原始對話：
${conversation}

已驗證 semantic：
${JSON.stringify(semantic, null, 2)}

只輸出符合 schema 的裴溯回覆決策。`
      }] }
    ],
    text: {
      format: {
        type: "json_schema",
        name: "pei_su_reply_v1",
        strict: true,
        schema: replySchema
      }
    }
  };

  const r = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${env.OPENAI_API_KEY}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(body)
  });

  const raw = await r.text();
  if (!r.ok) {
    throw new Error(`OpenAI ${r.status}: ${raw.slice(0,800)}`);
  }

  const data = JSON.parse(raw);
  let txt = data.output_text;
  if (!txt && Array.isArray(data.output)) {
    for (const item of data.output) {
      for (const part of (item.content || [])) {
        if (part.type === "output_text" && part.text) txt = part.text;
      }
    }
  }
  if (!txt) throw new Error("No structured reply returned.");
  return { model, reply: JSON.parse(txt) };
}

export default {
  async fetch(request, env) {
    if (request.method === "OPTIONS") return new Response(null,{headers:cors});
    if (request.method !== "POST") {
      return Response.json({error:"POST only"},{status:405,headers:cors});
    }

    try {
      const body = await request.json();
      const conversation = String(body?.conversation || "").trim();
      const semantic = body?.semantic;

      if (!conversation) {
        return Response.json({error:"conversation required"},{status:400,headers:cors});
      }
      if (!semantic || typeof semantic !== "object") {
        return Response.json({error:"semantic object required"},{status:400,headers:cors});
      }

      const result = await callReply(env, conversation, semantic);

      // Final mechanical safety: silent never leaks text.
      if (result.reply.mode === "silent") result.reply.text = "";

      return Response.json({
        status: "completed",
        model: result.model,
        reply: result.reply
      },{headers:cors});
    } catch (e) {
      return Response.json({
        error:"reply_layer_failure",
        message:String(e?.message || e)
      },{status:500,headers:cors});
    }
  }
};
