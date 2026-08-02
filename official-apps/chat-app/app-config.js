// chat-app app-config.js
// 角色判定：URL 含 host 参数 → 接收方（customer）；否则 → 发起方（host）
// 与 ping-pong 模板一致，兼容 hash 里的 query 参数（o-app 路由跳转场景）
const _appParams = new URLSearchParams(location.search);
const _hashQuery = location.hash.includes("?")
  ? location.hash.split("?")[1]
  : "";
new URLSearchParams(_hashQuery).forEach((value, key) => {
  if (!_appParams.has(key)) _appParams.set(key, value);
});
const hostUserId = _appParams.get("host") || "";
const isCustomer = !!hostUserId;

console.log("[chat-app] app-config 初始化:", {
  search: location.search,
  hash: location.hash,
  hostUserId,
  role: isCustomer ? "customer" : "host",
});

export const home = isCustomer
  ? "./pages/customer.html"
  : "./pages/home.html";

export const pageAnime = {
  current: {
    opacity: 1,
    transform: "translate(0, 0)",
  },
  next: {
    opacity: 0,
    transform: "translate(30px, 0)",
  },
  previous: {
    opacity: 0,
    transform: "translate(-30px, 0)",
  },
};
