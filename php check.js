/**
 * PHP 網站快速檢查（被動式指紋辨識）
 *
 * 只送一般 GET 請求，看 HTTP header、cookie、HTML 內容判斷網站是否跑 PHP，
 * 並在有回報版本號時標示是否為已停止支援 (EOL) 的 PHP 版本。
 * 不做任何漏洞攻擊或 payload 測試，請只檢查自己有權限的網站。
 *
 * 用法：
 *   1. 建立一個 Google Sheet → 擴充功能 → Apps Script，貼上本檔
 *   2. 重新整理 Sheet，選單會出現「PHP 檢查」
 *   3. 在「Sites」工作表 A 欄（A2 起）貼網址，按「PHP 檢查 → 檢查全部網址」
 *   也可以在儲存格直接用 =ISPHP("https://example.com")
 */

const SHEET_NAME = "Sites";
const HEADERS = ["網址", "結果", "PHP 版本", "版本狀態", "判斷依據", "HTTP 狀態", "Server", "檢查時間"];

// --- [Modified 2026-10-23] ---
// 修改原因：原本用固定的版本號判斷 EOL，過了 EOL 日期後結果會過時
// 修改內容：改成各版本的停止支援日期，依今天日期計算狀態；PHP 新版發布時補一行即可
// ----------------------------
// PHP 各版本停止安全性支援的日期（依 php.net/supported-versions，2026-10 更新）
// 比表中最舊版本更舊的版本一律視為已 EOL；比表中最新版本更新的版本視為支援中
const PHP_EOL_DATES = {
  "7.4": "2022-11-28",
  "8.0": "2023-11-26",
  "8.1": "2025-12-31",
  "8.2": "2026-12-31",
  "8.3": "2027-12-31",
  "8.4": "2028-12-31",
  "8.5": "2029-12-31",
};
// 距離 EOL 不到這個天數就標示「即將 EOL」
const PHP_EOL_SOON_DAYS = 180;

function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu("PHP 檢查")
    .addItem("檢查全部網址", "checkAllSites")
    .addItem("建立 Sites 工作表", "setupSheet")
    .addToUi();
}

function setupSheet() {
  const ss = SpreadsheetApp.getActive();
  const sheet = ss.getSheetByName(SHEET_NAME) || ss.insertSheet(SHEET_NAME);
  sheet.getRange(1, 1, 1, HEADERS.length).setValues([HEADERS]).setFontWeight("bold");
  sheet.setFrozenRows(1);
  return sheet;
}

function checkAllSites() {
  const sheet = setupSheet();
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) {
    SpreadsheetApp.getUi().alert("請先在「Sites」工作表 A2 起貼上網址");
    return;
  }
  const urls = sheet.getRange(2, 1, lastRow - 1, 1).getValues().map(r => String(r[0]).trim());
  const rows = urls.map(url => {
    if (!url) return ["", "", "", "", "", "", ""];
    const r = checkPhpSite(url);
    return [r.result, r.version, r.versionStatus, r.evidence.join("；"), r.status, r.server, new Date()];
  });
  sheet.getRange(2, 2, rows.length, rows[0].length).setValues(rows);
  colorResults_(sheet, rows);
}

/**
 * 儲存格自訂函數：=ISPHP("https://example.com")
 * @param {string} url 網址
 * @return {string} 結果摘要
 * @customfunction
 */
function ISPHP(url) {
  if (!url) return "";
  const r = checkPhpSite(url);
  return r.result + (r.version ? " " + r.version : "") + (r.versionStatus ? "（" + r.versionStatus + "）" : "");
}

/**
 * 檢查單一網站
 * @param {string} url
 * @return {{result:string, version:string, versionStatus:string, evidence:string[], status:string, server:string}}
 */
