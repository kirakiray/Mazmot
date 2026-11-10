"use strict";

// 静态服务器单元测试（Node 原生 test runner，不依赖 Electron）：
//   npm test
// 覆盖 projectR 的 Rust 单测同等语义：路径解析 / 穿越拦截 / MIME / Range /
// ETag 304 / 404.html / 目录 308 / Host 校验 / 方法限制。

const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const http = require("node:http");
const os = require("node:os");
const path = require("node:path");

const { StaticServer, parseRange, mimeOf } = require("../src/static-server");

let server;
let port;
let fixture;
let root;

function request(rawPath, { method = "GET", headers = {} } = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        host: "127.0.0.1",
        port,
        path: rawPath,
        method,
        headers: { host: `127.0.0.1:${port}`, ...headers },
      },
      (res) => {
        const chunks = [];
        res.on("data", (chunk) => chunks.push(chunk));
        res.on("end", () =>
          resolve({
            status: res.statusCode,
            headers: res.headers,
            body: Buffer.concat(chunks).toString("utf8"),
          }),
        );
      },
    );
    req.on("error", reject);
    req.end();
  });
}

before(async () => {
  fixture = fs.mkdtempSync(path.join(os.tmpdir(), "mazmot-static-test-"));
  root = path.join(fixture, "site");
  fs.mkdirSync(path.join(root, "sub"), { recursive: true });
  fs.writeFileSync(path.join(root, "index.html"), "<h1>home</h1>");
  fs.writeFileSync(path.join(root, "404.html"), "<h1>not found page</h1>");
  fs.writeFileSync(path.join(root, "app.js"), "console.log(1);\n");
  fs.writeFileSync(path.join(root, "range.txt"), "0123456789");
  fs.writeFileSync(path.join(root, "sub", "index.html"), "<h1>sub</h1>");
  fs.writeFileSync(path.join(fixture, "secret.txt"), "top secret");

  server = new StaticServer({ root, version: "9.9.9", label: "test" });
  const bound = await server.start(0);
  assert.ok(bound, "服务器应成功启动");
  port = bound.port;
});

after(async () => {
  if (server) await server.stop();
  if (fixture) fs.rmSync(fixture, { recursive: true, force: true });
});

test("根路径返回 index.html 与运行时标记头", async () => {
  const res = await request("/");
  assert.equal(res.status, 200);
  assert.match(res.body, /home/);
  assert.equal(res.headers["content-type"], "text/html; charset=utf-8");
  assert.equal(res.headers["cache-control"], "no-cache");
  assert.equal(res.headers["x-mazmot-runtime"], "9.9.9");
  assert.ok(res.headers.etag);
});

test("ETag 命中返回 304 且无 body", async () => {
  const first = await request("/app.js");
  const res = await request("/app.js", {
    headers: { "if-none-match": first.headers.etag },
  });
  assert.equal(res.status, 304);
  assert.equal(res.body, "");
  assert.equal(res.headers.etag, first.headers.etag);
});

test("HEAD 返回 Content-Length 但不发送 body", async () => {
  const res = await request("/app.js", { method: "HEAD" });
  assert.equal(res.status, 200);
  assert.equal(res.headers["content-type"], "text/javascript; charset=utf-8");
  assert.equal(
    Number(res.headers["content-length"]),
    Buffer.byteLength("console.log(1);\n"),
  );
  assert.equal(res.body, "");
});

test("未命中路径按 404 状态返回顶层 404.html", async () => {
  const res = await request("/no-such-file");
  assert.equal(res.status, 404);
  assert.match(res.body, /not found page/);
  assert.equal(res.headers["content-type"], "text/html; charset=utf-8");
});

test("目录缺尾斜杠 308 补全并保留 query", async () => {
  const res = await request("/sub?x=1");
  assert.equal(res.status, 308);
  assert.equal(res.headers.location, "/sub/?x=1");
});

test("目录带尾斜杠返回 index.html", async () => {
  const res = await request("/sub/");
  assert.equal(res.status, 200);
  assert.match(res.body, /sub/);
});

test("Host 非回环主机返回 403", async () => {
  const res = await request("/", { headers: { host: "evil.example.com" } });
  assert.equal(res.status, 403);
  assert.match(res.body, /forbidden host/);
});

test("非 GET/HEAD 方法返回 405", async () => {
  const res = await request("/app.js", { method: "POST" });
  assert.equal(res.status, 405);
});

test("目录穿越被拦截", async () => {
  const res = await request("/%2e%2e/secret.txt");
  assert.equal(res.status, 404);
  assert.ok(!res.body.includes("top secret"));
});

test("单区间 Range 返回 206 与 Content-Range", async () => {
  const res = await request("/range.txt", { headers: { range: "bytes=2-5" } });
  assert.equal(res.status, 206);
  assert.equal(res.body, "2345");
  assert.equal(res.headers["content-range"], "bytes 2-5/10");
});

test("后缀 Range（bytes=-3）返回末尾三字节", async () => {
  const res = await request("/range.txt", { headers: { range: "bytes=-3" } });
  assert.equal(res.status, 206);
  assert.equal(res.body, "789");
});

test("多区间 Range 按 200 全量返回", async () => {
  const res = await request("/range.txt", {
    headers: { range: "bytes=0-1,4-5" },
  });
  assert.equal(res.status, 200);
  assert.equal(res.body, "0123456789");
});

test("parseRange 边界", () => {
  assert.deepEqual(parseRange("bytes=0-0", 10), [0, 0]);
  assert.deepEqual(parseRange("bytes=5-", 10), [5, 9]);
  assert.equal(parseRange("bytes=20-30", 10), null);
  assert.equal(parseRange("bytes=0-1,2-3", 10), null);
  assert.equal(parseRange("0-1", 10), null);
});

test("MIME 映射与站点资源类型一致", () => {
  assert.equal(mimeOf("a.HTML"), "text/html; charset=utf-8");
  assert.equal(mimeOf("a.mjs"), "text/javascript; charset=utf-8");
  assert.equal(mimeOf("a.json"), "application/json; charset=utf-8");
  assert.equal(mimeOf("a.wasm"), "application/wasm");
  assert.equal(mimeOf("a.unknown"), "application/octet-stream");
});
