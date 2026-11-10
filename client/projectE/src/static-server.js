// Mazmot Desktop Runtime (Electron) — 内置静态文件服务器
//
// 与 projectR（Tauri）的 src-tauri/src/static_server.rs 行为对齐：把仓库根
// 目录（或打包后的 resources/site）当作静态站点伺服给 BrowserWindow。
//
// 不用自定义协议（file:// 与 app:// 下 Service Worker 无法注册），而是监听
// 回环端口的真实 HTTP 服务：
//   30031 = 主站 origin（主窗口；被占用时依次回退 30033-30036）
//   30032 = 隔离域 origin（conjure bridge，站点常量 BRIDGE_ORIGIN 硬编码）
// 端口与候选顺序必须与站点 scripts/static.js、projectR 保持一致——origin
// （含端口）跨启动稳定，SW 缓存与 IndexedDB 数据才不会丢。

"use strict";

const fs = require("node:fs");
const http = require("node:http");
const path = require("node:path");

/** 主站端口候选，第一个绑定成功者生效。30032 保留给 bridge。 */
const MAIN_PORTS = [30031, 30033, 30034, 30035, 30036];
/** bridge（隔离域）固定端口，绑定失败只降级 conjure 预览。 */
const BRIDGE_PORT = 30032;
/** 回环主机名白名单（Host 头校验，防 DNS rebinding） */
const LOOPBACK_HOSTS = ["localhost", "127.0.0.1", "[::1]"];

/** Host 头匹配：`localhost` / `localhost:30031` / `127.0.0.1:30031` / `[::1]:30031` */
function hostMatches(value) {
  if (!value) return false;
  return LOOPBACK_HOSTS.some((allowed) => {
    if (value.toLowerCase() === allowed) return true;
    const idx = value.lastIndexOf(":");
    if (idx < 0) return false;
    const host = value.slice(0, idx);
    const port = value.slice(idx + 1);
    return (
      host.toLowerCase() === allowed &&
      port.length > 0 &&
      /^[0-9]+$/.test(port)
    );
  });
}

/** 单区间 Range：bytes=a-b（b 可省略）；返回闭区间 [start, end]，不合法返回 null */
function parseRange(value, total) {
  if (typeof value !== "string") return null;
  const spec = value.trim().replace(/^bytes=/i, "");
  if (spec === value.trim() || spec.includes(",")) return null;
  const dash = spec.indexOf("-");
  if (dash < 0) return null;
  const a = spec.slice(0, dash).trim();
  const b = spec.slice(dash + 1).trim();

  if (a === "") {
    const n = Number(b);
    if (!Number.isInteger(n) || n <= 0 || total === 0) return null;
    return [Math.max(0, total - n), total - 1];
  }
  const start = Number(a);
  if (!Number.isInteger(start) || start < 0 || start >= total) return null;
  const end = b === "" ? total - 1 : Math.min(Number(b), total - 1);
  if (!Number.isInteger(end) || end < start) return null;
  return [start, end];
}

/** 与 projectR 的 mime_of 保持一致（顺序无关，穷举常见静态资源类型） */
function mimeOf(filePath) {
  const ext = path.extname(filePath).slice(1).toLowerCase();
  switch (ext) {
    case "html":
      return "text/html; charset=utf-8";
    case "js":
    case "mjs":
      return "text/javascript; charset=utf-8";
    case "css":
      return "text/css; charset=utf-8";
    case "json":
    case "webmanifest":
    case "map":
      return "application/json; charset=utf-8";
    case "txt":
    case "md":
    case "toml":
      return "text/plain; charset=utf-8";
    case "svg":
      return "image/svg+xml";
    case "png":
      return "image/png";
    case "jpg":
    case "jpeg":
      return "image/jpeg";
    case "gif":
      return "image/gif";
    case "webp":
      return "image/webp";
    case "avif":
      return "image/avif";
    case "ico":
      return "image/x-icon";
    case "wasm":
      return "application/wasm";
    case "xml":
      return "application/xml; charset=utf-8";
    case "woff":
      return "font/woff";
    case "woff2":
      return "font/woff2";
    case "ttf":
      return "font/ttf";
    case "otf":
      return "font/otf";
    case "mp4":
      return "video/mp4";
    case "webm":
      return "video/webm";
    case "mp3":
      return "audio/mpeg";
    case "wav":
      return "audio/wav";
    case "ogg":
      return "audio/ogg";
    default:
      return "application/octet-stream";
  }
}

