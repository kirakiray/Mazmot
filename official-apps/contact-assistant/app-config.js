const _appParams = new URLSearchParams(location.search);
const _hashQuery = location.hash.includes("?")
  ? location.hash.split("?")[1]
  : "";
new URLSearchParams(_hashQuery).forEach((value, key) => {
  if (!_appParams.has(key)) _appParams.set(key, value);
});
const spaceId = _appParams.get("spaceId") || "";
const hostUserId = _appParams.get("hostUserId") || "";
const hasVisitorParams = !!(spaceId && hostUserId);

console.log("[contact-assistant] app-config params:", {
  search: location.search,
  hash: location.hash,
  spaceId,
  hostUserId,
  hasVisitorParams,
});

export const home = hasVisitorParams
  ? "./pages/visitor.html"
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
