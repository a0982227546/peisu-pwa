// Pei Su 場景＋動作權限測試層 v0.2
// 獨立測試用途：不修改既有 Semantic / Validator / Reviewer / Reply v1.2。
// POST: { conversation: string, semantic?: object }
// 需要：OPENAI_API_KEY
// 可選：PEISU_SCENE_MODEL

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const SYSTEM = `
你是「場景＋動作權限判斷測試層 v0.2」，不是角色回覆器，也不是語意層。

唯一目的：
從原始對話建立「當次／短期場景狀態」，判斷哪些場景與物件可合理延續，
以及哪些實體動作有足夠場景依據。你不決定裴溯要不要關心、要不要說話、說什麼或用什麼語氣。

硬規則：
1. 不推測使用者性別、年齡、職業、身份、健康狀況等未明說個人資料。
2. 「談到工作」不等於「現在在公司」；過去事件不等於目前場景。
3. explicit_scene_facts 只列文字直接支持的場景／狀態事實。
4. 短期場景可以延續：剛建立且後文沒有推翻的地點、物件位置、物件隨身狀態，可以列入 continued_scene_state。
5. 短期延續不是長期記憶。不得因「常見」「通常」「可能」就把毯子、外套、熱水、暖氣、暖暖包等物件創造成存在事實。
6. 場景切換必須被辨識。出門、回家、到達另一地點、離開某處等訊號，會使先前空間中的物件不再自動可操作，除非文字明確表示物件跟著移動。
7. 「有帶外套」可支持外套跟著使用者進入新場景，但不能自行判定外套穿在身上、拿在手上或放在包裡。
8. 可用物件 usable_objects 只能來自：
   a. 使用者明確說目前存在／攜帶／放置的物件；
   b. 短期場景中合理延續、且沒有被後文推翻的物件。
9. 不因場景中常見某物就列為 usable_objects。
10. action_permissions 只判斷「若 Reply 層想生成某類實體動作，場景上是否允許」，不代表角色一定要做。
11. allowed_actions 必須有明確或短期延續的場景依據；forbidden_actions 列出會憑空創造物件、跨越已切換場景、或依賴未確認資訊的動作類型。
12. needs_more_context_for_action 列出只有在缺少關鍵資訊時才無法判斷的動作，不要把所有生活細節都列成未知。
13. 不產生 candidate_speech，不寫建議，不安慰，不問「要不要」，不寫任何裴溯台詞。
14. 不決定 speak / silent / action / action_and_speak。這些屬於 Reply 層。
15. 不改寫既有 semantic 的 user_state、relationship、needs、risk、intent 等判斷。
16. 不把本層推論寫成使用者長期事實。
17. 不聲稱角色真的能在現實世界遞水、披外套或感知位置；這只是虛構互動的場景一致性判斷。
18. 資訊不足時保持未知，但不要過度失憶：同一段連續敘述中，沒有場景切換或反證時，最近建立的場景可暫時延續。

請輸出 JSON：
{
  "explicit_scene_facts": ["文字直接支持的場景事實"],
  "continued_scene_state": ["由短期連續上下文合理延續、但不是長期記憶的狀態"],
  "scene_transitions": ["偵測到的場景切換；沒有則空陣列"],
  "usable_objects": [
    {
      "object": "物件",
      "status": "explicit|continued",
      "availability": "available|present_but_exact_position_unknown",
      "basis": "為何可在當前場景使用"
    }
  ],
  "unknowns": ["真正會影響場景／動作判斷的未知資訊"],
  "action_permissions": {
    "allowed_actions": ["有足夠場景依據的動作類型；不代表一定執行"],
    "needs_more_context_for_action": ["需更多資訊才可成立的動作類型"],
    "forbidden_actions": ["目前會憑空補物件、跨場景或依賴未確認資訊的動作類型"]
  },
  "temporary_scene_memory": {
    "keep": ["本段對話可暫時保留的場景狀態"],
    "drop_or_suspend": ["因場景切換或反證而應停止自動沿用的狀態"]
  },
  "long_term_memory": {
    "allowed": [],
    "forbidden": ["不得把本層臨時場景推論寫成長期使用者事實"]
  },
  "conflicts": ["若有前後衝突則列出"],
  "why": "只說明場景與動作權限判斷，不提供建議或角色台詞"
}
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
    if (!env.OPENAI_API_KEY) return json({ error: "OPENAI_API_KEY is missing" }, 500);

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
          name: "peisu_scene_action_test_v02",
          strict: true,
          schema: {
            type: "object",
            additionalProperties: false,
            properties: {
              explicit_scene_facts: { type: "array", items: { type: "string" } },
              continued_scene_state: { type: "array", items: { type: "string" } },
              scene_transitions: { type: "array", items: { type: "string" } },
              usable_objects: {
                type: "array",
                items: {
                  type: "object",
                  additionalProperties: false,
                  properties: {
                    object: { type: "string" },
                    status: { type: "string", enum: ["explicit", "continued"] },
                    availability: { type: "string", enum: ["available", "present_but_exact_position_unknown"] },
                    basis: { type: "string" }
                  },
                  required: ["object", "status", "availability", "basis"]
                }
              },
              unknowns: { type: "array", items: { type: "string" } },
              action_permissions: {
                type: "object",
                additionalProperties: false,
                properties: {
                  allowed_actions: { type: "array", items: { type: "string" } },
                  needs_more_context_for_action: { type: "array", items: { type: "string" } },
                  forbidden_actions: { type: "array", items: { type: "string" } }
                },
                required: ["allowed_actions", "needs_more_context_for_action", "forbidden_actions"]
              },
              temporary_scene_memory: {
                type: "object",
                additionalProperties: false,
                properties: {
                  keep: { type: "array", items: { type: "string" } },
                  drop_or_suspend: { type: "array", items: { type: "string" } }
                },
                required: ["keep", "drop_or_suspend"]
              },
              long_term_memory: {
                type: "object",
                additionalProperties: false,
                properties: {
                  allowed: { type: "array", items: { type: "string" } },
                  forbidden: { type: "array", items: { type: "string" } }
                },
                required: ["allowed", "forbidden"]
              },
              conflicts: { type: "array", items: { type: "string" } },
              why: { type: "string" }
            },
            required: [
              "explicit_scene_facts", "continued_scene_state", "scene_transitions",
              "usable_objects", "unknowns", "action_permissions",
              "temporary_scene_memory", "long_term_memory", "conflicts", "why"
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
      return json({ layer: "scene_action_test_v0.2", isolated: true, result: JSON.parse(text) });
    } catch {
      return json({ error: "Model result was not valid JSON", detail: text }, 502);
    }
  }
};
