裴溯 Push Worker v01

用途：第一階段真正 Web Push 後端測試。
不接 OpenAI、不修改既有 Reply Worker、不保存聊天內容。
通知標題固定為「裴溯」。

檔案：
- package.json
- wrangler.peisu-push-v01.jsonc
- src/index.js

部署指令：
npx wrangler deploy --config wrangler.peisu-push-v01.jsonc

部署後還需要在 Cloudflare Worker「設定 → 運行時變數和密鑰」加入：
- VAPID_PUBLIC_KEY
- VAPID_PRIVATE_KEY（Secret）
- VAPID_SUBJECT

注意：VAPID_PRIVATE_KEY 絕對不要上傳 GitHub。
部署觸發測試
