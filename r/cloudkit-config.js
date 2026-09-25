"use strict";

// 設定箇所：apiToken を CloudKit Console の Production 用 Web API Token に置換。
// ブラウザへ公開される設定です。Server-to-Server Key・秘密鍵は記載しません。
// Allowed Origin: https://makanai-app.github.io
window.MAKANAI_CLOUDKIT_CONFIG = Object.freeze({
  containerIdentifier: "iCloud.com.kitakaze78.makanaiapp",
  environment: "production",
  apiToken: "c0fb4d6615f92f8a587d04360ccf5e64bf862b54fa2ad908cf04b4bb71960afd"
});
