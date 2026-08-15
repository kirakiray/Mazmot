/**
 * 会话记忆（对齐 LangGraph 的 MemorySaver）：按 thread_id 保存消息，仅存于当前页面内存。
 * 需要跨页面 / 刷新后保留时，实现同样的 { get, set, delete } 异步接口即可替换
 * （如基于 /nos/storage 的存储实现）。
 */
export class MemorySaver {
  constructor() {
    this.threads = new Map();
  }

  /** 取某个 thread 的历史消息（返回副本，外部修改不会污染内部状态） */
  async get(threadId) {
    return [...(this.threads.get(threadId) ?? [])];
  }

  async set(threadId, messages) {
    this.threads.set(threadId, [...messages]);
  }

  async delete(threadId) {
    return this.threads.delete(threadId);
  }

  clear() {
    this.threads.clear();
  }
}
