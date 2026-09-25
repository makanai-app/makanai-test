"use strict";

// 設定箇所：apiToken を CloudKit Console の Production 用 Web API Token に置換。
// ブラウザへ公開される設定です。Server-to-Server Key・秘密鍵は記載しません。
// Allowed Origin: https://makanai-app.github.io
window.MAKANAI_CLOUDKIT_CONFIG = Object.freeze({
  containerIdentifier: "iCloud.com.kitakaze78.makanaiapp",
  environment: "production",
  apiToken: "eae32358dd11c36baac057a874a54f3024ae79b736a4e60bde08e699c7b76681"
});
