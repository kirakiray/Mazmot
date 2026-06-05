export default async function inspect({ data = {}, emulator }) {
  const xpath = data.xpath;
  const depth = data.depth !== undefined ? Number(data.depth) : 1;
  const maxSize = data.maxSize !== undefined ? Number(data.maxSize) : 1024 * 32;
  // rect 默认开启，只有明确传 false 或 "false" 才关闭
  const includeRect = data.rect !== false && data.rect !== "false";

  // 解析 styles 参数：逗号分隔字符串
  let styles = data.styles || "";
  if (typeof styles === "string" && styles.trim()) {
    styles = styles
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
  } else if (!Array.isArray(styles)) {
    styles = [];
  }

  if (!xpath) {
    throw new Error("xpath 参数是必需的");
  }

  try {
    const result = await sendMessage(emulator.iframe, {
      type: "inspect-element",
      xpath,
      depth,
      maxSize,
      styles,
      includeRect,
    });
    return result;
  } catch (err) {
    throw new Error(err.message);
  }
}

function sendMessage(iframe, message) {
  return new Promise((resolve, reject) => {
    if (!iframe || !iframe.contentWindow) {
      reject(new Error("Iframe not available"));
      return;
    }

    const channel = new MessageChannel();
    const timeout = setTimeout(() => {
      reject(new Error("Message timeout"));
    }, 5000);

    channel.port1.onmessage = (event) => {
      clearTimeout(timeout);
      if (event.data.error) {
        reject(new Error(event.data.error));
      } else {
        resolve(event.data.result);
      }
    };

    iframe.contentWindow.postMessage(message, "*", [channel.port2]);
  });
}