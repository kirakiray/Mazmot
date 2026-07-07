// 容器管理模块
// 负责容器端口分配、文件读取、与容器页面的 postMessage 通信

// 5 个独立容器端口（对应 scripts/static.js 中的配置）
export const CONTAINER_PORTS = [40031, 40032, 40033, 40034, 40035];

// 容器主机地址（开发环境固定为 localhost）
const CONTAINER_HOST = "localhost";

/**
 * 根据端口号获取容器 URL
 * @param {number} port
 * @returns {string}
 */
export function getContainerUrl(port) {
  return `http://${CONTAINER_HOST}:${port}`;
}

/**
 * 从容器 URL 中提取端口号
 * @param {string} url
 * @returns {number|null}
 */
export function extractPort(url) {
  if (!url) return null;
  const match = url.match(/:(\d+)\/?$/);
  return match ? parseInt(match[1], 10) : null;
}

/**
 * 获取可用的容器端口
 * @param {Array} apps - 当前已注册的应用列表（来自 ever-cache）
 * @returns {number|null} 可用端口号，null 表示无可用容器
 */
export function getAvailablePort(apps) {
  const usedPorts = new Set(
    apps
      .map((app) => extractPort(app.containerUrl))
      .filter((p) => p !== null),
  );
  for (const port of CONTAINER_PORTS) {
    if (!usedPorts.has(port)) return port;
  }
  return null;
}

/**
 * 读取挂载目录中的所有文件（递归扁平化）
 * @param {string} mountPath - 挂载路径（如 $mount-xxx）
 * @returns {Promise<Array<{ path: string, content: string }>>}
 */
export async function readAppFiles(mountPath) {
  const { get } = await import("/nos/fs/main.js");
  const dir = await get(mountPath);
  if (!dir) return [];

  const allFiles = await dir.flat();
  const prefix = mountPath + "/";
  const files = await Promise.all(
    allFiles.map(async (f) => ({
      path: f.path.startsWith(prefix)
        ? f.path.slice(prefix.length)
        : f.path,
      content: await f.text(),
    })),
  );
  return files;
}

/**
 * 创建隐藏 iframe 与容器通信
 * @param {number} port
 * @returns {{ iframe: HTMLIFrameElement, destroy: () => void }}
 */
function createContainerIframe(port) {
  const containerUrl = getContainerUrl(port);
  const iframe = document.createElement("iframe");
  iframe.style.display = "none";
  iframe.src = `${containerUrl}/index.html`;
  document.body.appendChild(iframe);

  return {
    iframe,
    destroy() {
      if (iframe.parentNode) {
        iframe.parentNode.removeChild(iframe);
      }
    },
  };
}

/**
 * 通过隐藏 iframe 向容器推送文件
 * @param {number} port - 容器端口
 * @param {Array<{ path: string, content: string }>} files - 文件列表
 * @param {number} [timeout=60000] - 超时时间（ms），首次安装需要较长时间
 * @returns {Promise<boolean>}
 */
export function pushFilesToContainer(port, files, timeout = 60000) {
  return new Promise((resolve, reject) => {
    const containerUrl = getContainerUrl(port);
    const { iframe, destroy } = createContainerIframe(port);

    let timer = null;
    let settled = false;

    function cleanup() {
      if (timer) clearTimeout(timer);
      window.removeEventListener("message", handler);
      destroy();
    }

    function handler(event) {
      if (event.origin !== containerUrl) return;
      const msg = event.data;
      if (!msg || !msg.type) return;

      if (msg.type === "ready") {
        // 容器就绪，发送文件
        try {
          iframe.contentWindow.postMessage(
            { type: "install", files },
            containerUrl,
          );
        } catch (e) {
          if (!settled) {
            settled = true;
            cleanup();
            reject(new Error("发送文件到容器失败：" + e.message));
          }
        }
      } else if (msg.type === "install-done") {
        if (!settled) {
          settled = true;
          cleanup();
          resolve(true);
        }
      } else if (msg.type === "error") {
        if (!settled) {
          settled = true;
          cleanup();
          reject(new Error(msg.message || "容器安装失败"));
        }
      }
    }

    window.addEventListener("message", handler);

    timer = setTimeout(() => {
      if (!settled) {
        settled = true;
        cleanup();
        reject(
          new Error(
            "容器通信超时（可能是首次安装 NoneOS Core 耗时较长，请重试）",
          ),
        );
      }
    }, timeout);
  });
}

/**
 * 清空容器中的所有文件（用于删除应用时释放容器）
 * @param {number} port
 * @param {number} [timeout=30000]
 * @returns {Promise<boolean>}
 */
export function clearContainer(port, timeout = 30000) {
  return new Promise((resolve) => {
    const containerUrl = getContainerUrl(port);
    const { iframe, destroy } = createContainerIframe(port);

    let timer = null;
    let settled = false;

    function cleanup() {
      if (timer) clearTimeout(timer);
      window.removeEventListener("message", handler);
      destroy();
    }

    function handler(event) {
      if (event.origin !== containerUrl) return;
      const msg = event.data;
      if (!msg || !msg.type) return;

      if (msg.type === "ready") {
        try {
          iframe.contentWindow.postMessage({ type: "clear" }, containerUrl);
        } catch (e) {}
      } else if (msg.type === "clear-done" || msg.type === "error") {
        if (!settled) {
          settled = true;
          cleanup();
          resolve(true);
        }
      }
    }

    window.addEventListener("message", handler);

    timer = setTimeout(() => {
      if (!settled) {
        settled = true;
        cleanup();
        resolve(false); // 超时不报错，删除操作仍然继续
      }
    }, timeout);
  });
}

/**
 * 获取应用的运行 URL（在新窗口中打开此 URL 即可运行应用）
 * @param {string} containerUrl
 * @returns {string}
 */
export function getRunUrl(containerUrl) {
  return `${containerUrl}/index.html?mode=run`;
}
