/**
 * 会话记忆：按 thread_id 保存消息，仅存于当前页面内存。
 * 需要跨页面 / 刷新后保留时，实现同样的 { get, set, delete } 异步接口即可替换
 * （如基于 /nos/storage 的存储实现）。
 */
export class MemorySaver {
  constructor() {
    this.threads = new Map();
  }

  /** 取某个 thread 的历史消息（深拷贝，外部修改不会污染内部状态） */
  async get(threadId) {
    return structuredClone(this.threads.get(threadId) ?? []);
  }

  async set(threadId, messages) {
    // 深拷贝落盘：与调用方（如 agent 的活动轨迹）彻底解耦引用
    this.threads.set(threadId, structuredClone(messages));
  }

  async delete(threadId) {
    return this.threads.delete(threadId);
  }

  clear() {
    this.threads.clear();
  }
}
