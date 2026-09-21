import { Assistant } from "./assistant.js";

// AI 转发服务器（server/ai-relay）客户端 Assistant。
// apiKey 字段保存的是完整邀请码：URL-safe Base64 的 JSON {"u": serverUrl, "k": bearkey}，
// 内部解出服务器地址与 bearkey 后以 OpenAI 兼容接口访问 /v1/*。

/**
 * 解码邀请码，返回 { baseUrl, bearkey }；格式非法返回 null。
 * 同时导出供 ai-manager 等 UI 做格式预校验 / 展示服务器地址。
 */
export const decodeInvite = (code) => {
  try {
    const raw = atob(
      code
        .trim()
        .replace(/-/g, "+")
        .replace(/_/g, "/")
        .padEnd(Math.ceil(code.trim().length / 4) * 4, "="),
    );
    const data = JSON.parse(raw);
    if (typeof data.u !== "string" || typeof data.k !== "string" || !data.u || !data.k) {
      return null;
    }
    return { baseUrl: data.u.replace(/\/+$/, ""), bearkey: data.k };
  } catch {
    return null;
  }
};

/**
 * 拉取转发服务器公开信息（命名）。
 * ai-manager 添加邀请码时调用，把命名随 key 持久化，供各应用选择 provider 时展示。
 */
export const fetchServerInfo = async (baseUrl) => {
  const resp = await fetch(`${baseUrl.replace(/\/+$/, "")}/v1/server`);
  if (!resp.ok) {
    throw new Error(`server info error: ${resp.status}`);
  }
  return resp.json(); // { name }
};

export class RelayAssistant extends Assistant {
  providerName = "relay";
  /** 邀请码解析结果（构造时填充） */
  #invite = null;
  /** NoneOS 用户身份上下文（懒加载，null = 当前环境拿不到用户身份） */
  #authPromise = null;

  constructor(id, apiKey) {
    super(id, apiKey);
    const invite = decodeInvite(apiKey ?? "");
    if (!invite) {
      throw new Error("relay 邀请码无效（应为服务器签发的 base64 邀请码）");
    }
    this.#invite = invite;
  }

  get baseUrl() {
    return this.#invite.baseUrl;
  }

  // ———— NoneOS 用户身份（邀请码用户绑定） ————

  /** SHA-256 hex（与 noneos get-hash.js 一致） */
  async #sha256Hex(text) {
    const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
    return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
  }

  /**
   * 拿当前 NoneOS 用户并完成一次激活（POST /v1/activate）。
   * 服务端 open 模式下激活是空操作；bound 模式下首次激活即绑定，之后请求靠签名头自证身份。
   * 任何失败（无用户体系 / 网络问题）都降级为无签名请求，仅 open 模式服务器可用。
   */
  async #initAuth() {
    const load = lm(import.meta);
    const { getUser } = await load("/nos/user/main.js");
    const user = await getUser();
    if (typeof user.sign !== "function") {
      throw new Error("当前用户无私钥（公钥模式），无法完成用户绑定");
    }
    const userId = user.userId;
    const signed = await user.sign({
      k: "relay-auth",
      userId,
      ts: Date.now(),
      method: "POST",
      path: "/v1/activate",
      bodyHash: "",
    });
    const resp = await fetch(`${this.baseUrl}/v1/activate`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.#invite.bearkey}`,
      },
      body: JSON.stringify(signed),
    });
    const data = await resp.json().catch(() => ({}));
    if (!resp.ok) {
      // 已被其他用户绑定（409）等：保留身份上下文但让后续请求自然失败并透出服务器原因
      throw new Error(data?.error?.message || `激活失败: ${resp.status}`);
    }
    return { user, userId, mode: data.mode || "open" };
  }

  /** 身份上下文（每实例只初始化一次；失败缓存为 null，不反复重试） */
  async #getAuth() {
    if (!this.#authPromise) {
      this.#authPromise = this.#initAuth().catch((error) => {
        console.warn("[relay] 用户身份初始化失败:", error?.message || error);
        return null;
      });
    }
    return this.#authPromise;
  }

  /** 构造 X-Relay-Auth 签名头；无身份上下文时返回空对象 */
  async #authHeaders(method, path, bodyText = "") {
    const auth = await this.#getAuth();
    if (!auth) return {};
    const signed = await auth.user.sign({
      k: "relay-auth",
      userId: auth.userId,
      ts: Date.now(),
      method,
      path,
      bodyHash: await this.#sha256Hex(bodyText),
    });
    return { "X-Relay-Auth": btoa(JSON.stringify(signed)) };
  }

  async chat({
    model = "deepseek-chat",
    stream = false,
    messages,
    onStream = null,
    signal,
    tools = null,
    toolChoice = null,
  }) {
    const requestBody = { model, stream, messages };
    if (tools?.length) {
      requestBody.tools = tools;
      requestBody.tool_choice = toolChoice ?? "auto";
    }
    const bodyText = JSON.stringify(requestBody);

    const response = await fetch(`${this.baseUrl}/v1/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.#invite.bearkey}`,
        ...(await this.#authHeaders("POST", "/v1/chat/completions", bodyText)),
      },
      body: bodyText,
      signal,
    });

    if (!response.ok) {
      throw await this._buildError(response);
    }

    if (stream) {
      return this.handleStreamResponse(response, onStream, signal);
    }

    const data = await response.json();
    return {
      content: data.choices[0].message.content,
      reasoningContent: data.choices[0].message.reasoning_content,
      toolCalls: data.choices[0].message.tool_calls || [],
      model: data.model,
      usage: data.usage,
      raw: data,
    };
  }

  async getModels() {
    const response = await fetch(`${this.baseUrl}/v1/models`, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${this.#invite.bearkey}`,
        ...(await this.#authHeaders("GET", "/v1/models")),
      },
    });
    if (!response.ok) {
      throw await this._buildError(response);
    }
    const data = await response.json();
    return data.data || data;
  }

  /**
   * 转发服务器无余额概念，getRemaining 返回 token 配额视角：
   * balances: [{ currency: "tokens", amount: 剩余 }]；无限配额 amount 为 null。
   */
  async getRemaining() {
    const response = await fetch(`${this.baseUrl}/v1/usage`, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${this.#invite.bearkey}`,
        ...(await this.#authHeaders("GET", "/v1/usage")),
      },
    });
    if (!response.ok) {
      throw await this._buildError(response);
    }
    const data = await response.json();
    return {
      balances: [
        {
          currency: "tokens",
          amount:
            data.quotaTokens == null
              ? null
              : Math.max(0, Number(data.quotaTokens) - Number(data.usedTokens || 0)),
          raw: data,
        },
      ],
      raw: data,
    };
  }
}

export default RelayAssistant;
