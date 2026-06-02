// 用于绑定 iframe 和外部信息的工具
(async () => {
  window.addEventListener("message", (event) => {
    const { data, ports } = event;

    if (data.type === "get-console") {
      const port = ports[0];
      if (port) {
        port.postMessage({ result: logs.slice() });
      }
      return;
    }

    if (data.type === "clear-console") {
      logs.length = 0;
      const port = ports[0];
      if (port) {
        port.postMessage({ result: true });
      }
      return;
    }
  });

  const outerConsole = {};

  const logs = [];

  const originConsole = console;

  Object.keys(console).forEach((key) => {
    outerConsole[key] = (...args) => {
      if (key === "clear") {
        logs.length = 0;
      }
      logs.push({ key, args });
      originConsole[key].apply(originConsole, args);
    };
  });

  window.console = outerConsole;
})();
