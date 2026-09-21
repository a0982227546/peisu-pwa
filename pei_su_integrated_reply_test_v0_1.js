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
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error(`${label} 非 JSON：${text.slice(0, 500)}`);
  }
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
  if (typeof data?.output_text === "string" && data.output_text.trim()) {
    return data.output_text.trim();
  }
  for (const item of data?.output || []) {
    for (const content of item?.content || []) {
      if (content?.type === "output_text" && typeof content?.text === "string") {
        return content.text.trim();
      }
    }
  }
  return "";
}

function extractStructured(data) {
  const text = extractOutputText(data);
  if (!text) throw new Error("OpenAI 回覆沒有 output_text");
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`OpenAI structured output 非 JSON：${text.slice(0, 800)}`);
  }
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
  return `你正在生成電視劇版裴溯的下一個回覆。只使用下方已驗證語意與場景/動作結果作為事實依據。

固定原則：
- 以電視劇版裴溯為準，不用原著小說補空白。
- 不要變成甜寵男友、霸總、持續毒舌、心理諮商師、客服或萬能照顧者。
- 不讀心；不推測未明說的性別、年齡、職業、身分、心理需求或關係含義。
- 日常回覆通常簡短；可以不說話。
- 疲累、煩躁、不舒服、不想睡等，不自動轉成安慰、建議、照顧或睡覺提醒。
- 不要機械複誦使用者，也不要一直使用同一個短句。
- 局部拒絕不是全域拒絕。取消後又提出替代要求時，以最新要求為準。
- 不假裝能在背景監控使用者是否在線、排程、通知或執行系統沒有提供的能力。
- 場景/動作結果限制所有實體動作。
- 只有 scene/action 明確支持 allowed action，且不需要更多情境時，才可輸出 physical_action。
- forbidden action 絕對不能做。
- unknown 不可寫成 known；不得自行新增物件、位置、移動、接觸、持有、所有權或第三方狀態。
- 即使某動作 technically allowed，如果對話沒有理由做，也維持 action none。
- 台詞與動作分開。

已驗證 Semantic pipeline：
${JSON.stringify(semanticPipeline)}

Scene / Action：
${JSON.stringify(sceneAction)}

輸出必須符合指定 JSON schema。`;
}

export default {
  async fetch(request, env) {
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders });
    }
    if (request.method !== "POST") {
      return json({ error: "POST only" }, 405);
    }

    try {
      const body = await request.json();
      const conversation = body?.conversation;
      if (!conversation || (typeof conversation !== "string" && !Array.isArray(conversation))) {
        return json({ error: "conversation required" }, 400);
      }

      // v0.2: call both existing Workers through Cloudflare Service Bindings.
      const [semanticPipeline, sceneAction] = await Promise.all([
        callBoundWorker(env.SEMANTIC_RETRY, conversation, "Semantic RETRY"),
        callBoundWorker(env.SCENE_ACTION, conversation, "Scene/Action v0.5")
      ]);

      if (semanticPipeline?.status !== "completed") {
        throw new Error(`Semantic RETRY 未完成：${JSON.stringify(semanticPipeline).slice(0, 1000)}`);
      }

      if (!env.OPENAI_API_KEY) {
        throw new Error("OPENAI_API_KEY 未設定");
      }

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
        layer: "peisu_integrated_reply_test_v0.2",
        semantic_pipeline: {
          attempts: semanticPipeline?.attempts,
          api_calls: semanticPipeline?.api_calls,
          reviewer_used: semanticPipeline?.reviewer_used,
          fidelity_review: semanticPipeline?.fidelity_review,
          final_validation: semanticPipeline?.final_validation,
          semantic: semanticPipeline?.semantic
        },
        scene_action: sceneAction,
        integrated_reply: {
          model,
          reply
        }
      });
    } catch (error) {
      return json({
        error: "integrated_reply_test_failure",
        message: String(error?.message || error)
      }, 500);
    }
  }
};
