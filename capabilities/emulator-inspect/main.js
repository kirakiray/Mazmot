export default async function inspect({ data = {}, content, emulator }) {
  const { xpath, depth = 1, maxSize = 1024 * 32 } = data;
  // 支持 extraStyles 或 extra-styles（HTML 属性会自动转为 camelCase）
  let extraStyles = data.extraStyles || "";

  // 解析 extraStyles：逗号分隔字符串
  if (typeof extraStyles === "string" && extraStyles.trim()) {
    extraStyles = extraStyles.split(",").map((s) => s.trim()).filter(Boolean);
  } else if (!Array.isArray(extraStyles)) {
    extraStyles = [];
  }

  if (!xpath) {
    throw new Error("xpath 参数是必需的");
  }

  const iframe = emulator.iframe;
  if (!iframe) {
    throw new Error("无法访问模拟器的 iframe");
  }

  // 获取模拟器的 document
  const emulatorDocument =
    iframe.contentDocument || iframe.contentWindow.document;

  if (!emulatorDocument) {
    throw new Error("无法访问模拟器的 document");
  }

  // 使用 XPath 查找元素
  const result = emulatorDocument.evaluate(
    xpath,
    emulatorDocument,
    null,
    XPathResult.FIRST_ORDERED_NODE_TYPE,
    null,
  );

  const element = result.singleNodeValue;

  if (!element) {
    throw new Error(`未找到匹配 XPath 的元素: ${xpath}`);
  }

  // 提取元素信息
  const info = getElementInfo(element, depth, extraStyles);

  if (JSON.stringify(info).length > maxSize) {
    throw new Error("返回数据大小超过最大限制");
  }

  return info;
}

/**
 * 获取元素的详细信息
 */
function getElementInfo(element, depth = 1, extraStyles = []) {
  // 过滤非空白子节点（元素节点 + 非空文本节点）
  const nonEmptyChildNodes = Array.from(element.childNodes).filter((node) => {
    if (node.nodeType === Node.TEXT_NODE) {
      return node.textContent.trim().length > 0;
    }
    return node.nodeType === Node.ELEMENT_NODE;
  });

  const info = {
    tag: element.tagName.toLowerCase(),
    attrs: {},
    childs: [],
    childsLength: nonEmptyChildNodes.length,
    childrenLength: element.children ? element.children.length : 0,
    text: "",
    styles: {},
    rect: {},
  };

  // 获取属性
  if (element.attributes) {
    for (const attr of element.attributes) {
      info.attrs[attr.name] = attr.value;
    }
  }

  // 获取子节点信息（包括元素节点和文本节点，保持原始顺序）
  if (depth > 0) {
    info.childs = nonEmptyChildNodes.map((node) => {
      if (node.nodeType === Node.TEXT_NODE) {
        return {
          type: "text",
          text: node.textContent.trim(),
        };
      } else {
        return getElementInfo(node, depth - 1, extraStyles);
      }
    });
  }

  // 获取所有文本内容（用于快速访问）
  info.text = nonEmptyChildNodes
    .filter((node) => node.nodeType === Node.TEXT_NODE)
    .map((node) => node.textContent.trim())
    .join(" ");

  // 获取计算样式
  try {
    const computedStyles = window.getComputedStyle(element);
    const defaultStyles = [
      "display",
      "position",
      "width",
      "height",
      "margin",
      "padding",
      "border",
      "background-color",
      "color",
      "font-size",
      "font-weight",
    ];
    // 合并默认样式和额外样式
    const allStyles = [...defaultStyles, ...extraStyles];
    allStyles.forEach((style) => {
      info.styles[style] = computedStyles.getPropertyValue(style);
    });
  } catch (e) {
    // 如果无法获取样式，忽略错误
  }

  // 获取元素位置和尺寸
  try {
    const rect = element.getBoundingClientRect();
    info.rect = {
      x: rect.x,
      y: rect.y,
      width: rect.width,
      height: rect.height,
      top: rect.top,
      left: rect.left,
      right: rect.right,
      bottom: rect.bottom,
    };
  } catch (e) {
    // 如果无法获取位置，忽略错误
  }

  return info;
}
