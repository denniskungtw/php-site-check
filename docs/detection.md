# 判斷方式說明

[← 回到 README](../README.md)

PHP Site Check 屬於**被動式指紋辨識**：只讀取網站在正常瀏覽時就會送出的資訊，從中找出 PHP 留下的特徵。

## 檢查流程

```
1. 對網址送出一般 GET 請求（會跟隨轉址）
        │
        ▼
2. 分析回應的 HTTP header、Set-Cookie、HTML 原始碼（前 200 KB）
   每找到一個特徵就加分
        │
        ▼
3. 分數 < 3（還不確定）時，進行補強探測：
   ├─ 開啟 /index.php
   └─ 開啟一個不存在的 .php 網址（例如 /zz-not-exist-1729650000000.php）
        │
        ▼
4. 依總分給出結果，並判斷 PHP 版本狀態
```

## 計分規則

### HTTP Header

| 特徵 | 分數 | 說明 |
|---|---|---|
| `X-Powered-By` 或 `Server` 含 `PHP/x.y.z` | 3 | 直接公開 PHP 版本號，同時取得版本 |
| `X-Powered-By` 含 `PHP`（無版本） | 3 | 公開使用 PHP |
| `X-Drupal-Cache` / `X-Drupal-Dynamic-Cache` | 3 | Drupal（PHP 撰寫）的快取標頭 |
| `Link` 含 `wp-json` | 3 | WordPress REST API |

### Cookie

| 特徵 | 分數 | 對應系統 |
|---|---|---|
| `PHPSESSID=` | 3 | PHP 內建 session 預設名稱 |
| `laravel_session=` | 3 | Laravel 框架 |
| `ci_session=` | 3 | CodeIgniter 框架 |
| `wordpress_` / `wp-settings-` | 3 | WordPress |
| `SESS` + 32 位十六進位 | 2 | Drupal |

### HTML 原始碼

| 特徵 | 分數 | 說明 |
|---|---|---|
| 含 `/wp-content/` 或 `/wp-includes/` | 3 | WordPress 固定資料夾結構 |
| `<meta name="generator">` 為 WordPress、Joomla、Drupal、MediaWiki、phpBB、Magento、PrestaShop、OpenCart | 3 | 這些系統都是 PHP 撰寫 |
| 連結指向本站的 `.php` 頁面 | 2 | 只計相對路徑或同網站的連結（`www.` 與子網域視為同網站），連到政府、合作單位等外部網站的 `.php` 不計分。報告中會列出最多 3 個實際連結 |

### 補強探測（只在分數 < 3 時進行）

| 特徵 | 分數 | 說明 |
|---|---|---|
| `/index.php` 回 200，且不存在的 `.php` 回 404 | 2 | 證明伺服器真的在處理 PHP 檔，而不是任何網址都回同一頁 |
| 404 錯誤頁的 header 出現上述特徵 | 依上表 | 很多網站首頁有隱藏 header，但錯誤頁忘了隱藏 |

## 結果判定

| 總分 | 結果 |
|---|---|
| 3 分以上 | 是 PHP |
| 1 ~ 2 分 | 可能是 PHP |
| 0 分 | 未發現 PHP 跡象 |
| 連線錯誤 | 連線失敗 |

## 其他安全觀察（不計分）

這些項目不影響「是不是 PHP」的判斷，但會列在報告的【其他安全觀察】，提醒管理者：

| 項目 | 檢查內容 |
|---|---|
| Session cookie 缺少安全屬性 | 登入用 cookie（PHPSESSID、laravel_session、ci_session、Drupal SESS…）是否設定 `Secure`、`HttpOnly`、`SameSite` |
| Server 標頭公開軟體版本 | `Server` 標頭是否帶有版本號，例如 `Apache/2.4.41` |

## PHP 版本狀態

只有在網站公開版本號時才能判斷。`php check.js` 開頭的 `PHP_EOL_DATES` 記錄各版本停止安全性支援的日期（依 [php.net 官方支援時程](https://www.php.net/supported-versions.php)），並與**檢查當天的日期**比較：

| 狀態 | 條件 |
|---|---|
| 已 EOL | 已過停止支援日期（以台灣時間當天 23:59:59 為準） |
| 即將 EOL | 距離停止支援不到 `PHP_EOL_SOON_DAYS`（預設 180）天 |
| 支援中 | 其他情況 |

- 比表中最舊版本還舊的版本（例如 5.6、7.0）一律視為已 EOL
- 比表中最新版本還新的版本（剛發布、表格還沒補上）視為支援中
- 報告建議升級的版本：表中最舊的「不是已 EOL、也不是即將 EOL」的版本

日期會自動判斷，**只有 PHP 發布新版本時需要在表中補一行**，例如：

```js
const PHP_EOL_DATES = {
  ...
  "8.5": "2029-12-31",
  "8.6": "2030-12-31",   // 新版本發布時加上
};
```

## 送出的請求

| 請求 | 時機 |
|---|---|
| `GET <網址>` | 每次 |
| `GET <網站根目錄>/index.php` | 分數 < 3 時 |
| `GET <網站根目錄>/zz-not-exist-<時間戳記>.php` | 分數 < 3 時 |

- User-Agent：`Mozilla/5.0 (PHP Site Check)`，網站管理者可在 log 中辨識
- 逾時：30 秒
- 不送出任何表單、不登入、不帶任何攻擊字串
