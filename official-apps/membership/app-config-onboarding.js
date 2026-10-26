// 仅用于 welcome 引导弹窗：给会员页显式标记 mode=onboarding，
// 让页面保留完整购买流程；安装后的独立应用走 app-config.js（无此参数），只显示账号概览。
export const home = "./pages/home.html?mode=onboarding";

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
