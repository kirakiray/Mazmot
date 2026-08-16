/**
 * 基于 supplier 层的 Agent 封装：工具循环（createAgent）、工具定义（tool）、会话记忆（MemorySaver）。
 * 本层为纯函数库，不依赖 /nos/*；assistant 实例由调用方通过 /ai/main.js 的 getAssistant() 传入。
 */
export { createAgent } from "./agent.js";
export { tool, toolsToWire, findTool } from "./tools.js";
export { MemorySaver } from "./memory.js";
