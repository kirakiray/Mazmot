// 妙造隔离预览 —— /mz/ai/main.js 替身（仅预览域，经 receiver 注入的
// import map 顶替；妙造主容器与安装环境不受影响，仍加载真模块）。
//
// 导出面复刻生成应用被教的「应用侧常用 API」（见 mazmot-api skill
// references/ai.md）：getAssistant() → chat() / getModels()。内部全部经
// window.__MZ_BRIDGE__（bridge/inject.js 挂载）把调用转发给妙造主容器执行，
// key 与通道配置永不下发到预览域。
//
// ⚠️ 同步约束：本文件导出面、参数与返回结构与真模块的应用侧 API 保持一致；
// 改真模块应用侧用法（或 SYSTEM_PROMPT 教了新用法）时必须同步这里。
// 预览环境差异：model / 推理档位由妙造主容器当前选中项决定，guest 传入值
// 被忽略；key 管理 API 不可用（抛可读错误）。

// 等待 inject.js 挂载桥对象（inject.js 是更早执行的 module 脚本，正常早已
// 就绪；轮询兜底异步建链的窗口期）。超时说明本页未经妙造隔离预览打开。
const waitBridge = () =>
  new Promise((resolve, reject) => {
    if (globalThis.__MZ_BRIDGE__) return resolve(globalThis.__MZ_BRIDGE__);
    const t0 = Date.now();
    const timer = setInterval(() => {
      if (globalThis.__MZ_BRIDGE__) {
        clearInterval(timer);
        resolve(globalThis.__MZ_BRIDGE__);
      } else if (Date.now() - t0 > 8000) {
        clearInterval(timer);
        reject(
          new Error("预览能力桥不可用：请从妙造的「预览应用」打开本页（AI/联网能力经妙造主容器代理）"),
        );
      }
    }, 100);
  });

/** 替身 Assistant：与真模块实例的应用侧方法同形（provider/getModels/chat） */
class BridgeAssistant {
  get providerName() {
    return "bridge"; // 如实标注：实例来自妙造能力桥，不是任何真实供应商
  }

  async getModels() {
    const bridge = await waitBridge();
    const out = await bridge.call("ai.models", {}, { timeoutMs: 30_000 });
    return Array.isArray(out?.models) ? out.models : [];
  }

  async getRemaining() {
    throw new Error("预览环境不支持余额查询（getRemaining 仅在安装环境可用）");
  }

  /**
   * 与真模块 assistant.chat 同形：messages/thinking/stream/onStream/signal；
   * 返回 { content, reasoningContent, model, usage }（无 raw）。
   * model / reasoningEffort / thinkingKeep 由妙造主容器决定，传入值忽略。
   */
  async chat(opts = {}) {
    const messages = Array.isArray(opts.messages) ? opts.messages : null;
    if (!messages?.length) throw new Error("chat：messages 不能为空");
    const bridge = await waitBridge();
    const onStream = typeof opts.onStream === "function" ? opts.onStream : null;
    let content = "";
    let reasoning = "";
    const res = await bridge.call(
      "ai.chat",
      { messages, thinking: opts.thinking === true },
      {
        timeoutMs: 300_000,
        signal: opts.signal,
        onChunk: onStream
          ? (d) => {
              content += d.delta || "";
              reasoning += d.deltaReasoning || "";
              onStream({
                content,
                delta: d.delta || "",
                deltaReasoning: d.deltaReasoning || "",
                done: false,
              });
            }
          : null,
      },
    );
    // 流式回调最后一帧补 done（与真模块 onStream 负载一致）
    if (onStream) onStream({ content, delta: "", deltaReasoning: "", done: true });
    return {
      content: res?.content ?? content,
      reasoningContent: res?.reasoningContent ?? reasoning,
      model: res?.model ?? "",
      usage: res?.usage ?? null,
    };
  }
}

/** 拿替身实例（预览域全部经桥；id 参数无意义，接受并忽略以保持调用兼容） */
export const getAssistant = (_id) => new BridgeAssistant();

// ———— key 管理 API：预览域不支持（key 只存在于妙造主容器） ————

const unsupported = (name) => async () => {
  throw new Error(`预览环境不支持 key 管理（${name} 仅在妙造主应用可用）`);
};
export const saveKey = unsupported("saveKey");
export const removeKey = unsupported("removeKey");
export const updateKey = unsupported("updateKey");
export const setKeyDisabled = unsupported("setKeyDisabled");
export const testApiKey = unsupported("testApiKey");
export const getApiKeys = () => []; // 快照语义：预览域没有 key 可读
export const onApiKeysChange = () => () => {}; // 无变化可订阅
