const OPENAI_URL = "https://api.openai.com/v1/responses";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Content-Type": "application/json; charset=utf-8"
};

function json(data, status = 200) {
  return new Response(JSON.stringify(data, null, 2), { status, headers: corsHeaders });
}

async function readJsonResponse(response, label) {
  const text = await response.text();
  let data;
  try { data = JSON.parse(text); }
  catch { throw new Error(`${label} 非 JSON：${text.slice(0, 500)}`); }
  if (!response.ok) {
    throw new Error(`${label} HTTP ${response.status}：${JSON.stringify(data).slice(0, 800)}`);
  }
  return data;
}

async function callBoundWorker(binding, conversation, label) {
  if (!binding || typeof binding.fetch !== "function") {
    throw new Error(`${label} Service Binding 未設定`);
  }
  const response = await binding.fetch("https://internal/", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ conversation })
  });
  return readJsonResponse(response, label);
}

function extractOutputText(data) {
  if (typeof data?.output_text === "string" && data.output_text.trim()) return data.output_text.trim();
  for (const item of data?.output || []) {
    for (const content of item?.content || []) {
      if (content?.type === "output_text" && typeof content?.text === "string") return content.text.trim();
    }
  }
  return "";
}

function extractStructured(data) {
  const text = extractOutputText(data);
  if (!text) throw new Error("OpenAI 回覆沒有 output_text");
  try { return JSON.parse(text); }
  catch { throw new Error(`OpenAI structured output 非 JSON：${text.slice(0, 800)}`); }
}

const replySchema = {
  type: "object",
  additionalProperties: false,
  required: ["mode", "text", "reason_tag", "action"],
  properties: {
    mode: { type: "string", enum: ["speak", "silent"] },
    text: { type: "string" },
    reason_tag: {
      type: "string",
      enum: [
        "direct_reply", "brief_acknowledgement", "boundary_respected",
        "topic_shift", "analysis", "warning_or_stop", "conditional_request",
        "observe_only", "no_reply_needed"
      ]
    },
    action: {
      type: "object",
      additionalProperties: false,
      required: ["type", "description"],
      properties: {
        type: { type: "string", enum: ["none", "physical_action"] },
        description: { type: "string" }
      }
    }
  }
};

function buildSystemPrompt(semanticPipeline, sceneAction) {
  return `你正在生成電視劇版裴溯的下一個回覆。已驗證 Semantic 與 Scene/Action 是事實與權限邊界，不是靈感素材。

【裴溯固定核心】
- 以電視劇版裴溯為準，不用原著小說補空白。
- 不要變成甜寵男友、霸總、持續毒舌、心理諮商師、客服或萬能照顧者。
- 日常回覆通常簡短；可以沉默。
- 不讀心；不推測未明說的性別、年齡、職業、身分、心理需求、關係含義。
- 疲累、煩躁、不舒服、不想睡等，不自動轉成安慰、建議、照顧或睡覺提醒。
- 不機械複誦，也不要一直使用同一個短句。
- 局部拒絕不是全域拒絕；取消後有替代要求時，以最新要求為準。
- 不假裝能背景監控、排程、通知或執行系統沒有提供的能力。

【動作硬限制 — 必須遵守】
1. Scene/Action 中的 needs_more_context_for_action、needs_more_context、forbidden_actions、forbidden 或任何等義欄位，全部視為「不可在本次回覆中完成或新增」。
2. 只有 Scene/Action 明確列為現在可執行的 allowed action，才可以輸出 physical_action。若沒有明確 allowed action，action 必須是 none。
3. 「合理」「自然」「順手」「符合人物」都不是動作授權。
4. 已發生的動作只能維持其已確認完成度，不可自動推進下一步。
   例如：伸手 ≠ 碰到 ≠ 握住 ≠ 拿起 ≠ 搬運 ≠ 遞出 ≠ 對方接到。
5. 「維持原狀」「沒有躲開」「沒有繼續」不是新 physical_action。若只是保持既有狀態，action 必須是 none；不可改寫成放鬆肩膀、靠後、調整角度、收手等新動作。
6. 使用者取消要求後，不得繼續原要求；但也不得自行新增「收回手、放下、退開」等後續動作，除非 Scene/Action 明確授權。
7. unknown 永遠不可補成 known。不得新增物件位置、移動、接觸、持有、所有權、成功抓取、成功交付、第三方狀態。
8. 若 Scene/Action 對動作是否已完成有不確定性，選 action none，不要替場景補完。
9. 台詞不得用未被 Semantic 或對話支持的「內在動機」解釋行為。不要自行補「怕你晃到」「擔心你」「想讓你舒服」「故意逗你」等理由。若原因未知，就保持未知。
10. 即使 Scene/Action 有 allowed action，也只有在當下對話確實需要裴溯做那個動作時才執行；否則 action none。
11. physical_action 的 description 只能描述被明確授權的那一步，不得夾帶下一步或目的性結果。

【輸出校驗】
輸出前逐項自查：
- 這個 physical_action 是否在 Scene/Action 中被明確允許？不是 → action none。
- 是否把嘗試寫成成功？是 → action none。
- 是否新增了保持原狀以外的身體變化？是 → action none。
- 是否替裴溯補了文本沒有支持的動機？是 → 刪除該動機。
- 是否把 unknown 寫成 fact？是 → 改回未知或不提。

已驗證 Semantic pipeline：
${JSON.stringify(semanticPipeline)}

Scene / Action：
${JSON.stringify(sceneAction)}

輸出必須符合指定 JSON schema。`;
}