function checkPhpSite(url) {
  if (!/^https?:\/\//i.test(url)) url = "https://" + url;
  const opt = { muteHttpExceptions: true, followRedirects: true, validateHttpsCertificates: true };

  let main;
  try {
    main = UrlFetchApp.fetch(url, opt);
  } catch (e) {
    // --- [Modified 2026-10-23] ---
    // 修改原因：配合報告輸出，連線失敗也要有 details 欄位
    // 修改內容：回傳值加上空的 details
    // ----------------------------
    return { result: "連線失敗", version: "", versionStatus: "", evidence: [String(e.message || e)], details: [], status: "", server: "" };
  }

  // --- [Modified 2026-10-23] ---
  // 修改原因：判斷 .php 連結是否為同網站需要知道目前網址
  // 修改內容：多傳入 url
  // ----------------------------
  const res = analyzeResponse_(main.getAllHeaders(), main.getContentText().slice(0, 200000), url);

  // 補強：比較 /index.php 與一個不存在的 .php，避免「什麼網址都回 200」的誤判
  if (res.score < 3) {
    try {
      const base = url.replace(/^(https?:\/\/[^\/?#]+).*$/i, "$1");
      const idx = UrlFetchApp.fetch(base + "/index.php", opt);
  
      // --- [Modified 2026-10-23] ---
    // 補查頁面也完整分析，先保留證據，避免後續假網址逾時造成遺失。
    const idxAnalyzed = analyzeResponse_(
      idx.getAllHeaders(),
      idx.getContentText().slice(0, 200000),
      base + "/index.php"
    );

    // 採較高分，避免首頁與補查頁面重複加分。
    res.score = Math.max(res.score, idxAnalyzed.score);
    
      idxAnalyzed.evidence.forEach(e => {
        if (res.evidence.indexOf(e) < 0) res.evidence.push(e);
      });
    
      idxAnalyzed.details.forEach(d => {
        if (!res.details.some(existing =>
          existing.label === d.label && existing.raw === d.raw
        )) {
          res.details.push(Object.assign({}, d, {
            raw: "來源：" + base + "/index.php\n" + d.raw
          }));
        }
      });
    
      if (!res.version) res.version = idxAnalyzed.version; 

      
      const fake = UrlFetchApp.fetch(base + "/zz-not-exist-" + Date.now() + ".php", opt);
      // --- [Modified 2026-10-23] ---
      // 修改原因：報告需要補強探測的原始結果與說明
      // 修改內容：把 /index.php 與 404 頁的探測結果一併寫入 details
      // ----------------------------
      if (idx.getResponseCode() === 200 && fake.getResponseCode() === 404) {
        res.score += 2;
        res.evidence.push("/index.php 存在 (200)，假 .php 回 404");
        res.details.push({ kind: "evidence", label: "/index.php 存在 (200)，假 .php 回 404",
          raw: base + "/index.php → HTTP 200\n" + base + "/zz-not-exist-….php → HTTP 404",
          explain: "網站上真的有 index.php 這個 PHP 檔，而隨便亂打的 .php 網址會回「找不到」，表示伺服器確實在處理 PHP 檔案（不是什麼網址都回同一頁）。",
          advice: "" });
      }
      // 很多站首頁有藏 header，但錯誤頁沒藏
      const fakeAnalyzed = analyzeResponse_(fake.getAllHeaders(), "");
      if (fakeAnalyzed.score > 0) {
        res.score += fakeAnalyzed.score;
        fakeAnalyzed.evidence.forEach(e => res.evidence.push("404 頁 " + e));
        fakeAnalyzed.details.forEach(d => {
          d.label = "404 頁 " + d.label;
          d.explain = "（首頁沒有、但「找不到網頁」的錯誤頁有出現）" + d.explain;
          res.details.push(d);
        });
        if (!res.version) res.version = fakeAnalyzed.version;
      }
    } catch (e) {
      // 探測失敗不影響主結果
    }
  }

  res.status = String(main.getResponseCode());
  res.result = res.score >= 3 ? "是 PHP" : res.score >= 1 ? "可能是 PHP" : "未發現 PHP 跡象";
  res.versionStatus = phpVersionStatus_(res.version);
  delete res.score;
  return res;
}

// --- [Modified 2026-10-23] ---
// 修改原因：要產生可以分享給網站管理者的中文報告，需要每個依據的原始內容與說明
// 修改內容：除了 evidence 標籤外，另外回傳 details（看到的原始內容、中文說明、建議），
//           並加入不計分的觀察項目（session cookie 安全屬性、Server 版本外洩）；
//           evidence / score 的判斷邏輯不變，Sheet 輸出維持原樣
// ----------------------------
/**
 * 分析 header 與 HTML，回傳分數與依據（不需網路，方便測試）
 * score >= 3 視為確定，1~2 視為可能
 * details: [{kind: "evidence"|"note", label, raw, explain, advice}]
 * pageUrl: 目前檢查的網址，用來判斷 .php 連結是不是本站（可省略）
 */
function analyzeResponse_(headers, html, pageUrl) {
  const h = {};
  Object.keys(headers || {}).forEach(k => {
    const v = headers[k];
    h[k.toLowerCase()] = Array.isArray(v) ? v.join("\n") : String(v);
  });
  const evidence = [];
  const details = [];
  let score = 0;
  let version = "";

  const add = (s, label, raw, explain, advice) => {
    score += s;
    evidence.push(label);
    details.push({ kind: "evidence", label: label, raw: raw, explain: explain, advice: advice || "" });
  };
  const note = (label, raw, explain, advice) => {
    details.push({ kind: "note", label: label, raw: raw, explain: explain, advice: advice || "" });
  };

  const powered = h["x-powered-by"] || "";
  const server = h["server"] || "";
  const m = (powered + " " + server).match(/PHP\/(\d+\.\d+(?:\.\d+)?)/i);
  if (m) {
    version = m[1];
    add(3, "Header 回報 PHP/" + version,
      (powered ? "X-Powered-By: " + powered : "Server: " + server),
      "伺服器在每個回應裡主動告訴訪客「我用的是 PHP " + version + "」。這讓任何人（包括自動化掃描程式）都能直接查到這個版本已知的漏洞。",
      "在 php.ini 設定 expose_php = Off，並重新啟動網頁伺服器，就不會再送出 PHP 版本號。");
  } else if (/php/i.test(powered)) {
    add(3, "X-Powered-By: " + powered, "X-Powered-By: " + powered,
      "伺服器回應裡的 X-Powered-By 標頭寫明使用 PHP。",
      "在 php.ini 設定 expose_php = Off，移除 X-Powered-By 標頭。");
  }

  const cookies = (h["set-cookie"] || "").split("\n").filter(Boolean);
  const findCookie = re => cookies.filter(c => re.test(c))[0] || "";
  [
    [/PHPSESSID=/i, "Cookie PHPSESSID", 3, "PHPSESSID 是 PHP 內建 session（登入狀態、購物車等）功能的預設 cookie 名稱，幾乎只有 PHP 程式會發出。",
      "可在 php.ini 用 session.name 改成自訂名稱，減少外界一眼看出使用 PHP。"],
    [/laravel_session=/i, "Cookie laravel_session (Laravel)", 3, "laravel_session 是 PHP 框架 Laravel 的預設 session cookie。", "確認 Laravel 與套件有持續更新。"],
    [/ci_session=/i, "Cookie ci_session (CodeIgniter)", 3, "ci_session 是 PHP 框架 CodeIgniter 的預設 session cookie。", "確認 CodeIgniter 版本仍有官方支援（CodeIgniter 3 已停止維護）。"],
    [/wordpress_|wp-settings-/i, "Cookie WordPress", 3, "WordPress（以 PHP 撰寫）會發出 wordpress_ / wp-settings- 開頭的 cookie。", "確認 WordPress 核心、佈景主題與外掛都是最新版。"],
    [/SESS[0-9a-f]{32}=/i, "Cookie Drupal", 2, "SESS 加 32 位十六進位的 cookie 名稱是 Drupal（以 PHP 撰寫）的 session 格式。", "確認 Drupal 核心與模組有套用安全性更新。"],
  ].forEach(([re, label, s, explain, advice]) => {
    const c = findCookie(re);
    if (c) add(s, label, "Set-Cookie: " + maskCookie_(c), explain, advice);
  });

  // session cookie 的安全屬性（不計分，只是提醒）
  const sess = findCookie(/PHPSESSID=|laravel_session=|ci_session=|SESS[0-9a-f]{32}=/i);
  if (sess) {
    const missing = [];
    if (!/;\s*secure/i.test(sess)) missing.push("Secure（只透過 HTTPS 傳送）");
    if (!/;\s*httponly/i.test(sess)) missing.push("HttpOnly（不讓網頁 JavaScript 讀取，降低 XSS 偷登入狀態的風險）");
    if (!/;\s*samesite/i.test(sess)) missing.push("SameSite（降低 CSRF 跨站請求偽造風險）");
    if (missing.length) {
      note("Session cookie 缺少安全屬性", "Set-Cookie: " + maskCookie_(sess),
        "登入狀態用的 cookie 沒有設定：" + missing.join("、") + "。",
        "在 php.ini 設定 session.cookie_secure = 1、session.cookie_httponly = 1、session.cookie_samesite = Lax（或在程式的 session_set_cookie_params 設定）。");
    }
  }

  if (h["x-drupal-cache"] || h["x-drupal-dynamic-cache"]) {
    add(3, "Header X-Drupal-*", "X-Drupal-Cache: " + (h["x-drupal-cache"] || h["x-drupal-dynamic-cache"]),
      "X-Drupal-* 標頭是 Drupal（以 PHP 撰寫）快取機制送出的。", "確認 Drupal 核心與模組有套用安全性更新。");
  }
  if (/wp-json/i.test(h["link"] || "")) {
    add(3, "Header Link: wp-json (WordPress)", "Link: " + h["link"].slice(0, 200),
      "Link 標頭指向 /wp-json/，這是 WordPress REST API 的位置。", "確認 WordPress 核心、佈景主題與外掛都是最新版。");
  }

  if (html) {
    const wp = html.match(/[^"'\s]*\/wp-(content|includes)\/[^"'\s]*/i);
    if (wp) {
      add(3, "HTML 含 wp-content (WordPress)", wp[0].slice(0, 200),
        "網頁原始碼載入 /wp-content/ 或 /wp-includes/ 底下的檔案，這是 WordPress 固定的資料夾結構。",
        "確認 WordPress 核心、佈景主題與外掛都是最新版。");
    }
    const gen = html.match(/<meta[^>]+generator[^>]+(WordPress|Joomla|Drupal|MediaWiki|phpBB|Magento|PrestaShop|OpenCart)[^>]*>/i);
    if (gen) {
      add(3, "Generator: " + gen[1], gen[0].slice(0, 200),
        "網頁的 <meta name=\"generator\"> 標示由 " + gen[1] + " 產生，這套系統是用 PHP 撰寫的。若有附版本號，外界也能直接看出版本。",
        "可在 " + gen[1] + " 的設定或佈景主題中移除 generator 標籤，並保持系統更新。");
    }
    // --- [Modified 2026-10-23] ---
    // 修改原因：首頁連到其他網站（政府、合作單位）的 .php 頁面也會被計分，造成誤判
    // 修改內容：只計算相對路徑或同網站（含 www. 與子網域）的 .php 連結
    // ----------------------------
    const links = [];
    const re = /href=["']([^"']+\.php(?:\?[^"']*)?)["']/gi;
    let mm;
    while ((mm = re.exec(html)) && links.length < 3) {
      if (links.indexOf(mm[1]) < 0 && isSameSite_(mm[1], pageUrl)) links.push(mm[1]);
    }
    if (links.length) {
      add(2, "HTML 連結到 .php 頁面", links.join("\n"),
        "首頁裡連到本站的連結指向副檔名為 .php 的網頁，代表這些頁面是由 PHP 程式產生。",
        "");
    }
  }

  // Server 標頭帶版本號（不計分，只是提醒）
  if (/\/\d/.test(server)) {
    note("Server 標頭公開軟體版本", "Server: " + server,
      "網頁伺服器在回應裡公開了軟體名稱與版本號，外界可據此查詢已知漏洞。",
      "Apache 可設定 ServerTokens Prod 與 ServerSignature Off；nginx 可設定 server_tokens off。");
  }

  return { score: score, version: version, evidence: evidence, details: details, server: server };
}

// --- [Modified 2026-10-23] ---
// 修改原因：報告會分享給別人，不應該把 session ID 原文印出來
// 修改內容：新增函式，把 cookie 值只留前 4 碼，其餘以 … 取代
// ----------------------------
function maskCookie_(cookie) {
  return cookie.replace(/^([^=]+=)([^;]*)/, (all, name, val) =>
    name + (val.length > 4 ? val.slice(0, 4) + "…（已遮蔽）" : val));
}

// --- [Modified 2026-10-23] ---
// 修改原因：過濾外部網站的 .php 連結
// 修改內容：新增函式；相對路徑視為同網站，絕對網址比對主機名稱（去掉 www.，子網域也算同網站）
// ----------------------------
function isSameSite_(href, pageUrl) {
  const hm = href.match(/^(?:https?:)?\/\/([^\/?#:]+)/i);
  if (!hm) return true;
  const pm = String(pageUrl || "").match(/^(?:https?:)?\/\/([^\/?#:]+)/i);
  if (!pm) return true;
  const a = hm[1].toLowerCase().replace(/^www\./, ""), b = pm[1].toLowerCase().replace(/^www\./, "");
  return a === b || a.endsWith("." + b) || b.endsWith("." + a);
}

// --- [Modified 2026-10-23] ---
// 修改原因：EOL 改以日期判斷
// 修改內容：依 PHP_EOL_DATES 與今天日期回傳狀態；即將 EOL 時附上停止支援日期
// ----------------------------
function phpVersionStatus_(version, today) {
  if (!version) return "";
  const eol = phpEolDate_(version);
  if (!eol) return "支援中";
  const days = (eol - (today || new Date())) / 86400000;
  if (days < 0) return "已 EOL，請盡快升級";
  if (days < PHP_EOL_SOON_DAYS) return "即將 EOL，" + formatDate_(eol) + " 停止支援";
  return "支援中";
}

// --- [Modified 2026-10-23] ---
// 修改原因：EOL 改以日期判斷
// 修改內容：新增函式，回傳該版本停止支援的時間（台灣時間當天結束）；
//           比表中最舊版本更舊回傳 1970-01-01（已 EOL），比最新版本更新回傳 null（支援中）
// ----------------------------
function phpEolDate_(version) {
  const mm = String(version).split(".").slice(0, 2).join(".");
  const keys = Object.keys(PHP_EOL_DATES).sort(compareVer_);
  if (PHP_EOL_DATES[mm]) return new Date(PHP_EOL_DATES[mm] + "T23:59:59+08:00");
  if (compareVer_(mm, keys[0]) < 0) return new Date(0);
  return null;
}

// --- [Modified 2026-10-23] ---
// 修改原因：原本建議升級的版本「8.3 以上」是寫死的
// 修改內容：新增函式，回傳最舊的「不是已 EOL 也不是即將 EOL」的版本
// ----------------------------
function phpRecommendedVersion_(today) {
  const now = today || new Date();
  const keys = Object.keys(PHP_EOL_DATES).sort(compareVer_);
  for (let i = 0; i < keys.length; i++) {
    if ((phpEolDate_(keys[i]) - now) / 86400000 >= PHP_EOL_SOON_DAYS) return keys[i];
  }
  return keys[keys.length - 1];
}

// --- [Modified 2026-10-23] ---
// 修改原因：報告與狀態要顯示 EOL 日期
// 修改內容：新增函式，以台灣時間輸出 YYYY-MM-DD（不用 Utilities，Apps Script 與 Node 都可用）
// ----------------------------
function formatDate_(d) {
  const t = new Date(d.getTime() + 8 * 3600000);
  return t.getUTCFullYear() + "-" + String(t.getUTCMonth() + 1).padStart(2, "0") + "-" + String(t.getUTCDate()).padStart(2, "0");
}

function compareVer_(a, b) {
  const pa = a.split(".").map(Number), pb = b.split(".").map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] || 0) - (pb[i] || 0);
    if (d) return d;
  }
  return 0;
}

function colorResults_(sheet, rows) {
  const colors = rows.map(r => {
    if (r[0] === "是 PHP") return [/EOL/.test(r[2]) ? "#f4cccc" : "#fff2cc"];
    if (r[0] === "可能是 PHP") return ["#fff2cc"];
    if (r[0] === "連線失敗") return ["#d9d9d9"];
    return [r[0] ? "#d9ead3" : null];
  });
  sheet.getRange(2, 2, colors.length, 1).setBackgrounds(colors);
}
