/**
 * 在本機（Node.js + curl）跑同一套 PHP 檢查，不必經過 Google Sheet
 * 可以檢查公司內網或只開放台灣連線的網站
 *
 * 用法：node "PHP Site Check/run-local.js" www.example.com https://other.example.org
 *       或 phpcheck www.example.com（phpcheck.cmd）；不帶網址會逐筆詢問
 *       加 --save（或 -s）會把中文報告另存成 .txt，方便傳給網站管理者
 */
const fs = require("fs");
const os = require("os");
const path = require("path");
const { execFileSync } = require("child_process");

// 載入 Apps Script 版的判斷邏輯，維持兩邊結果一致
eval(fs.readFileSync(path.join(__dirname, "php check.js"), "utf8"));

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "phpcheck-"));

// 用 curl 模擬 UrlFetchApp.fetch，只取最後一次轉址後的 header
global.UrlFetchApp = {
  fetch: (url) => {
    const hf = path.join(tmp, "h.txt"), bf = path.join(tmp, "b.txt");
    try {
      execFileSync("curl", ["-sSL", "--max-time", "30", "-A", "Mozilla/5.0 (PHP Site Check)", "-D", hf, "-o", bf, url],
        { stdio: ["ignore", "ignore", "pipe"] });
    } catch (e) {
      throw new Error(String(e.stderr || e.message).trim());
    }
    const blocks = fs.readFileSync(hf, "latin1").split(/\r?\n\r?\n/).filter(b => /^HTTP\//.test(b));
    const lines = blocks[blocks.length - 1].split(/\r?\n/);
    const code = Number(lines[0].split(" ")[1]);
    const headers = {};
    lines.slice(1).forEach(l => {
      const i = l.indexOf(":");
      if (i < 0) return;
      const k = l.slice(0, i).trim(), v = l.slice(i + 1).trim();
      headers[k] = headers[k] ? [].concat(headers[k], v) : v;
    });
    const body = fs.readFileSync(bf, "utf8");
    return { getResponseCode: () => code, getAllHeaders: () => headers, getContentText: () => body };
  },
};

const RESULT_EXPLAIN = {
  "是 PHP": "從伺服器回應中找到明確的 PHP 特徵，可以確定這個網站是用 PHP 執行的。",
  "可能是 PHP": "找到一些 PHP 的跡象，但不夠明確，無法百分之百確定。",
  "未發現 PHP 跡象": "沒有從外部看到 PHP 的特徵。網站可能不是 PHP，也可能管理者已把相關資訊隱藏得很好。",
  "連線失敗": "無法連上這個網站（可能網址錯誤、網站暫時關閉，或只允許特定網路連線）。",
};

function versionExplain(r) {
  if (!r.version) {
    return r.result === "是 PHP" || r.result === "可能是 PHP"
      ? "網站沒有對外公開 PHP 版本號（這是好的做法），因此無法從外部判斷版本是否過舊。\n請管理者自行確認目前的 PHP 版本（主機商控制台，或在伺服器上執行 php -v），並對照 https://www.php.net/supported-versions.php 確認仍在支援期內。"
      : "";
  }
  if (/已 EOL/.test(r.versionStatus)) return "PHP " + r.version + " 已經停止官方支援（EOL），之後發現的安全漏洞都不會再修補，建議盡快升級到 8.3 以上。";
  if (/即將 EOL/.test(r.versionStatus)) return "PHP " + r.version + " 的安全性更新只到 2026-12-31，建議近期規劃升級到 8.3 以上。";
  return "PHP " + r.version + " 目前仍在官方支援期內。";
}

function buildReport(url, r) {
  const L = [];
  const line = "=".repeat(56);
  const now = new Date();
  const pad = n => String(n).padStart(2, "0");
  L.push(line);
  L.push("PHP 網站檢查報告");
  L.push(line);
  L.push("網址　　：" + url);
  L.push("檢查時間：" + now.getFullYear() + "-" + pad(now.getMonth() + 1) + "-" + pad(now.getDate()) + " " + pad(now.getHours()) + ":" + pad(now.getMinutes()));
  L.push("結果　　：" + r.result + (r.version ? "（PHP " + r.version + "，" + r.versionStatus + "）" : ""));
  L.push("　　　　　" + (RESULT_EXPLAIN[r.result] || ""));
  if (r.status) {
    L.push("");
    L.push("【伺服器資訊】");
    L.push("  HTTP 狀態：" + r.status + (r.status === "200" ? "（正常）" : ""));
    L.push("  Server　 ：" + (r.server || "（沒有提供）"));
  }

  const ev = (r.details || []).filter(d => d.kind === "evidence");
  const notes = (r.details || []).filter(d => d.kind === "note");
  const item = (d, i) => {
    L.push("");
    L.push("  " + (i + 1) + ". " + d.label);
    L.push("     看到的內容：");
    d.raw.split("\n").forEach(s => L.push("       " + s));
    L.push("     說明：" + d.explain);
  };
  if (ev.length) {
    L.push("");
    L.push("【判斷依據】");
    ev.forEach(item);
  } else if (r.result === "連線失敗") {
    L.push("");
    L.push("【錯誤訊息】");
    L.push("  " + r.evidence.join("；"));
  }
  if (notes.length) {
    L.push("");
    L.push("【其他安全觀察】");
    notes.forEach(item);
  }

  const ver = versionExplain(r);
  if (ver) {
    L.push("");
    L.push("【PHP 版本】");
    ver.split("\n").forEach(s => L.push("  " + s));
  }

  const advice = [];
  (r.details || []).forEach(d => { if (d.advice && advice.indexOf(d.advice) < 0) advice.push(d.advice); });
  if (/已 EOL|即將 EOL/.test(r.versionStatus)) advice.unshift("升級 PHP 到仍受官方支援的版本（建議 8.3 以上）。");
  if (advice.length) {
    L.push("");
    L.push("【建議】");
    advice.forEach((a, i) => L.push("  " + (i + 1) + ". " + a));
  }

  L.push("");
  L.push("【關於這份報告】");
  L.push("  使用 PHP 本身不是問題，很多大型網站都用 PHP。需要注意的是：PHP 版本是否還有安全性更新、");
  L.push("  以及網站是否對外透露太多軟體版本資訊。");
  L.push("  這份檢查只像一般瀏覽器一樣開啟首頁（首頁看不出來時，再試開 /index.php 和一個不存在的 .php 網址），");
  L.push("  觀察伺服器回應的標頭、cookie 與網頁原始碼，沒有做任何攻擊、登入或漏洞測試。");
  L.push(line);
  return L.join("\n");
}

const SAVE = process.argv.includes("--save") || process.argv.includes("-s");

function report(url) {
  const r = checkPhpSite(url);
  const text = buildReport(url, r);
  console.log("\n" + text);
  if (SAVE) {
    const host = url.replace(/^https?:\/\//i, "").replace(/[\/?#].*$/, "").replace(/[^\w.-]/g, "_");
    const d = new Date();
    const stamp = d.getFullYear() + String(d.getMonth() + 1).padStart(2, "0") + String(d.getDate()).padStart(2, "0");
    const file = path.resolve("PHP檢查報告-" + host + "-" + stamp + ".txt");
    // 加 BOM，Windows 記事本 / LINE 開啟時中文才不會變亂碼
    fs.writeFileSync(file, "﻿" + text.replace(/\n/g, "\r\n") + "\r\n", "utf8");
    console.log("已存成：" + file);
  }
}

const urls = process.argv.slice(2).filter(a => a !== "--save" && a !== "-s");
if (urls.length) {
  urls.forEach(report);
  fs.rmSync(tmp, { recursive: true, force: true });
} else {
  // 沒給網址（例如直接雙擊 phpcheck.cmd）就一筆一筆詢問，空白 Enter 結束
  const rl = require("readline").createInterface({ input: process.stdin, output: process.stdout });
  const ask = () => rl.question("\n輸入網址（可用空白分隔多筆，直接 Enter 結束）：", line => {
    const list = line.split(/\s+/).filter(Boolean);
    if (!list.length) {
      rl.close();
      fs.rmSync(tmp, { recursive: true, force: true });
      return;
    }
    list.forEach(report);
    ask();
  });
  ask();
}
