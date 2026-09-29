裴溯 A-v01 情境追蹤判斷測試
- 獨立 Worker：peisu-followup-a-v01
- 只透過 Service Binding 呼叫既有 peisu-semantic-v07
- 每按一次測試，只產生既有 Semantic 的一次 API 請求
- 不會發 Push
- 不會生成裴溯追蹤台詞
- 不會修改正式 PWA / Reply / Scene / Push v04
- 不需要在這個新 Worker 再放 OPENAI_API_KEY
