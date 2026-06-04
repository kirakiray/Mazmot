export default async function inspect({ data = {}, content, emulator }) {
  const { xpath, depth = 1 } = data;

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
  return getElementInfo(element, depth);
}

/**
 * 获取元素的详细信息
 */
function getElementInfo(element, depth = 1) {
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
        return getElementInfo(node, depth - 1);
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
    const importantStyles = [
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
    importantStyles.forEach((style) => {
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
