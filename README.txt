裴溯 PWA｜AI 語意理解測試 v0.7

這一包是目前階段可部署的 PWA 測試頁：
- index.html：已確認的 LINE 泡泡排版 + AI 語意理解驗證頁
- manifest.webmanifest：PWA 安裝資訊
- sw.js：基本離線快取
- icon-192.png / icon-512.png：安裝圖示

注意：Cloudflare Worker 不在這個 ZIP 裡。
先前的 pei_su_semantic_worker_v0_7.js 仍應部署在 Cloudflare Worker，
API Key 只放 Cloudflare Secret，不放 GitHub / HTML。

這不是最終完整角色聊天版；目前先完成「真正 AI 理解」這一層的可部署測試。
Retry Worker Service Binding deployment trigger.
