export const home = "./pages/query-user.html";

// 嵌套路由下侧栏常驻：切换动画不带位移，只有轻微淡入淡出，
// 避免 layout（左侧导航）跟着内容一起滑动
export const pageAnime = {
  current: {
    opacity: 1,
  },
  next: {
    opacity: 0,
  },
  previous: {
    opacity: 0,
  },
};
