"use strict";

(() => {
  const byId = (id) => document.getElementById(id);
  const recordName = new URLSearchParams(window.location.search).get("id");
  const article = byId("recipe");
  const status = byId("recipe-status");
  let expiryTimer;
  let expiresAt = null;

  function showStatus(message) {
    clearTimeout(expiryTimer);
    article.hidden = true;
    byId("recipe-photo").hidden = true;
    byId("recipe-image").removeAttribute("src");
    // 期限終了時も、本文を非表示にするだけでなくDOMから取り除く。
    for (const name of ["name", "servings", "author", "categories", "ingredients", "memo", "expiry"]) {
      byId(`recipe-${name}`).textContent = "";
    }
    status.textContent = message;
    status.hidden = false;
  }

  function checkExpiry() {
    if (expiresAt === null) return false;
    const remaining = expiresAt - Date.now();
    if (remaining <= 0) {
      showStatus("この共有レシピの公開期間は終了しました。");
      return true;
    }
    clearTimeout(expiryTimer);
    expiryTimer = setTimeout(checkExpiry, Math.min(remaining, 2147483647));
    return false;
  }

  // CloudKit Bytes はBase64、Date/TimeはUnix epochからのミリ秒。
  function parseRecipe(value) {
    if (typeof value !== "string") throw new Error("Invalid Bytes");
    const bytes = Uint8Array.from(atob(value), (character) => character.charCodeAt(0));
    const recipe = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
    if (!recipe || typeof recipe.name !== "string" || !recipe.name.trim() ||
        typeof recipe.baseServings !== "number" || !Number.isFinite(recipe.baseServings) ||
        recipe.baseServings <= 0 || !Array.isArray(recipe.ingredients)) {
      throw new Error("Invalid SharedRecipe");
    }
    for (const key of ["author", "cookingMemo"]) {
      if (recipe[key] != null && typeof recipe[key] !== "string") throw new Error(`Invalid ${key}`);
    }
    if (recipe.categories != null && (!Array.isArray(recipe.categories) ||
        recipe.categories.some((category) => typeof category !== "string"))) {
      throw new Error("Invalid categories");
    }
    recipe.ingredients.forEach((ingredient) => {
      if (!ingredient || typeof ingredient.name !== "string") throw new Error("Invalid ingredient");
      for (const key of ["unit", "memo"]) {
        if (ingredient[key] != null && typeof ingredient[key] !== "string") throw new Error(`Invalid ${key}`);
      }
      for (const key of ["amount", "maxAmount"]) {
        const amount = ingredient[key];
        if (amount != null && typeof amount !== "string" &&
            !(typeof amount === "number" && Number.isFinite(amount))) throw new Error(`Invalid ${key}`);
      }
    });
    return recipe;
  }

  function quantity(ingredient) {
    const amount = ingredient.amount == null ? "" : String(ingredient.amount);
    const maximum = ingredient.maxAmount == null ? "" : String(ingredient.maxAmount);
    const range = maximum && maximum !== amount ? `${amount ? `${amount}〜` : ""}${maximum}` : amount;
    const unit = ingredient.unit || "";
    // 日本語の計量スプーン表記は「大さじ1」「小さじ1/2」。個・g等は後置。
    const value = /^(大さじ|小さじ)$/.test(unit) ? unit + range : range + unit;
    return value + (ingredient.memo ? `（${ingredient.memo}）` : "");
  }

  function render(recipe, image) {
    byId("recipe-name").textContent = recipe.name;
    byId("recipe-servings").textContent = `${recipe.baseServings}人前`;
    byId("recipe-author").textContent = recipe.author ? `作成者：${recipe.author}` : "";
    byId("recipe-author").hidden = !recipe.author;
    byId("recipe-categories").textContent = (recipe.categories || []).join(" / ");
    byId("recipe-categories").hidden = !recipe.categories?.length;
    const list = byId("recipe-ingredients");
    list.replaceChildren();
    recipe.ingredients.forEach((ingredient) => {
      const row = document.createElement("li");
      const name = document.createElement("span");
      const amount = document.createElement("span");
      name.textContent = ingredient.name;
      amount.textContent = quantity(ingredient);
      amount.className = "quantity";
      row.append(name, amount);
      list.append(row);
    });
    byId("recipe-memo").textContent = recipe.cookingMemo || "";
    if (expiresAt !== null) {
      const date = new Intl.DateTimeFormat("ja-JP", {
        dateStyle: "long", timeStyle: "short", timeZone: "Asia/Tokyo"
      }).format(expiresAt);
      byId("recipe-expiry").textContent = `共有期限：${date}（日本時間）`;
      byId("recipe-expiry").hidden = false;
    }
    if (image?.downloadURL) {
      // CKAssetのURLのみを利用。画像の取得失敗時も空枠を残さない。
      try {
        const url = new URL(image.downloadURL);
        if (url.protocol === "https:") {
          const photo = byId("recipe-image");
          photo.alt = recipe.name;
          photo.onload = () => { if (!checkExpiry()) byId("recipe-photo").hidden = false; };
          photo.onerror = () => { byId("recipe-photo").hidden = true; photo.removeAttribute("src"); };
          photo.src = url.href;
        }
      } catch { /* 不正な画像URLは省略し、本文は表示する。 */ }
    }
    status.hidden = true;
    article.hidden = false;
    checkExpiry();
  }

  // 任意の文字列をログへ流さない。コードも既知の値だけを許可する。
  const diagnosticCodes = new Set([
    "NOT_FOUND", "UNKNOWN_ITEM", "AUTHENTICATION_REQUIRED", "AUTHENTICATION_FAILED",
    "AUTHENTICATION_ERROR", "NOT_AUTHENTICATED", "PERMISSION_FAILURE", "ACCESS_DENIED",
    "NETWORK_ERROR", "NETWORK_FAILURE", "NETWORK_UNAVAILABLE", "CORS_ERROR",
    "SERVICE_UNAVAILABLE", "REQUEST_TIMEOUT", "BAD_REQUEST", "INVALID_ARGUMENTS",
    "CONFIGURATION_ERROR", "INTERNAL_ERROR", "QUOTA_EXCEEDED", "LIMIT_EXCEEDED",
    "THROTTLED", "TRY_AGAIN_LATER", "ZONE_NOT_FOUND", "SDK_UNAVAILABLE"
  ]);
  const authenticationCodes = new Set([
    "AUTHENTICATION_REQUIRED", "AUTHENTICATION_FAILED", "AUTHENTICATION_ERROR", "NOT_AUTHENTICATED"
  ]);
  const permissionCodes = new Set(["PERMISSION_FAILURE", "ACCESS_DENIED"]);

  function safeDiagnostic(error) {
    const safeCode = (value) => typeof value === "string" && diagnosticCodes.has(value) ? value : "UNKNOWN";
    const ckErrorCode = safeCode(error?.ckErrorCode);
    const serverErrorCode = safeCode(error?.serverErrorCode);
    // reasonにはURL・Token・Authorization等が混入し得るため、原文は出力しない。
    // 判別できる原因だけ固定文へ変換し、それ以外は省略する。
    const rawReason = typeof error?.reason === "string" ? error.reason.slice(0, 4096) : "";
    let reason = "詳細は安全のため省略しました";
    if (/origin|cors/i.test(rawReason)) reason = "OriginまたはCORSに関するエラー";
    else if (/api.?token|authenticat|authorization|not authorized/i.test(rawReason)) reason = "認証またはAPI Token設定に関するエラー";
    else if (/permission|access.denied/i.test(rawReason)) reason = "アクセス権限に関するエラー";
    else if (/not.found|does not exist|unknown.item/i.test(rawReason)) reason = "対象が見つかりません";
    else if (/network|timed?.?out|connection/i.test(rawReason)) reason = "ネットワークに関するエラー";
    else if (ckErrorCode === "SDK_UNAVAILABLE") reason = "CloudKit SDKを読み込めませんでした";
    return { ckErrorCode, serverErrorCode, reason };
  }

  function reportErrors(errors) {
    const diagnostics = errors.map(safeDiagnostic);
    diagnostics.forEach((diagnostic) => console.error(diagnostic));
    const codes = diagnostics.flatMap(({ ckErrorCode, serverErrorCode }) => [ckErrorCode, serverErrorCode]);
    if (codes.some((code) => authenticationCodes.has(code))) {
      showStatus("CloudKitの認証設定を確認してください。");
    } else if (codes.some((code) => permissionCodes.has(code))) {
      showStatus("CloudKitの読み取り権限を確認してください。");
    } else if (diagnostics.every(({ ckErrorCode, serverErrorCode }) =>
      [ckErrorCode, serverErrorCode].some((code) => code === "NOT_FOUND" || code === "UNKNOWN_ITEM"))) {
      showStatus("共有レシピが見つかりません。削除されたか、URLが正しくない可能性があります。");
    } else {
      showStatus("CloudKitとの通信に失敗しました。時間をおいて再読み込みするか、まかないアプリで開いてください。");
    }
  }

  async function load() {
    if (!recordName) {
      byId("open-button").disabled = true;
      showStatus("レシピIDが見つかりません。共有URLをご確認ください。");
      return;
    }
    const config = window.MAKANAI_CLOUDKIT_CONFIG;
    if (!config?.apiToken || config.apiToken === "YOUR_PRODUCTION_WEB_API_TOKEN") {
      showStatus("Webレシピ表示は準備中です。まかないアプリでレシピを開けます。");
      return;
    }
    let record;
    try {
      if (!window.CloudKit) {
        reportErrors([{ ckErrorCode: "SDK_UNAVAILABLE" }]);
        return;
      }
      CloudKit.configure({ containers: [{
        containerIdentifier: config.containerIdentifier,
        environment: config.environment,
        apiTokenAuth: { apiToken: config.apiToken, persist: false }
      }] });
      // 公開DBの匿名読み取り。サインインUI・一覧検索・変更・削除は行わない。
      const response = await CloudKit.getDefaultContainer().publicCloudDatabase.fetchRecords([recordName]);
      if (response.hasErrors) {
        const errors = Array.isArray(response.errors) && response.errors.length ? response.errors : [null];
        reportErrors(errors);
        return;
      }
      record = response.records?.find((item) => item.recordName === recordName);
      if (!record || record.recordType !== "Recipe") {
        showStatus("共有レシピが見つかりません。削除されたか、URLが正しくない可能性があります。");
        return;
      }
    } catch (error) {
      reportErrors([error]);
      return;
    }
    try {
      const fields = record.fields;
      const expiry = fields?.expiresAt?.value;
      if (expiry != null) {
        if (typeof expiry !== "number" || !Number.isFinite(expiry) ||
            !Number.isFinite(new Date(expiry).getTime())) throw new Error("Invalid expiresAt");
        expiresAt = expiry;
      }
      if (checkExpiry()) return;
      const recipe = parseRecipe(fields?.data?.value);
      render(recipe, fields?.image?.value);
    } catch {
      showStatus("レシピデータを解析できませんでした。まかないアプリで開いてください。");
    }
  }

  document.addEventListener("visibilitychange", () => { if (!document.hidden) checkExpiry(); });
  window.addEventListener("pageshow", checkExpiry);
  load();
})();
