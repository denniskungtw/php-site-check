# 網站管理者修正指南

[← 回到 README](../README.md)

如果你收到了一份「PHP 網站檢查報告」，這份指南說明報告中每一項建議的意義與修正方法。

> 💡 **使用 PHP 本身不是問題**。報告的重點是：PHP 版本是否還有安全性更新，以及網站是否對外透露太多軟體資訊。
> 修改伺服器設定前，建議先備份設定檔；如果是使用虛擬主機，部分設定可能需要透過主機商控制台或請主機商協助。

---

## 優先順序

| 優先 | 項目 | 為什麼 |
|---|---|---|
| 🔴 高 | [升級已 EOL 的 PHP](#1-升級-php-版本) | 已知漏洞不會再被修補 |
| 🟠 中 | [Session cookie 加上安全屬性](#2-session-cookie-加上安全屬性) | 降低登入狀態被竊取的風險 |
| 🟠 中 | [更新 CMS 與外掛](#5-wordpress--drupal--joomla-等-cms) | CMS 外掛是最常見的入侵管道 |
| 🟡 低 | [隱藏 PHP 版本號](#3-隱藏-php-版本號) | 減少外界掃描的線索 |
| 🟡 低 | [隱藏伺服器版本號](#4-隱藏網頁伺服器版本號) | 同上 |
| 🟡 低 | [修改 session cookie 名稱](#6-修改-session-cookie-名稱) | 同上 |

「低」優先的項目屬於**資訊揭露**：本身不是漏洞，但會讓攻擊者更容易找到目標。

---

## 1. 升級 PHP 版本

**報告中會出現**：`已 EOL，請盡快升級` 或 `即將 EOL`

PHP 每個版本大約有 4 年的支援期。過了 EOL 之後，新發現的安全漏洞**不會再修補**。

**確認目前版本**：

```bash
php -v
```

虛擬主機通常可以在控制台（cPanel、Plesk、DirectAdmin 等）的「PHP 版本」或「PHP Selector」切換。

**升級前請注意**：

- 先在測試環境確認網站程式、CMS、外掛相容新版 PHP
- PHP 7.x → 8.x 有不少不相容的變更，舊程式可能需要修改
- 參考：[PHP 官方支援時程](https://www.php.net/supported-versions.php)、[PHP 8 遷移指南](https://www.php.net/manual/zh/migration80.php)

---

## 2. Session cookie 加上安全屬性

**報告中會出現**：`Session cookie 缺少安全屬性`

| 屬性 | 作用 |
|---|---|
| `Secure` | cookie 只透過 HTTPS 傳送，避免在不安全的網路被攔截 |
| `HttpOnly` | 網頁的 JavaScript 無法讀取，即使網站有 XSS 漏洞，登入狀態也不容易被偷 |
| `SameSite` | 限制其他網站發出的請求帶上這個 cookie，降低 CSRF（跨站請求偽造）風險 |

**php.ini**：

```ini
session.cookie_secure = 1      ; 網站必須是全站 HTTPS
session.cookie_httponly = 1
session.cookie_samesite = Lax
```

**或在程式中（PHP 7.3 以上）**，於 `session_start()` 之前：

```php
session_set_cookie_params([
    'secure'   => true,
    'httponly' => true,
    'samesite' => 'Lax',
]);
session_start();
```

**虛擬主機無法改 php.ini 時**，可以在 `.htaccess`（Apache + mod_php）：

```apache
php_flag session.cookie_secure On
php_flag session.cookie_httponly On
php_value session.cookie_samesite Lax
```

> ⚠️ 若網站還有部分頁面使用 http（非 https），開啟 `Secure` 後這些頁面會無法維持登入。請先將全站改為 HTTPS。

---

## 3. 隱藏 PHP 版本號

**報告中會出現**：`Header 回報 PHP/x.y.z` 或 `X-Powered-By: PHP...`

**php.ini**：

```ini
expose_php = Off
```

修改後重新啟動網頁伺服器或 PHP-FPM：

```bash
# 依你的環境擇一
sudo systemctl restart apache2
sudo systemctl restart php8.3-fpm
```

---

## 4. 隱藏網頁伺服器版本號

**報告中會出現**：`Server 標頭公開軟體版本`

**Apache**（`apache2.conf` 或 `httpd.conf`）：

```apache
ServerTokens Prod
ServerSignature Off
```

設定後 `Server` 標頭只會顯示 `Apache`。

**nginx**（`nginx.conf` 的 `http` 區塊）：

```nginx
server_tokens off;
```

**IIS**：在 `web.config` 的 `<system.webServer>` 中：

```xml
<security>
  <requestFiltering removeServerHeader="true" />
</security>
```

---

## 5. WordPress / Drupal / Joomla 等 CMS

**報告中會出現**：`Cookie WordPress`、`HTML 含 wp-content`、`Generator: ...` 等

CMS 本身沒有問題，但請確認：

- **核心、佈景主題、外掛 / 模組都更新到最新版**（大部分 CMS 入侵事件來自過期外掛）
- 移除沒有在使用的外掛與佈景主題
- 管理員帳號使用強密碼，並開啟兩步驟驗證

**移除 WordPress 的 generator 版本標籤**，在佈景主題的 `functions.php` 加入：

```php
remove_action('wp_head', 'wp_generator');
```

---

## 6. 修改 session cookie 名稱

**報告中會出現**：`Cookie PHPSESSID`

**php.ini**：

```ini
session.name = MYSITESESS
```

或在程式 `session_start()` 之前：

```php
session_name('MYSITESESS');
```

> 修改後所有使用者的登入狀態會失效一次，需要重新登入。

---

## 修正後怎麼確認

修改完設定後，可以再執行一次檢查：

```bash
phpcheck https://你的網站
```

或在瀏覽器按 F12 → **網路（Network）** → 重新整理 → 點第一個請求 → 查看**回應標頭（Response Headers）**，確認 `X-Powered-By`、`Server`、`Set-Cookie` 的內容。
