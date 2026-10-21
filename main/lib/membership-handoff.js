// 会员购买成功 → 欢迎引导 Key 步骤的交接纯函数（不依赖 DOM / 网络）。
//
// 口径：邀请码在购买时由 synchratex 服务端签发，会员应用已把它写入本地 AI 配置；
// 这里不再发起任何网络校验（此前走 testApiKey 现场连服务器，曾因瞬时网络失败
// 把流程卡在 Key 步骤），只回答「要不要回填、回填什么」。

/**
 * 解码邀请码：URL-safe Base64 的 JSON `{"k": <bearkey>, "u": <服务器地址>}`，
 * 与 mz/ai/supplier/relay.js 的 decodeInvite 口径一致；格式不合法返回 null。
 */
export function decodeInvitePayload(code) {
  try {
    const text = String(code || "").trim();
    if (!text) return null;
    const normalized = text.replace(/-/g, "+").replace(/_/g, "/");
    const raw = atob(normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "="));
    const data = JSON.parse(raw);
    if (!data || typeof data.u !== "string" || !data.u) return null;
    if (typeof data.k !== "string" || !data.k) return null;
    return { u: data.u, k: data.k };
  } catch {
    return null;
  }
}

/**
 * 计算购买完成后的交接动作。
 * @param {{inviteCode?: string, serverName?: string}} purchase
 *        会员应用 `membership-purchased` 事件负载
 * @param {{keyReady?: boolean, keySaving?: boolean}} state
 *        welcome Key 步骤当前状态（已有可用 Key / 正在保存时不覆盖）
 * @returns {{provider: "relay", key: string, serverName: string, serverUrl: string} | null}
 *          null 表示不回填
 */
export function membershipHandoff(purchase, state) {
  if (!purchase || typeof purchase.inviteCode !== "string" || !purchase.inviteCode) {
    return null;
  }
  if (state && (state.keyReady || state.keySaving)) return null;
  const invite = decodeInvitePayload(purchase.inviteCode);
  if (!invite) return null;
  return {
    provider: "relay",
    key: purchase.inviteCode.trim(),
    serverName: typeof purchase.serverName === "string" ? purchase.serverName : "",
    serverUrl: invite.u,
  };
}
