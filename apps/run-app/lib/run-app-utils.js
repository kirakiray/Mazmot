// run-app 页面模块的纯工具函数（不依赖 DOM / 网络 / ofa.js），
// 抽出以便进行单元测试。run-app.html 通过 load(...) 加载并在 proto 里调用。

/**
 * 生成「n/N · 描述」前缀的状态文本。
 * stepIndex 超出 [1, totalSteps] 范围时，直接返回原文本。
 * @param {string|null|undefined} text - 状态描述
 * @param {number} stepIndex - 当前步骤（1-based）
 * @param {number} totalSteps - 总步骤数
 * @returns {string}
 */
export function formatStatus(text, stepIndex, totalSteps) {
  const label = text == null ? "" : String(text);
  if (stepIndex >= 1 && stepIndex <= totalSteps) {
    return `${stepIndex}/${totalSteps} · ${label}`;
  }
  return label;
}

/**
 * 把错误对象拼装成便于开发者查阅的多行文本，
 * 含 name / message / code / cause / stack；兼容非 Error 抛出物。
 * @param {any} err
 * @returns {string}
 */
/**
 * 清除 stack trace 中 ofa.js 注入的超长 base64 data URL，
 * 替换为 `data:text/javascript;base64,<前8字符>…<后8字符>` 的短形式，
 * 便于开发者仍能识别是哪个模块，同时不刷屏。
 * @param {string} stack
 * @returns {string}
 */
function cleanStack(stack) {
  if (!stack) return stack;
  return stack.replace(
    /(data:text\/javascript;base64,)([A-Za-z0-9+/=]{200,})/g,
    (_, prefix, body) => {
      const head = body.slice(0, 8);
      const tail = body.slice(-8);
      return `${prefix}${head}…${tail}`;
    },
  );
}

export function buildErrorDetail(err) {
  if (err == null) return "";
  const parts = [];
  if (err && err.name) parts.push(`name: ${err.name}`);
  if (err && err.message) parts.push(`message: ${err.message}`);
  if (err && err.code != null) parts.push(`code: ${err.code}`);
  if (err && err.cause) {
    try {
      parts.push(
        "cause: " +
          (err.cause instanceof Error
            ? cleanStack(err.cause.stack || err.cause.message)
            : JSON.stringify(err.cause)),
      );
    } catch (_) {
      parts.push("cause: " + String(err.cause));
    }
  }
  if (err && err.stack) {
    parts.push("");
    parts.push(cleanStack(err.stack));
  } else if (!(err instanceof Error)) {
    // 非 Error 抛出物：尽量序列化
    try {
      parts.push("raw: " + JSON.stringify(err));
    } catch (_) {
      parts.push("raw: " + String(err));
    }
  }
  return parts.join("\n");
}

/**
 * 把「应用阶段」旧刻度 5-100 线性映射到 coreEnd-100。
 * 主要给 appProgress 用；旧刻度越界会自动 clamp 到 5-100。
 * @param {number} oldPct
 * @param {number} coreEnd - Core 阶段占用的进度上界（如 40）
 * @returns {number}
 */
export function mapAppProgress(oldPct, coreEnd) {
  const clamped = Math.max(5, Math.min(100, oldPct));
  return coreEnd + ((clamped - 5) / 95) * (100 - coreEnd);
}

/**
 * Core 安装阶段的进度映射：把 step/total 映射到 6..coreEnd。
 * total <= 0 或非法时返回 6。
 * @param {number} step
 * @param {number} total
 * @param {number} coreEnd
 * @returns {number}
 */
export function mapCoreInstallProgress(step, total, coreEnd) {
  const s = Number(step) || 0;
  const t = Number(total) || 0;
  const ratio = t > 0 ? Math.min(1, s / t) : 0;
  return 6 + Math.floor(ratio * (coreEnd - 6));
}