// mtime(秒)-len 十六进制，与 Rust 侧 etag_of 输出一致
function etagOf(stat) {
  const mtime = Math.floor(stat.mtimeMs / 1000);
  return `"${mtime.toString(16)}-${stat.size.toString(16)}"`;
}

function safeDecode(rawPath) {
  try {
    return decodeURIComponent(rawPath);
  } catch {
    return null;
  }
}

/**
 * 单个进程内的一组回环静态服务器（IPv4 必须成功，IPv6 尽力而为）。
 * 每个端口对应两个 http.Server，共用同一个请求处理器。
 */
class StaticServer {
  /**
   * @param {{root: string, version: string, label?: string}} options
   */
  constructor({ root, version, label = "main" }) {
    this.root = path.resolve(root);
    this.rootReal = this.root;
    this.version = version;
    this.label = label;
    this.servers = [];
    this.port = null;
    this._handler = this._handle.bind(this);
  }

  async start(port) {
    try {
      this.rootReal = await fs.promises.realpath(this.root);
      const stat = await fs.promises.stat(this.rootReal);
      if (!stat.isDirectory()) throw new Error("站点根不是目录");
    } catch (err) {
      console.error(
        `[mazmot-runtime] 站点根不可用：${this.root}（${err.message}）`,
      );
      return null;
    }

    // 先绑 IPv4，取实际端口后再以同一端口补 IPv6，保证双栈同 origin
    const v4 = http.createServer(this._handler);
    try {
      this.port = await listenOn(v4, port, "127.0.0.1");
    } catch (err) {
      console.error(`[mazmot-runtime] 端口 ${port} 绑定失败：${err.message}`);
      await closeServer(v4);
      return null;
    }
    this.servers.push(v4);

    const v6 = http.createServer(this._handler);
    try {
      await listenOn(v6, this.port, "::1");
      this.servers.push(v6);
    } catch (err) {
      console.error(
        `[mazmot-runtime] IPv6 回环 :${this.port} 绑定失败（仅 IPv4 可用）：${err.message}`,
      );
      await closeServer(v6);
    }

    for (const server of this.servers) {
      const address = server.address();
      const host = address.family === "IPv6" ? `[${address.address}]` : address.address;
      console.error(
        `[mazmot-runtime] 静态服务器已启动：http://${host}:${this.port}（${this.label}，站点根 ${this.rootReal}）`,
      );
    }
    return { port: this.port };
  }

  async stop() {
    const servers = this.servers.splice(0);
    await Promise.all(servers.map(closeServer));
    this.port = null;
  }

  async _handle(req, res) {
    try {
      await this._serve(req, res);
    } catch (err) {
      console.error("[mazmot-runtime] 静态服务器请求异常", err);
      if (!res.headersSent) {
        this._send(res, 500, "text/plain; charset=utf-8", "internal error");
      } else {
        res.destroy();
      }
    }
  }

  async _serve(req, res) {
    // DNS rebinding 防护：Host 必须是回环主机名（带或不带端口均可）
    if (!hostMatches(req.headers.host)) {
      this._send(res, 403, "text/plain; charset=utf-8", "forbidden host");
      return;
    }

    const method = req.method;
    if (method !== "GET" && method !== "HEAD") {
      this._send(res, 405, "text/plain; charset=utf-8", "method not allowed");
      return;
    }

    const url = req.url || "/";
    const qIndex = url.indexOf("?");
    const rawPath = qIndex < 0 ? url : url.slice(0, qIndex);
    const query = qIndex < 0 ? "" : url.slice(qIndex);

    const resolved = await this._resolve(rawPath);
    if (resolved.type === "file") {
      await this._serveFile(req, res, resolved.path, method);
      return;
    }
    if (resolved.type === "dir") {
      if (rawPath.endsWith("/")) {
        await this._serveFile(req, res, resolved.index, method);
      } else {
        // 目录 URL 规范化：缺尾斜杠时 308（页面内相对路径依赖目录形态）
        this._redirect(res, `${rawPath.replace(/\/+$/, "")}/${query}`);
      }
      return;
    }

    // 镜像 Cloudflare Pages 行为：存在顶层 404.html 时按 404 状态返回它。
    // 禁止 SPA 式回退 200（会掩盖资源缺失）。
    let body = Buffer.from("404");
    try {
      body = await fs.promises.readFile(path.join(this.rootReal, "404.html"));
    } catch {
      /* 没有 404.html 时用纯文本兜底 */
    }
    this._send(res, 404, "text/html; charset=utf-8", body);
  }

