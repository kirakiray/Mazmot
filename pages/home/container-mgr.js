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
 * 寻找真正可用的容器端口（自动跳过本地已用和被其他域名占用的容器）
 * @param {Array} apps - 当前本地已有的应用列表
 * @returns {Promise<number|null>}
 */
export async function findTrulyAvailablePort(apps) {
  const localUsedPorts = new Set(
    apps
      .map((app) => extractPort(app.containerUrl))
      .filter((p) => p !== null),
  );

  for (const port of CONTAINER_PORTS) {
    // 1. 首先跳过本地数据库已经记录使用的端口
    if (localUsedPorts.has(port)) continue;

    // 2. 对物理容器进行“打招呼”探测
    try {
      const occupier = await checkContainerOccupancy(port);
      if (!occupier) {
        // 只有真正闲置的容器才返回
        return port;
      }
      // 如果被占用（无论是不是自己域名），因为 localUsedPorts 没记，说明本地状态不一致或被其他系统占用，跳过
      console.warn(`容器端口 ${port} 物理状态已被占用，尝试下一个...`);
    } catch (err) {
      // 探测失败（如容器服务未启动）也跳过
      console.error(`探测容器端口 ${port} 失败：`, err);
    }
  }

  return null;
}

/**
 * 读取目录中的所有文件（递归扁平化）
 * @param {Object} handle - 目录句柄（noneos-core DirHandle 或 FileSystemDirectoryHandle）
 * @returns {Promise<Array<{ path: string, content: string }>>}
 */
export async function readAppFiles(handle) {
  if (!handle) return [];

  // 尝试获取 client 目录句柄，如果不存在则回退到根目录（兼容旧应用或非标准结构）
  let targetHandle = handle;
  try {
    const clientDir = await handle.get("client");
    // noneos-core 的 DirHandle.kind 返回 "dir"，不是 "directory"
    if (clientDir && clientDir.kind === "dir") {
      targetHandle = clientDir;
    }
  } catch (err) {
    // client 目录不存在，继续使用原始句柄
    console.warn("未发现 client 目录，将从根目录读取文件");
  }

  const allFiles = await targetHandle.flat();
  // flat() 返回的 f.path 是从 targetHandle 的 root 追溯而来的完整路径，
  // 首段是 root.name（不一定就是 targetHandle.name），因此要用 targetHandle.path
  // 作为前缀剥掉，让容器收到相对 targetHandle 的相对路径（如 "index.html"）。
  const rootPrefix = targetHandle.path ? targetHandle.path + "/" : "";
  const files = await Promise.all(
    allFiles.map(async (f) => {
      let p = f.path;
      if (rootPrefix && p.startsWith(rootPrefix)) {
        p = p.slice(rootPrefix.length);
      }
      return { path: p, content: await f.text() };
    }),
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
  iframe.src = `${containerUrl}/_install.html`;
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
 * @param {string} appName - 占用的应用名称
 * @param {number} [timeout=60000] - 超时时间（ms），首次安装需要较长时间
 * @returns {Promise<boolean>}
 */
export function pushFilesToContainer(
  port,
  files,
  appName,
  timeout = 60000,
) {
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
        // 校验占用逻辑
        if (msg.occupier) {
          const currentOrigin = window.location.origin;
          if (
            msg.occupier.parentOrigin !== currentOrigin ||
            msg.occupier.name !== appName
          ) {
            settled = true;
            cleanup();
            reject(
              new Error(
                `容器已被来自 "${msg.occupier.parentOrigin}" 的应用 "${msg.occupier.name}" 占用`,
              ),
            );
            return;
          }
        }

        // 容器就绪，发送文件
        try {
          iframe.contentWindow.postMessage(
            { type: "install", files, appName },
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
  return `${containerUrl}/_install.html?mode=run`;
}

/**
 * 主动检查容器的占用情况（打招呼）
 * @param {number} port
 * @param {number} [timeout=10000]
 * @returns {Promise<{ name: string, parentOrigin: string, time: number }|null>} 返回占用者信息，null 表示闲置
 */
export function checkContainerOccupancy(port, timeout = 10000) {
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
        if (!settled) {
          settled = true;
          cleanup();
          resolve(msg.occupier || null);
        }
      } else if (msg.type === "error") {
        if (!settled) {
          settled = true;
          cleanup();
          reject(new Error(msg.message || "容器检查失败"));
        }
      }
    }

    window.addEventListener("message", handler);

    timer = setTimeout(() => {
      if (!settled) {
        settled = true;
        cleanup();
        reject(new Error("容器连接超时"));
      }
    }, timeout);
  });
}