/**
 * 在 apps 列表里查找与 payload 对应的本地记录。
 * 优先按 appId 匹配；兼容老数据用 name === payload.appId 的历史行为。
 * @param {Array} apps
 * @param {Object} payload
 * @returns {Object|null}
 */
export function findAppRecord(apps, payload) {
  if (!Array.isArray(apps) || !payload) return null;
  return (
    apps.find(
      (a) =>
        (a.appId && a.appId === payload.appId) ||
        (a.name && a.name === payload.appId),
    ) || null
  );
}

/**
 * 过滤出「与本次分享无关」的其它应用（用于确认弹窗）。
 * @param {Array} apps
 * @param {Object} payload
 * @returns {Array}
 */
export function filterOtherApps(apps, payload) {
  if (!Array.isArray(apps)) return [];
  if (!payload) return apps.slice();
  return apps.filter(
    (a) =>
      !(
        (a.appId && a.appId === payload.appId) ||
        (a.name && a.name === payload.appId)
      ),
  );
}

/**
 * 把应用记录格式化为确认弹窗展示项：{ name, meta }。
 * meta 由「目录来源 · appId」拼接。
 * @param {Object} app
 * @returns {{ name: string, meta: string }}
 */
export function formatOtherAppEntry(app) {
  const parts = [];
  if (app) {
    if (app.source === "virtual") parts.push("虚拟目录");
    else if (app.source === "local") parts.push("本地目录");
    if (app.appId) parts.push(app.appId);
  }
  return {
    name: (app && app.name) || "（未命名）",
    meta: parts.join(" · "),
  };
}

/**
 * 在 apps 列表里查找 payloadHash 匹配的记录。
 * @param {Array} apps
 * @param {string} payloadHash
 * @returns {object|null}
 */
export function findByPayloadHash(apps, payloadHash) {
  if (!Array.isArray(apps) || !payloadHash) return null;
  return apps.find((a) => a.payloadHash === payloadHash) || null;
}

/**
 * 判断是否可以跳过下载安装、直接跳转到已装应用。
 * 命中条件：
 *  1) 已装记录存在，且本地记录的应用包哈希（fileHash）与分享清单一致
 *     —— 内容完全相同才跳过。不能用版本号判断：开发者更新内容却不改版本号时，
 *     版本号相同但内容（fileHash / 短链接 h）已变，必须重新安装。
 *  2) 或者分享者就是当前用户（自我分享）。
 * @param {Object|null} installed - { record, installedVersion } | null
 * @param {Object} payload
 * @param {boolean} isSelfShare
 * @returns {boolean}
 */
export function shouldSkipInstall(installed, payload, isSelfShare) {
  if (!installed) return false;
  const record = installed.record || {};
  const newFileHash = (payload && payload.fileHash) || "";
  if (record.fileHash && newFileHash && record.fileHash === newFileHash) {
    return true;
  }
  return !!isSelfShare;
}

/**
 * 把应用业务参数拼接到应用入口 URL 上。
 *
 * run-app 在跳转到最终应用入口时调用：u/h 已被剥离，这里只把 `appParams`
 * 透传给应用。baseUrl 可能已有自己的 query（极少见），此时用 `&` 衔接。
 *
 * @param {string} baseUrl - 应用入口 URL（如 /$ns/name/client/index.html）
 * @param {Object<string,string|number>|null|undefined} appParams - 从分享链接分离出的业务参数
 * @returns {string}
 */
export function buildAppUrlWithParams(baseUrl, appParams) {
  if (!appParams || typeof appParams !== "object") return baseUrl;
  const sp = new URLSearchParams();
  for (const [key, value] of Object.entries(appParams)) {
    if (value !== undefined && value !== null) {
      sp.append(key, String(value));
    }
  }
  const extra = sp.toString();
  if (!extra) return baseUrl;
  const sep = baseUrl.includes("?") ? "&" : "?";
  return baseUrl + sep + extra;
}
