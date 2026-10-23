const assert = require("assert");
const fs = require("fs");
const http = require("http");
const path = require("path");
const vm = require("vm");
const { execFile } = require("child_process");
const { promisify } = require("util");

const root = path.resolve(__dirname, "..");
const source = fs.readFileSync(path.join(root, "php check.js"), "utf8");
const drupal = "SESS" + "a".repeat(32) + "=fixture; path=/";
let failures = 0;

function load(globals = {}) {
  const context = vm.createContext(globals);
  vm.runInContext(source, context, { filename: "php check.js", timeout: 1000 });
  return context;
}

function response(status = 200, headers = {}, html = "") {
  return { getResponseCode: () => status, getAllHeaders: () => headers, getContentText: () => html };
}

function fixture(main, index = response(404), fake = response(404)) {
  const calls = [];
  const context = load({ UrlFetchApp: { fetch(url) {
    calls.push(url);
    return url.includes("/zz-not-exist-") ? fake : url.endsWith("/index.php") ? index : main;
  } } });
  return { context, calls, result: context.checkPhpSite("https://fixture.example/") };
}

async function test(name, run) {
  try {
    await run();
    console.log("PASS " + name);
  } catch (error) {
    failures++;
    console.error("FAIL " + name + ": " + error.message);
  }
}

async function main() {
  await test("200k nonmatching HTML completes within the analysis budget", () => {
    const result = vm.runInContext('analyzeResponse_({}, "x".repeat(200000))', load(), { timeout: 1000 });
    assert.strictEqual(result.score, 0);
  });
  await test("WordPress paths remain weak fingerprints", () => {
    for (const directory of ["wp-content", "WP-INCLUDES"]) {
      const result = load().analyzeResponse_({}, '<img src="https://assets.example/' + directory + '/logo.png">');
      assert.strictEqual(result.score, 2);
      assert.ok(result.evidence.some(e => e.includes("WordPress")));
    }
  });
  await test("multiple static HTML fingerprints cannot accumulate certainty", () => {
    const html = '<meta name="generator" content="WordPress"><img src="/wp-content/logo.png"><a href="/about.php">About</a>';
    const analyzed = load().analyzeResponse_({}, html, "https://fixture.example/");
    assert.strictEqual(analyzed.score, 2);
    assert.strictEqual(analyzed.evidence.length, 3);
    const { result } = fixture(response(200, {}, html), response(200));
    assert.strictEqual(result.result, "可能是 PHP");
  });
  await test("a .php link plus a 200/404 probe stays possible", () => {
    const { result } = fixture(response(200, {}, '<a href="/about.php">About</a>'), response(200));
    assert.strictEqual(result.result, "可能是 PHP");
    assert.ok(result.evidence.some(e => e.includes("/index.php")));
  });
  await test("repeated Drupal cookies across responses stay possible", () => {
    const { result } = fixture(response(200, { "Set-Cookie": drupal }), response(200), response(404, { "Set-Cookie": drupal }));
    assert.strictEqual(result.result, "可能是 PHP");
    assert.ok(result.evidence.some(e => e.startsWith("404 頁")));
  });
  await test("cookie values and unrelated name suffixes are not fingerprints", () => {
    for (const cookie of ["tracking=PHPSESSID=fixture", "myPHPSESSID=fixture", "tracking=laravel_session=fixture", "tracking=wordpress_logged_in=fixture", "tracking=" + drupal]) {
      const result = load().analyzeResponse_({ "Set-Cookie": cookie }, "");
      assert.strictEqual(result.score, 0, cookie);
      assert.ok(!result.details.some(d => d.label === "Session cookie 缺少安全屬性"));
    }
  });
  await test("real session names still match and cookie values stay masked", () => {
    for (const name of ["PHPSESSID", "laravel_session", "ci_session", "wordpress_logged_in_hash", "wp-settings-1"]) {
      const result = load().analyzeResponse_({ "Set-Cookie": "  " + name + "=private-session-value; path=/" }, "");
      assert.strictEqual(result.score, 3, name);
      assert.ok(!JSON.stringify(result.details).includes("private-session-value"));
    }
    for (const prefix of ["SESS", "SSESS"]) {
      assert.strictEqual(load().analyzeResponse_({ "Set-Cookie": prefix + "a".repeat(32) + "=fixture" }, "").score, 2);
    }
  });
  await test("PHP headers require a product token", () => {
    for (const value of ["NotPHP", "NotPHP/7.4.33", "PHPish", "Express"]) {
      assert.strictEqual(load().analyzeResponse_({ "X-Powered-By": value, Server: value }, "").score, 0, value);
    }
    assert.strictEqual(load().analyzeResponse_({ "X-Powered-By": "PHP" }, "").score, 3);
  });
  await test("the reported PHP version retains its actual header source", () => {
    const { result, calls } = fixture(response(200, { "X-Powered-By": "Express", Server: "Apache PHP/7.4.33" }));
    assert.strictEqual(result.result, "是 PHP");
    assert.strictEqual(result.version, "7.4.33");
    assert.strictEqual(result.details.find(d => d.label.startsWith("Header 回報 PHP/")).raw, "Server: Apache PHP/7.4.33");
    assert.strictEqual(calls.length, 1);
    assert.ok(!Object.prototype.hasOwnProperty.call(result, "score"));
  });
  await test("strong fingerprints found only on the 404 response still count", () => {
    const { result } = fixture(response(), response(404), response(404, { "X-Powered-By": "PHP/8.3.10" }));
    assert.strictEqual(result.result, "是 PHP");
    assert.strictEqual(result.version, "8.3.10");
  });
  await test("the Apps Script custom function keeps its result interface", () => {
    const { context } = fixture(response(200, {}, '<meta name="generator" content="WordPress">'));
    assert.strictEqual(context.ISPHP("https://fixture.example/"), "可能是 PHP");
    assert.strictEqual(context.ISPHP(""), "");
  });
  await test("real curl/CLI reports preserve structure, calibrated results and masking", async () => {
    const requests = [];
    const server = http.createServer((req, res) => {
      requests.push(req.url);
      if (req.url === "/strong") {
        res.writeHead(200, { Server: "Apache PHP/7.4.33", "X-Powered-By": "Express", "Set-Cookie": "PHPSESSID=private-session-value; path=/" });
        res.end("Hello");
      } else if (req.url === "/weak" || req.url === "/index.php") {
        res.end('<meta name="generator" content="WordPress"><img src="/wp-content/logo.png">');
      } else {
        res.writeHead(404);
        res.end("Not found");
      }
    });
    await new Promise((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", resolve);
    });
    try {
      const base = "http://127.0.0.1:" + server.address().port;
      const { stdout } = await promisify(execFile)(process.execPath, [path.join(root, "run-local.js"), base + "/weak", base + "/strong"], { timeout: 10000 });
      assert.match(stdout, /結果\s*：可能是 PHP/);
      assert.match(stdout, /結果\s*：是 PHP/);
      assert.ok(!stdout.includes("可以確定這個網站是用 PHP 執行的"));
      assert.ok(!stdout.includes("private-session-value"));
      assert.ok(stdout.includes("Server: Apache PHP/7.4.33"));
      for (const heading of ["PHP 網站檢查報告", "【伺服器資訊】", "【判斷依據】", "【其他安全觀察】", "【PHP 版本】", "【建議】"]) assert.ok(stdout.includes(heading), heading);
      assert.strictEqual(requests.filter(url => url === "/strong").length, 1);
    } finally {
      await new Promise(resolve => server.close(resolve));
    }
  });
  if (failures) process.exitCode = 1;
}

main().catch(error => { console.error(error); process.exitCode = 1; });
