// run-app 诊断信息采集器
// 目标：在用户端看不到 DevTools 的场景下，把 P2P 流程中的时间线、
// 连接路径、core 事件等旁证全部收集起来，出错时一次性拼进 errorDetail
// 供用户复制粘贴反馈。
// 纯数据 + 字符串处理，方便单测；网络/DOM 相关的取值都通过外部注入 remoteUser 等对象。

/**
 * 构造一个诊断上下文。用法：
 *   const diag = createDiag();
 *   diag.mark("connectUser done");
 *   diag.snapshot("pathOnConnect", { via: "rtc", rtt: 32 });
 *   diag.logEvent("server_reconnecting", { url: "..." });
 *   const text = diag.format();
 */
export function createDiag() {
  const t0 =
    typeof performance !== "undefined" && performance.now
      ? performance.now()
      : Date.now();
  const state = {
    t0,
    marks: [],
    events: [],
    snapshots: {},
  };
  return {
    _state: state,
    /**
     * 记录一次时间点。extra 可携带任意小对象，被 safeStringify 序列化后拼进输出。
     */
    mark(label, extra) {
      const now = _now();
      const last = state.marks[state.marks.length - 1];
      state.marks.push({
        label: String(label || ""),
        atMs: Math.round(now - state.t0),
        dMs: last ? Math.round(now - last._now) : 0,
        _now: now,
        extra: extra || null,
      });
    },
    /**
     * 记录一次 core 事件（server_disconnected / rtt_update 等）。
     */
    logEvent(name, detail) {
      state.events.push({
        atMs: Math.round(_now() - state.t0),
        name: String(name || ""),
        detail: safeCopy(detail),
      });
    },
    /**
     * 打上关键节点快照（例如 pathOnConnect / pathOnFail）。
     */
    snapshot(key, obj) {
      state.snapshots[key] = {
        atMs: Math.round(_now() - state.t0),
        ...safeCopy(obj || {}),
      };
    },
    /**
     * 拼接为人类可读的多行文本，便于粘进 errorDetail。
     */
    format() {
      return formatDiag(state);
    },
    /** 导出裸数据，便于单测 */
    dump() {
      return {
        t0: state.t0,
        marks: state.marks.map((m) => ({
          label: m.label,
          atMs: m.atMs,
          dMs: m.dMs,
          extra: m.extra,
        })),
        events: state.events.slice(),
        snapshots: JSON.parse(JSON.stringify(state.snapshots)),
      };
    },
  };
}

function _now() {
  return typeof performance !== "undefined" && performance.now
    ? performance.now()
    : Date.now();
}

/**
 * 从 remoteUser 采集一次连接路径信息（不抛异常）。
 * 返回 { via, url, rtt }；url 会自动降级为 host 以避免过长。
 * @param {object} remoteUser
 */
export function pathInfoOf(remoteUser) {
  if (!remoteUser || typeof remoteUser.getRTT !== "function") {
    return { via: "", url: "", rtt: null };
  }
  try {
    const r = remoteUser.getRTT();
    if (!r) return { via: "", url: "", rtt: null };
    let url = r.url || "";
    if (url) {
      try {
        url = new URL(url).host;
      } catch (_) {}
    }
    return {
      via: r.via || "",
      url,
      rtt: typeof r.rtt === "number" ? Math.round(r.rtt) : null,
    };
  } catch (err) {
    return { error: String((err && err.message) || err) };
  }
}

/**
 * 尝试拉一份 sessionId 列表（不抛异常）。
 */
export async function collectSessionIds(remoteUser) {
  if (!remoteUser || typeof remoteUser.getSessionIds !== "function") return [];
  try {
    const ids = await remoteUser.getSessionIds();
    return Array.isArray(ids) ? ids.slice() : [];
  } catch (_) {
    return [];
  }
}

/**
 * 读取 user.server.connectedUrls（不抛异常）。
 */
export function collectConnectedUrls(user) {
  try {
    const list =
      (user && user.server && user.server.connectedUrls) || [];
    return Array.isArray(list) ? list.slice() : [];
  } catch (_) {
    return [];
  }
}

