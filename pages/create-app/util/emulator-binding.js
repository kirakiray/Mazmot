// 用于绑定 iframe 和外部信息的工具
(async () => {
  window.addEventListener("message", (event) => {
    const { data } = event;

    if (data.type === "get-console") {
      debugger;
      return;
    }

    if (data.type === "clear-console") {
      // 清空 console 日志
      logs.length = 0;
      return;
    }

    if(data.type === "get-aimap"){}

    console.log("emulator-message", event);
  });

  const outerConsole = {};

  const logs = [];

  // 代理并记录所有的console 调用
  Object.keys(console).forEach((key) => {
    outerConsole[key] = (...args) => {
      if (key === "clear") {
        logs.length = 0;
      }
      logs.push({ key, args });
      console[key].apply(console, args);
    };
  });

  window.console = outerConsole;
})();
