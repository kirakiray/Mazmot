/**
 * Mazmot 宿主离线缓存引擎（接管原 noneos-core host-cache 职责）
 *
 * 由根 sw.js 在 importScripts core dist.js 之后加载（fetch 兜底位）。
 * 清单 /cache-manifest.json 由 scripts/update-cache-manifest.js 构建时生成：
 *   { name, version, hashes: [{ path, hash, size }] }
 * version 是 hashes 内容的 SHA-256 前 8 位（内容派生，无需手工 bump）。
 *
 * 更新算法：SW 启动 / 页面 message ping 时拉取清单（no-store），version 变化则
 * 新建 mazmot-host-v<version> 缓存——旧缓存中 hash 相同的条目直接搬运（重验字节
 * hash），其余网络拉取并逐字节验 hash；任一失败即放弃、旧版继续服务（原子切换）。
 *
 * 经 <script src> 引入时（非 SW 环境，如测试页）只暴露 globalThis.MZHostCache
 * 纯函数，不注册任何事件监听。
 */
(() => {
  "use strict";

  const MANIFEST_URL = "/cache-manifest.json";
  const CACHE_PREFIX = "mazmot-host-v";
  const MANIFEST_STORAGE_KEY = "/__mz-manifest__";
  const LEGACY_OPFS_DIR = "host-cache"; // 旧 core 机制写在 OPFS 的目录，activate 时清理

  // ---------- 环境 ----------
  // SW 内 location.href 即 scriptURL（含查询参数）；页面环境则是页面 URL
  const mzParams = new URLSearchParams(location.search);
  const mzForceEnabled = mzParams.get("mzcache") === "1";
  const mzIsLocalhost = ["localhost", "127.0.0.1", "[::1]"].includes(
    location.hostname,
  );
  const mzEnabled = mzForceEnabled || !mzIsLocalhost;
  const mzInSW =
    typeof ServiceWorkerGlobalScope !== "undefined" &&
    globalThis instanceof ServiceWorkerGlobalScope;

  // ---------- 基础工具 ----------
  const mzTextEncoder = new TextEncoder();

  async function sha256Hex(source) {
    const bytes =
      typeof source === "string" ? mzTextEncoder.encode(source) : new Uint8Array(source);
    const digest = await crypto.subtle.digest("SHA-256", bytes);
    return [...new Uint8Array(digest)]
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");
  }

  // version 派生规则（与 scripts/update-cache-manifest.js 保持一致）
  async function deriveVersion(manifest) {
    const hash = await sha256Hex(JSON.stringify(manifest.hashes));
    return hash.slice(0, 8);
  }

  function validateManifest(manifest) {
    if (!manifest || typeof manifest !== "object") {
      throw new Error("manifest: not an object");
    }
    if (typeof manifest.name !== "string" || !manifest.name) {
      throw new Error("manifest: invalid name");
    }
    if (typeof manifest.version !== "string" || !/^[\w.-]{1,32}$/.test(manifest.version)) {
      throw new Error("manifest: invalid version");
    }
    if (!Array.isArray(manifest.hashes) || manifest.hashes.length === 0) {
      throw new Error("manifest: hashes must be a non-empty array");
    }
    const seen = new Set();
    for (const entry of manifest.hashes) {
      if (!entry || typeof entry.path !== "string" || entry.path.startsWith("/")) {
        throw new Error(`manifest: invalid path ${JSON.stringify(entry?.path)}`);
      }
      if (!/^[0-9a-f]{64}$/.test(entry.hash)) {
        throw new Error(`manifest: invalid hash for ${entry.path}`);
      }
      if (!Number.isInteger(entry.size) || entry.size < 0) {
        throw new Error(`manifest: invalid size for ${entry.path}`);
      }
      if (seen.has(entry.path)) {
        throw new Error(`manifest: duplicate path ${entry.path}`);
      }
      seen.add(entry.path);
    }
  }

  // URL → 清单内路径（"index.html" / "mz/xxx.js"）；"/" 视作 index.html
  function matchPath(url) {
    let pathname = url.pathname;
    if (pathname === "/") pathname = "/index.html";
    if (!pathname.startsWith("/")) return null;
    return pathname.slice(1);
  }

  function hasPath(manifest, path) {
    return manifest.hashes.some((entry) => entry.path === path);
  }

  // ---------- 更新 ----------
  let mzActive = null; // { cacheName, manifest }
  let mzReadyPromise = null;
  let mzUpdatePromise = null;

  function mzReady() {
    if (!mzReadyPromise) {
      mzReadyPromise = mzInit();
    }
    return mzReadyPromise;
  }

  async function mzInit() {
    try {
      await mzUpdateCheck();
    } catch (err) {
      // 清单拉取失败（离线）或构建失败：回退到本地已有的最新缓存
      console.warn("[mz-cache] update failed, fallback:", err?.message || err);
      const adopted = await adoptExistingCache();
      if (adopted) {
        mzActive = adopted;
      } else {
        throw err; // 完全无缓存，fetch 全部放行走网络
      }
    }
  }

  async function readManifest() {
    const res = await fetch(MANIFEST_URL, { cache: "no-store" });
    if (!res.ok) {
      throw new Error(`manifest fetch ${res.status}`);
    }
    const manifest = await res.json();
    validateManifest(manifest);
    const derived = await deriveVersion(manifest);
    if (derived !== manifest.version) {
      throw new Error(`manifest version mismatch: ${manifest.version} != ${derived}`);
    }
    return manifest;
  }

  // 离线兜底：找本地已有缓存里 x-stored-at 最新的那份
  async function adoptExistingCache() {
    const names = (await caches.keys()).filter((n) => n.startsWith(CACHE_PREFIX));
    let best = null;
    for (const name of names) {
      try {
        const cache = await caches.open(name);
        const res = await cache.match(MANIFEST_STORAGE_KEY);
        if (!res) continue;
        const storedAt = Number(res.headers.get("x-stored-at") || 0);
        const manifest = await res.json();
        validateManifest(manifest);
        if (!best || storedAt > best.storedAt) {
          best = { cacheName: name, manifest, storedAt };
        }
      } catch (err) {
        console.warn(`[mz-cache] skip broken cache ${name}:`, err?.message || err);
      }
    }
    return best;
  }

  // 增量构建：返回新缓存名；任何一步失败抛错（调用方保证旧缓存不受影响）
  async function buildCache(manifest, old) {
    const cacheName = CACHE_PREFIX + manifest.version;
    const newCache = await caches.open(cacheName);
    const oldEntries = new Map((old?.manifest?.hashes || []).map((h) => [h.path, h]));

    for (const entry of manifest.hashes) {
      const key = "/" + entry.path;
      let stored = false;

      // 增量搬运：旧缓存有同 hash 条目时零网络复用（重验字节 hash 兜底）
      const prev = oldEntries.get(entry.path);
      if (old && prev && prev.hash === entry.hash) {
        const oldCache = await caches.open(old.cacheName);
        const prevRes = await oldCache.match(key);
        if (prevRes) {
          const bytes = await prevRes.clone().arrayBuffer();
          if ((await sha256Hex(bytes)) === entry.hash) {
            await newCache.put(key, prevRes);
            stored = true;
          }
        }
      }

      if (!stored) {
        const res = await fetch(key, { cache: "reload" });
        if (!res.ok) {
          throw new Error(`${entry.path}: HTTP ${res.status}`);
        }
        const bytes = await res.arrayBuffer();
        if ((await sha256Hex(bytes)) !== entry.hash) {
          throw new Error(`${entry.path}: hash mismatch`);
        }
        const headers = new Headers();
        const contentType = res.headers.get("content-type");
        if (contentType) headers.set("content-type", contentType);
        await newCache.put(key, new Response(bytes, { status: 200, headers }));
      }
    }

    // 清单快照存入缓存，供离线 adopt 与版本新旧判断
    await newCache.put(
      MANIFEST_STORAGE_KEY,
      new Response(JSON.stringify(manifest), {
        headers: {
          "content-type": "application/json",
          "x-stored-at": String(Date.now()),
        },
      }),
    );
    return cacheName;
  }

  async function mzActivate(cacheName, manifest) {
    mzActive = { cacheName, manifest };
    const names = await caches.keys();
    await Promise.all(
      names
        .filter((n) => n.startsWith(CACHE_PREFIX) && n !== cacheName)
        .map((n) => caches.delete(n)),
    );
  }

  async function mzUpdateCheck() {
    if (mzUpdatePromise) return mzUpdatePromise;
    mzUpdatePromise = (async () => {
      try {
        const manifest = await readManifest();
        const cacheName = CACHE_PREFIX + manifest.version;
        if (mzActive?.cacheName === cacheName) return; // 已是最新
        const old = mzActive || (await adoptExistingCache());
        const builtName = await buildCache(manifest, old);
        await mzActivate(builtName, manifest);
        console.info(`[mz-cache] active ${builtName} (${manifest.hashes.length} files)`);
      } finally {
        mzUpdatePromise = null;
      }
    })();
    return mzUpdatePromise;
  }

  // ---------- fetch / message / activate ----------
  async function mzServe(path, request) {
    try {
      await mzReady();
    } catch {
      return fetch(request); // 无缓存可用，走网络
    }
    if (!mzActive?.manifest || !hasPath(mzActive.manifest, path)) {
      return fetch(request);
    }
    const cache = await caches.open(mzActive.cacheName);
    return (await cache.match("/" + path, { ignoreSearch: true })) || fetch(request);
  }

  if (mzInSW && mzEnabled) {
    self.addEventListener("fetch", (event) => {
      const url = new URL(event.request.url);
      if (url.origin !== location.origin) return;
      const path = matchPath(url);
      if (!path) return;
      event.respondWith(mzServe(path, event.request));
    });

    // 页面 ping（apps/main visibilitychange）触发更新检查，3s 防抖合并
    let mzPingTimer = null;
    self.addEventListener("message", (event) => {
      if (event.data?.type !== "mz-cache-check") return;
      clearTimeout(mzPingTimer);
      mzPingTimer = setTimeout(() => {
        mzUpdateCheck().catch((err) => {
          console.warn("[mz-cache] update check failed:", err?.message || err);
        });
      }, 3000);
    });

    // 清理旧 core host-cache 机制遗留的 OPFS 目录
    self.addEventListener("activate", (event) => {
      event.waitUntil(
        (async () => {
          try {
            const root = await navigator.storage.getDirectory();
            await root.removeEntry(LEGACY_OPFS_DIR, { recursive: true });
          } catch {
            // 目录不存在（已清理过）等场景静默
          }
        })(),
      );
    });

    mzReady(); // SW 启动即检查
  }

  // ---------- 测试 / 外部调试入口 ----------
  globalThis.MZHostCache = {
    sha256Hex,
    deriveVersion,
    validateManifest,
    matchPath,
    hasPath,
    buildCache,
    updateCheck: mzUpdateCheck,
    state: () => ({ enabled: mzEnabled, inSW: mzInSW, active: mzActive }),
  };
})();
