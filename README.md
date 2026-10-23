# PHP Site Check — PHP 網站快速檢查工具

輸入網址，就能知道一個網站是不是用 **PHP** 執行、有沒有對外洩露 PHP 版本、版本是否已經停止支援（EOL），並產生一份**看得懂的中文報告**，可以直接傳給網站管理者參考。

- **被動式檢查**：只像一般瀏覽器一樣開啟網頁，觀察伺服器回應，**不做任何攻擊、登入或漏洞測試**
- **有憑有據**：每一項判斷都附上實際看到的 header、cookie 或網頁原始碼片段
- **中文說明與建議**：用白話解釋代表什麼意思，並提供具體的修正設定
- **兩種用法**：本機指令（Windows / macOS / Linux），或 Google Sheet 批次檢查

> ⚠️ 請只檢查**自己的網站**，或**已取得管理者同意**的網站。

---

## 目錄

- [快速開始](#快速開始)
- [使用方式](#使用方式)
- [報告範例](#報告範例)
- [結果代表什麼](#結果代表什麼)
- [限制](#限制)
- [其他文件](#其他文件)

---

## 快速開始

### 需要的環境

| 項目 | 說明 |
|---|---|
| [Node.js](https://nodejs.org/) | 16 版以上 |
| curl | Windows 10 / 11、macOS、大部分 Linux 都已內建 |

在命令列輸入下面兩行，有出現版本號就表示可以使用：

```bash
node -v
curl --version
```

### 下載

```bash
git clone https://github.com/denniskungtw/php-site-check.git
cd php-site-check
```

或在 GitHub 頁面按 **Code → Download ZIP**，解壓縮即可。不需要 `npm install`，沒有任何外部套件。

### 第一次執行

在工具所在的資料夾執行：

```bash
node run-local.js https://www.example.com
```

---

## 使用方式

### 1. 檢查一個或多個網址

```bash
node run-local.js www.example.com https://another.example.org
```

網址可以省略 `https://`，會自動補上。

### 2. 把報告存成文字檔（方便分享）

加上 `--save`（或 `-s`）：

```bash
node run-local.js --save https://www.example.com
```

會在**目前所在的資料夾**產生 `PHP檢查報告-www.example.com-YYYYMMDD.txt`。檔案使用 UTF-8（含 BOM），用 Windows 記事本、LINE、Email 附件開啟都不會出現亂碼。

### 3. 互動模式（不用打指令）

Windows 使用者可以直接**雙擊 `phpcheck.cmd`**，視窗會詢問網址：

```
輸入網址（可用空白分隔多筆，直接 Enter 結束）：
```

不帶網址執行 `node run-local.js` 也會進入同樣的互動模式。

### 4. 在任何資料夾都能用 `phpcheck` 指令（Windows，選用）

把工具所在的資料夾加入系統的 **PATH** 環境變數：

1. 按 Windows 鍵，搜尋「**編輯您帳戶的環境變數**」
2. 選「Path」→「編輯」→「新增」，貼上工具資料夾的完整路徑（例如 `C:\tools\php-site-check`）
3. 按確定後，**重新開啟**命令提示字元或 PowerShell

之後在任何地方都可以直接輸入：

```bash
phpcheck www.example.com
phpcheck --save www.example.com
```

### 5. Google Sheet 批次檢查

想一次檢查很多網站、把結果整理成表格，可以使用 Google Apps Script 版本，請看 [Google Sheet 版使用說明](docs/google-sheet.md)。

> 本機版和 Google Sheet 版共用同一份判斷邏輯（`php check.js`），結果一致。
> 本機版的好處是可以檢查**公司內網**或**只開放台灣 IP** 的網站（Google 的主機在國外，可能連不到）。

---

## 報告範例

以下是虛構網站的範例輸出：

```
========================================================
PHP 網站檢查報告
========================================================
網址　　：https://www.example.com/
檢查時間：2026-10-23 11:28
結果　　：是 PHP（PHP 7.4.33，已 EOL，請盡快升級）
     伺服器回應含有明確的 PHP 特徵。請管理者確認實際執行環境。

【伺服器資訊】
  HTTP 狀態：200（正常）
  Server　 ：Apache/2.4.41 (Ubuntu)

【判斷依據】

  1. Header 回報 PHP/7.4.33
     看到的內容：
       X-Powered-By: PHP/7.4.33
     說明：伺服器在每個回應裡主動告訴訪客「我用的是 PHP 7.4.33」。這讓任何人（包括自動化
     掃描程式）都能直接查到這個版本已知的漏洞。

  2. Cookie PHPSESSID
     看到的內容：
       Set-Cookie: PHPSESSID=5bcc…（已遮蔽）; path=/
     說明：PHPSESSID 是 PHP 內建 session（登入狀態、購物車等）功能的預設 cookie 名稱，
     幾乎只有 PHP 程式會發出。

【其他安全觀察】

  1. Session cookie 缺少安全屬性
     ...
  2. Server 標頭公開軟體版本
     ...

【PHP 版本】
  PHP 7.4.33 已經停止官方支援（EOL），之後發現的安全漏洞都不會再修補，建議盡快升級到 8.3 以上。

【建議】
  1. 升級 PHP 到仍受官方支援的版本（建議 8.3 以上）。
  2. 在 php.ini 設定 expose_php = Off，並重新啟動網頁伺服器，就不會再送出 PHP 版本號。
  ...
========================================================
```

報告中的 session ID 只保留前 4 碼，其餘自動遮蔽，分享報告不會洩露別人的登入狀態。

---

## 結果代表什麼

| 結果 | 意思 |
|---|---|
| **是 PHP** | 伺服器回應含有明確的 PHP 特徵。請管理者確認實際執行環境 |
| **可能是 PHP** | 有一些跡象，但不足以百分之百確定 |
| **未發現 PHP 跡象** | 從外部看不到 PHP 特徵。可能不是 PHP，也可能管理者隱藏得很好 |
| **連線失敗** | 連不上網站（網址錯誤、網站關閉、或只允許特定網路連線） |

PHP 版本狀態依 [php.net 官方支援時程](https://www.php.net/supported-versions.php) 的停止支援日期，**以檢查當天的日期自動計算**：

| 狀態 | 意思 |
|---|---|
| **已 EOL** | 已過停止支援日期，不再有安全性更新，請盡快升級 |
| **即將 EOL** | 距離停止支援不到 180 天 |
| **支援中** | 仍在官方支援期內 |

報告中建議升級的版本也會依日期自動選擇（最舊的「仍在支援、且不是即將 EOL」的版本）。

> 💡 **使用 PHP 本身不是問題**，很多大型網站都用 PHP。需要注意的是版本是否還有安全性更新，以及網站是否對外透露太多軟體版本資訊。

詳細的判斷規則請看 [判斷方式說明](docs/detection.md)。

---

## 限制

- 只能看到網站**對外公開**的資訊。管理者若已把版本號、預設 cookie 名稱都隱藏，就可能判斷為「未發現 PHP 跡象」——這其實是好事。
- 大部分網站不會公開 PHP 版本號，這時工具**無法從外部判斷版本是否過舊**，需要管理者自行確認。
- 使用 CDN 或反向代理（例如 Cloudflare）的網站，看到的 `Server` 標頭可能是 CDN 的，而不是原始主機的。
- 這不是完整的資安檢測，**沒有發現問題不代表網站一定安全**。

---

## 其他文件

| 文件 | 內容 |
|---|---|
| [判斷方式說明](docs/detection.md) | 每一條判斷規則、計分方式、補強探測 |
| [網站管理者修正指南](docs/fix-guide.md) | 依報告建議逐項修正的設定方法（php.ini、Apache、nginx、WordPress） |
| [Google Sheet 版使用說明](docs/google-sheet.md) | 用 Google Apps Script 批次檢查多個網站 |

## 檔案說明

| 檔案 | 用途 |
|---|---|
| `php check.js` | 判斷邏輯（Google Apps Script 版本，本機版也載入這份） |
| `run-local.js` | 本機執行程式（Node.js + curl），產生中文報告 |
| `phpcheck.cmd` | Windows 啟動器，可雙擊或加入 PATH 使用 |
| `appsscript.json` | Google Apps Script 專案設定 |

## 授權

[MIT License](LICENSE)

## 使用原則

本工具只送出一般的 HTTP GET 請求，與用瀏覽器開啟網頁相同，不嘗試任何攻擊或繞過。即便如此，**請只檢查自己擁有或已取得授權的網站**，並以善意協助網站管理者改善為目的。