/**
 * 深拷贝一份可 JSON 化的数据；遇到循环/不可序列化字段自动降级为字符串。
 */
export function safeCopy(obj) {
  if (obj == null) return obj;
  try {
    return JSON.parse(JSON.stringify(obj));
  } catch (_) {
    try {
      return String(obj);
    } catch (__) {
      return "[unserializable]";
    }
  }
}

/**
 * 把诊断 state 拼成多行文本。
 */
export function formatDiag(state) {
  const lines = [];
  const snap = state.snapshots || {};

  // ---- 快照区 ----
  if (snap.coreError) {
    const ce = snap.coreError;
    let line = `core error: phase=${ce.phase || "?"}`;
    if (ce.message) line += ` message=${ce.message}`;
    if (Array.isArray(ce.keys) && ce.keys.length > 0) {
      line += ` detailKeys=[${ce.keys.join(", ")}]`;
    }
    lines.push(line);
    if (ce.detail && Object.keys(ce.detail).length > 0) {
      lines.push("  detail: " + inlineExtra(ce.detail));
    }
  }
  if (snap.appManifest) {
    lines.push(
      `app manifest: ${snap.appManifest.chunks} chunks, size=${formatSize(
        snap.appManifest.fileSize,
      )}`,
    );
  }
  if (snap.payloadManifest) {
    lines.push(
      `payload manifest: ${snap.payloadManifest.chunks} chunks, size=${formatSize(
        snap.payloadManifest.fileSize,
      )}`,
    );
  }
  if (snap.pathOnConnect) {
    lines.push(`path @ connect: ${formatPath(snap.pathOnConnect)}`);
  }
  if (snap.pathOnFail) {
    lines.push(`path @ fail:    ${formatPath(snap.pathOnFail)}`);
    if (snap.pathOnFail.sessionIds !== undefined) {
      lines.push(
        `  sessionIds: [${(snap.pathOnFail.sessionIds || []).join(", ")}]`,
      );
    }
    if (snap.pathOnFail.connectedUrls !== undefined) {
      lines.push(
        `  connectedUrls: [${(snap.pathOnFail.connectedUrls || []).join(", ")}]`,
      );
    }
  }

  // ---- 时间线 ----
  if (state.marks.length > 0) {
    lines.push("");
    lines.push("timeline (ms from t0):");
    for (const m of state.marks) {
      let s = `  +${padLeft(String(m.atMs), 6)}  ${m.label}`;
      if (m.dMs) s += ` (Δ ${m.dMs}ms)`;
      if (m.extra) s += "  " + inlineExtra(m.extra);
      lines.push(s);
    }
  }

  // ---- Core 事件 ----
  if (state.events.length > 0) {
    lines.push("");
    lines.push("core events:");
    for (const e of state.events) {
      let s = `  +${padLeft(String(e.atMs), 6)}  ${e.name}`;
      if (e.detail && Object.keys(e.detail).length > 0) {
        s += "  " + inlineExtra(e.detail);
      }
      lines.push(s);
    }
  }

  return lines.join("\n");
}

function formatPath(p) {
  const parts = [];
  if (p.via) parts.push(p.via);
  if (p.url) parts.push(`url=${p.url}`);
  if (typeof p.rtt === "number") parts.push(`rtt=${p.rtt}ms`);
  if (p.error) parts.push(`error=${p.error}`);
  return parts.length > 0 ? parts.join(" ") : "(no path info)";
}

function inlineExtra(obj) {
  try {
    return JSON.stringify(obj);
  } catch (_) {
    return String(obj);
  }
}

function padLeft(str, n) {
  return str.length >= n ? str : " ".repeat(n - str.length) + str;
}

function formatSize(bytes) {
  const n = Number(bytes);
  if (!Number.isFinite(n) || n < 0) return "?";
  if (n < 1024) return `${n}B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)}KB`;
  return `${(n / (1024 * 1024)).toFixed(2)}MB`;
}