export default {
  async fetch(request, env) {
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders });
    if (request.method !== "POST") return json({ error: "POST only" }, 405);

    try {
      const body = await request.json();
      const conversation = body?.conversation;
      if (!conversation || (typeof conversation !== "string" && !Array.isArray(conversation))) {
        return json({ error: "conversation required" }, 400);
      }

      const [semanticPipeline, sceneAction] = await Promise.all([
        callBoundWorker(env.SEMANTIC_RETRY, conversation, "Semantic RETRY"),
        callBoundWorker(env.SCENE_ACTION, conversation, "Scene/Action v0.5")
      ]);

      if (semanticPipeline?.status !== "completed") {
        throw new Error(`Semantic RETRY 未完成：${JSON.stringify(semanticPipeline).slice(0, 1000)}`);
      }
      if (!env.OPENAI_API_KEY) throw new Error("OPENAI_API_KEY 未設定");

      const model = env.PEISU_REPLY_MODEL || "gpt-5";
      const openaiResponse = await fetch(OPENAI_URL, {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${env.OPENAI_API_KEY}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          model,
          instructions: buildSystemPrompt(semanticPipeline, sceneAction),
          input: typeof conversation === "string" ? conversation : JSON.stringify(conversation),
          text: {
            format: {
              type: "json_schema",
              name: "pei_su_integrated_reply",
              strict: true,
              schema: replySchema
            }
          }
        })
      });

      const openaiData = await readJsonResponse(openaiResponse, "OpenAI");
      const reply = extractStructured(openaiData);

      if (reply.mode === "silent") reply.text = "";
      if (reply.action?.type === "none") reply.action.description = "";

      return json({
        status: "completed",
        layer: "peisu_integrated_reply_test_v0.3_action_guard",
        semantic_pipeline: {
          attempts: semanticPipeline?.attempts,
          api_calls: semanticPipeline?.api_calls,
          reviewer_used: semanticPipeline?.reviewer_used,
          fidelity_review: semanticPipeline?.fidelity_review,
          final_validation: semanticPipeline?.final_validation,
          semantic: semanticPipeline?.semantic
        },
        scene_action: sceneAction,
        integrated_reply: { model, reply }
      });
    } catch (error) {
      return json({
        error: "integrated_reply_test_failure",
        message: String(error?.message || error)
      }, 500);
    }
  }
};
