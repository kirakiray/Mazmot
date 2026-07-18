// run-app 入口不能直接 init "mazmot"，因为 NoneOS Core 可能尚未安装，
// 页面模块内嵌 <nos-version auto-install> 自行完成 Core 初始化后再动态使用 /nos/fs。
export const home = "./run-app.html";

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
