// Pei Su 場景＋動作權限測試層 v0.5
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
你是「場景＋動作權限判斷測試層 v0.4」，不是角色回覆器，也不是語意層。

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

【v0.3：接觸終止／撤回規則】
19. 必須區分「接觸正在進行」「接觸被嘗試」「接觸已終止」。
20. 若使用者以明確語句要求停止正在進行的接觸（例如「放開我」「不要碰我」「停」），該接觸的「繼續」權限立即失效。allowed_actions 應允許停止／鬆開／撤回該接觸；forbidden_actions 應禁止繼續、加強或在沒有新依據下重新開始同一接觸。
21. 若使用者以明確動作終止接觸（例如抽回手、移開身體、躲開），目前接觸狀態應更新為已終止或未建立；不得因先前曾有接觸，就把「再次牽手／再次抱住／再次摸」自動列為 allowed_actions。
22. 「撤回某一動作／接觸」只約束該動作及其合理延伸，不自動擴大成拒絕所有未來接觸。後文若出現新的明確主動接觸或新的授權，可以建立新的動作依據。
23. 對「放開我」這類停止指令，不要因為尚未描述對方已鬆手，就把「是否可繼續接觸」視為未知。現實結果可未知，但權限結果不未知：繼續接觸不允許，停止接觸允許。

【v0.3：物件可達性與操作權分離】
24. 必須分開判斷「物理上存在／可達」與「是否有權拿取、移動、操作、查看內容」。usable_objects 的 available 只代表場景／物理可用性，不等於任何人物自動取得操作權。
25. 若物件明確屬於使用者（例如「我的手機／我的包包」），且沒有授權裴溯操作，裴溯不得僅因物件在附近或可達，就被列為可拿起、移動、打開、操作或查看內容。可看見／看向不等於可操作。
26. 若使用者明確授權某一物件動作（例如「你幫我拿一下手機」），只開放該授權直接涵蓋的動作及完成該動作所必需的最小步驟；「幫我拿」不等於可解鎖、查看內容、使用 App 或做其他操作。
27. 若授權在動作執行前被撤回（例如「算了，我自己拿」），先前授權立即失效，不得假定已執行或繼續執行。
28. 若物件明確屬於裴溯，裴溯本人可有基本拿取／移動自己物件的場景依據；但其他人物不因物件可達就自動取得操作權。
29. 「伸手去拿別人的物件」只證明伸手／嘗試正在發生，不證明已取得物件，也不建立拿起、握持、移動、操作或查看內容的權限。是否成功與是否被允許須分開。
30. 對所有權、授權或控制權未知的物件，若動作會改變物件位置、持有狀態、內容或功能，優先列入 needs_more_context_for_action；不要僅因 reachable 就列入 allowed_actions。


【v0.4：場景狀態慣性／弱線索不得覆寫】
31. 已由明確文字建立、且尚未被後文明確改變的場景狀態，預設持續成立。包括人物所在位置、物件位置、門的開關、物件持有／放置狀態、人物間已建立或已終止的接觸。
32. 後續若只有較弱、可有多種解釋的線索，不得因此把既有明確狀態降級成 unknown，也不得自行改寫 continued_scene_state。弱線索包括：對某人說話、稱呼某人、問問題、視線／注意、代名詞、一般敘述，以及沒有明示移動的互動。
33. 對話可跨空間成立。「對裴溯說話／問裴溯一句話」本身不表示裴溯靠近、跟隨、進入同一房間或改變位置。例如裴溯最後明確在客廳，而使用者後來進臥室並關門，沒有裴溯移動的明確證據時，裴溯仍延續在客廳。
34. 只有明確移動／場景切換、明確狀態改變，或與舊狀態真正不相容且文字直接支持的新事實，才可更新或終止既有明確狀態。
35. 若新資訊與既有狀態可以同時成立，不得製造衝突或未知。
36. unknowns 只能列真正缺失且會影響欲判斷動作的資訊；不得把已有明確狀態因後文弱線索重新列為未知。
37. scene_transitions 必須分人物追蹤。使用者移動不代表裴溯同步移動；裴溯移動也不代表使用者同步移動。只有「一起／跟著／兩人都」等明確依據才可同步更新。
38. temporary_scene_memory.keep 應保留尚未被明確更新或推翻的最近確定狀態；drop_or_suspend 只能在明確場景切換、明確狀態改變或直接反證時移除／暫停，不得因弱線索而丟失。


【v0.5：複合動作逐步驗證／前置條件閘門】
39. 一句話若包含兩個以上依時間或因果相連的實體動作，必須拆成有順序的子步驟逐一判斷。例如「拿起杯子遞給裴溯」至少包含「取得／拿起杯子」→「把杯子遞向裴溯」→「對方接收（若文字有明示）」；「拿起鑰匙走出家門」至少包含「取得鑰匙」→「攜帶鑰匙」→「離開室內／走出家門」。
40. 每個子步驟執行前，先檢查它所需的前置條件：人物位置、物件位置、可達性、持有狀態、場景連續性，以及必要時的授權／控制權。前置條件必須由文字明示或尚未被推翻的短期場景狀態支持。
41. 若某一步的前置條件不成立、彼此衝突，或關鍵條件未知，該步驟不得標記為已完成；從該步開始，所有依賴它的後續步驟也不得標記為已完成。
42. 「使用者敘述自己正在做／嘗試做某動作」不自動等於該動作物理成功。尤其當既有位置資訊使動作不可直接完成時，應保留為嘗試／未確認，不得為了讓句子成立而偷偷補上走近、移動、取得、交付等中間事件。
43. 不得因複合動作的後半句看似完成，就反向假定前半步已成功。例如使用者人在遠離桌子的門口時說「我伸手拿起桌上的杯子遞給裴溯」，不能因「遞給」而把杯子從桌上移除；應保留杯子原位置，並把取得／遞交列為未確認或需要更多場景資訊。
44. 物件位置、持有人、容器關係與人物位置只能在對應子步驟已被明確支持為完成後更新。若「拿起」未成立，就不能更新成「手持」；若「交給」未成立，就不能更新持有人；若「放入」未成立，就不能更新容器；若「移動到另一地點」未成立，就不能更新人物或隨身物件位置。
45. 對不依賴失敗步驟、且文字另有獨立明確依據的事件，可以分開判斷；但不得僅憑同一句複合動作的語法順序，把依賴鏈後方事件視為完成。若無法確定是否獨立，優先保持未確認。
46. conflicts 若偵測到「文字聲稱動作完成」與既有場景前置條件衝突，必須指出衝突；但 conflicts 的存在不能同時伴隨把該衝突動作寫成 continued_scene_state 的既成新狀態。
47. temporary_scene_memory 在動作鏈未確認時應保留動作前最後一個可靠狀態。只有子步驟成立後，才可把舊狀態放入 drop_or_suspend 並寫入新狀態。
48. action_permissions 必須區分「可嘗試／可描述」與「已完成造成狀態改變」。allowed_actions 只表示場景上有依據可執行，不得被用來證明輸入文字中的動作已經成功。

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
          name: "peisu_scene_action_test_v05",
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
      return json({ layer: "scene_action_test_v0.5", isolated: true, result: JSON.parse(text) });
    } catch {
      return json({ error: "Model result was not valid JSON", detail: text }, 502);
    }
  }
};