  /** @returns {Promise<{type:"file",path:string}|{type:"dir",index:string}|{type:"notfound"}>} */
  async _resolve(rawPath) {
    const decoded = safeDecode(rawPath);
    if (decoded === null) return { type: "notfound" };

    const rel = decoded.replace(/^\/+/, "");
    if (rel.split(/[/\\]/).some((seg) => seg === "..")) {
      return { type: "notfound" };
    }

    const target = rel === "" ? this.rootReal : path.join(this.rootReal, rel);
    let canonical;
    try {
      canonical = await fs.promises.realpath(target);
    } catch {
      return { type: "notfound" };
    }
    // 软链/规范路径必须仍在站点根下
    if (
      canonical !== this.rootReal &&
      !canonical.startsWith(this.rootReal + path.sep)
    ) {
      return { type: "notfound" };
    }

    let stat;
    try {
      stat = await fs.promises.stat(canonical);
    } catch {
      return { type: "notfound" };
    }

    if (stat.isDirectory()) {
      const index = path.join(canonical, "index.html");
      try {
        const indexStat = await fs.promises.stat(index);
        if (indexStat.isFile()) return { type: "dir", index };
      } catch {
        /* 目录无 index.html */
      }
      return { type: "notfound" };
    }
    if (stat.isFile()) return { type: "file", path: canonical };
    return { type: "notfound" };
  }

  async _serveFile(req, res, filePath, method) {
    let stat;
    try {
      stat = await fs.promises.stat(filePath);
    } catch {
      this._send(res, 404, "text/plain; charset=utf-8", "404");
      return;
    }

    const etag = etagOf(stat);
    const ctype = mimeOf(filePath);
    const total = stat.size;

    // 条件请求：ETag 未变返回 304
    const inm = req.headers["if-none-match"];
    if (typeof inm === "string") {
      const hit = inm
        .split(",")
        .map((tag) => tag.trim())
        .some((tag) => tag === etag || tag === `W/${etag}`);
      if (hit) {
        res.writeHead(304, {
          ETag: etag,
          "Cache-Control": "no-cache",
          "X-Mazmot-Runtime": this.version,
        });
        res.end();
        return;
      }
    }

    const baseHeaders = {
      "Content-Type": ctype,
      "Accept-Ranges": "bytes",
      ETag: etag,
      "Cache-Control": "no-cache",
      "X-Mazmot-Runtime": this.version,
    };

    if (method === "HEAD") {
      res.writeHead(200, { ...baseHeaders, "Content-Length": total });
      res.end();
      return;
    }

    const range = parseRange(req.headers.range, total);
    if (range) {
      const [start, end] = range;
      res.writeHead(206, {
        ...baseHeaders,
        "Content-Length": end - start + 1,
        "Content-Range": `bytes ${start}-${end}/${total}`,
      });
      pipeFile(filePath, { start, end }, res);
      return;
    }

    res.writeHead(200, { ...baseHeaders, "Content-Length": total });
    pipeFile(filePath, null, res);
  }

  _redirect(res, location) {
    res.writeHead(308, {
      Location: location,
      "Content-Length": 0,
    });
    res.end();
  }

  _send(res, status, ctype, body) {
    const buf = Buffer.isBuffer(body) ? body : Buffer.from(String(body));
    res.writeHead(status, {
      "Content-Type": ctype,
      "Content-Length": buf.length,
      "X-Mazmot-Runtime": this.version,
    });
    res.end(buf);
  }
}

function listenOn(server, port, host) {
  return new Promise((resolve, reject) => {
    const onError = (err) => {
      server.removeListener("listening", onListening);
      reject(err);
    };
    const onListening = () => {
      server.removeListener("error", onError);
      const address = server.address();
      resolve(typeof address === "object" && address ? address.port : port);
    };
    server.once("error", onError);
    server.once("listening", onListening);
    server.listen({ port, host, exclusive: true });
  });
}

function closeServer(server) {
  return new Promise((resolve) => {
    if (!server.listening) {
      resolve();
      return;
    }
    if (typeof server.closeAllConnections === "function") {
      server.closeAllConnections();
    }
    server.close(() => resolve());
  });
}

function pipeFile(filePath, range, res) {
  const stream = fs.createReadStream(filePath, range || undefined);
  stream.on("error", (err) => {
    console.error("[mazmot-runtime] 读取文件失败", filePath, err);
    if (!res.headersSent) res.writeHead(500);
    res.destroy();
  });
  stream.pipe(res);
}

module.exports = {
  StaticServer,
  MAIN_PORTS,
  BRIDGE_PORT,
  LOOPBACK_HOSTS,
  hostMatches,
  parseRange,
  mimeOf,
  etagOf,
  listenOn,
};
