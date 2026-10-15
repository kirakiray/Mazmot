// 启动页是对话子路由页（它声明 parent = "./pages/home.html" 布局壳）：
// boot 即 parent + child 双层渲染，回收站（trash.html）是并列的另一条子路由
export const home = "./pages/chat.html";

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
