const params = new URLSearchParams(location.search);
const spaceId = params.get("spaceId") || "";
const hostUserId = params.get("hostUserId") || "";
const hasVisitorParams = spaceId && hostUserId;

console.log("[contact-assistant] app-config query:", {
  search: location.search,
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
