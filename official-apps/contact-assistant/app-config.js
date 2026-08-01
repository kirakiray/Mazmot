const params = new URLSearchParams(location.search);
const hasVisitorParams = params.get("spaceId") && params.get("hostUserId");

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
