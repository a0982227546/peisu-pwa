// Pei Su 場景＋動作判斷測試層 v0.1
// 獨立測試用途：不修改既有 semantic / validator / reviewer / reply v1.2。
// POST: { conversation: string, semantic?: object }
// 需要：OPENAI_API_KEY
// 可選：PEISU_SCENE_MODEL

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const SYSTEM = `
你是「場景＋動作判斷測試層」，不是最終角色回覆器。

目的：
在不改寫既有語意判斷的前提下，分析一段聊天中，角色裴溯若要自然反應，
哪些場景是使用者明確提供的、哪些只是未知、哪些只能作為當次互動的低風險臨時補全。

硬規則：
1. 不推測使用者性別、年齡、職業、身份等未明說個人資料。
2. 「談到工作」不等於「現在在公司」；過去事件不等於目前場景。
3. explicit_scene_facts 只能放文字直接支持的當前場景事實。
4. 不把臨時補全寫成使用者事實或長期記憶。
5. proposed_assumptions 只能是為了當次自然互動所需的低風險假設，並逐項說明。
6. 若候選動作與已知事實衝突，標記 conflict，不要硬拗。
7. 不因新增動作功能而改變既有 semantic 的 user_state、relationship、needs、risk 等判斷。
8. 不把「不用安慰」自動解讀成「完全不要反應」。
9. 不強迫角色每次說話。可選：speak、action、action_and_speak、silent。
10. 不要把每一句都寫成小說。動作應短、自然、必要時才出現。
11. 若資訊不足，不必為了填滿欄位而猜。
12. 這只是測試分析；不要聲稱角色真的能在現實世界遞水、披外套或感知使用者所在位置。

請輸出 JSON，格式：
{
  "explicit_scene_facts": ["..."],
  "unknowns": ["..."],
  "candidate_reaction_mode": "speak|action|action_and_speak|silent",
  "candidate_action": "若無則空字串",
  "candidate_speech": "若無則空字串",
  "proposed_assumptions": [
    {"assumption":"...", "level":"low|medium|high", "reason":"..."}
  ],
  "conflicts": ["..."],
  "memory_write": {
    "allowed": ["只列使用者明確提供、適合暫存的場景事實"],
    "forbidden": ["列出本次不得存成事實的補全"]
  },
  "why": "簡短說明判斷"
}

角色風格只做最低限度控制：
- 不自動進入安慰、照護、教練或客服模式。
- 可以用很少的話、沉默或動作。
- 不要使用二選一客服式問句。
- 此層不是最終裴溯人格定稿；重點是測試場景與動作邏輯。
`;

function json(data, status = 200) {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", ...CORS },
  });
}

function extractText(data) {
  if (typeof data?.output_text === "string" && data.output_text.trim()) return data.output_text.trim();
  const parts = [];
  for (const item of data?.output || []) {
    for (const c of item?.content || []) {
      if (typeof c?.text === "string") parts.push(c.text);
    }
  }
  return parts.join("").trim();
}

export default {
  async fetch(request, env) {
    if (request.method === "OPTIONS") return new Response(null, { headers: CORS });
    if (request.method !== "POST") return json({ error: "POST only" }, 405);

    if (!env.OPENAI_API_KEY) {
      return json({ error: "OPENAI_API_KEY is missing" }, 500);
    }

    let body;
    try { body = await request.json(); }
    catch { return json({ error: "Invalid JSON body" }, 400); }

    const conversation = typeof body?.conversation === "string" ? body.conversation.trim() : "";
    if (!conversation) return json({ error: "conversation is required" }, 400);

    const semantic = body?.semantic && typeof body.semantic === "object" ? body.semantic : null;

    const input = [
      "【原始對話】",
      conversation,
      semantic ? "\n【既有 semantic（只可參考，不得擅自改寫）】\n" + JSON.stringify(semantic) : ""
    ].join("\n");

    const payload = {
      model: env.PEISU_SCENE_MODEL || "gpt-5-mini",
      input: [
        { role: "system", content: SYSTEM },
        { role: "user", content: input }
      ],
      text: {
        format: {
          type: "json_schema",
          name: "peisu_scene_action_test",
          strict: true,
          schema: {
            type: "object",
            additionalProperties: false,
            properties: {
              explicit_scene_facts: { type: "array", items: { type: "string" } },
              unknowns: { type: "array", items: { type: "string" } },
              candidate_reaction_mode: {
                type: "string",
                enum: ["speak", "action", "action_and_speak", "silent"]
              },
              candidate_action: { type: "string" },
              candidate_speech: { type: "string" },
              proposed_assumptions: {
                type: "array",
                items: {
                  type: "object",
                  additionalProperties: false,
                  properties: {
                    assumption: { type: "string" },
                    level: { type: "string", enum: ["low", "medium", "high"] },
                    reason: { type: "string" }
                  },
                  required: ["assumption", "level", "reason"]
                }
              },
              conflicts: { type: "array", items: { type: "string" } },
              memory_write: {
                type: "object",
                additionalProperties: false,
                properties: {
                  allowed: { type: "array", items: { type: "string" } },
                  forbidden: { type: "array", items: { type: "string" } }
                },
                required: ["allowed", "forbidden"]
              },
              why: { type: "string" }
            },
            required: [
              "explicit_scene_facts", "unknowns", "candidate_reaction_mode",
              "candidate_action", "candidate_speech", "proposed_assumptions",
              "conflicts", "memory_write", "why"
            ]
          }
        }
      }
    };

    let r;
    try {
      r = await fetch("https://api.openai.com/v1/responses", {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${env.OPENAI_API_KEY}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify(payload)
      });
    } catch (e) {
      return json({ error: "OpenAI request failed", detail: String(e) }, 502);
    }

    const raw = await r.text();
    if (!r.ok) return json({ error: "OpenAI error", status: r.status, detail: raw }, 502);

    let data;
    try { data = JSON.parse(raw); }
    catch { return json({ error: "OpenAI returned non-JSON envelope", detail: raw }, 502); }

    const text = extractText(data);
    try {
      return json({
        layer: "scene_action_test_v0.1",
        isolated: true,
        result: JSON.parse(text)
      });
    } catch {
      return json({ error: "Model result was not valid JSON", detail: text }, 502);
    }
  }
};
