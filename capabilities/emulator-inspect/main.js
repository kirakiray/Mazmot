export default async function inspect({ data = {}, content, emulator }) {
  // 将参数转换为正确的类型
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
  const info = getElementInfo(element, depth, styles, includeRect);

  if (JSON.stringify(info).length > maxSize) {
    throw new Error("返回数据大小超过最大限制");
  }

  return info;
}

/**
 * 获取元素的详细信息
 */
function getElementInfo(element, depth = 1, styles = [], includeRect = true) {
  const tag = element.tagName.toLowerCase();

  // style 和 script 元素不获取子文本节点内容
  const skipTextContent = tag === "style" || tag === "script";

  // 过滤非空白子节点（元素节点 + 非空文本节点）
  const nonEmptyChildNodes = Array.from(element.childNodes).filter((node) => {
    if (node.nodeType === Node.TEXT_NODE) {
      // style/script 元素跳过文本节点
      if (skipTextContent) {
        return false;
      }
      return node.textContent.trim().length > 0;
    }
    return node.nodeType === Node.ELEMENT_NODE;
  });

  const info = {
    tag,
    attrs: {},
    text: "",
  };

  // 只有传入 styles 参数才获取样式
  if (styles.length > 0) {
    info.styles = {};
  }

  // 只在最后一层（depth=0）才添加 childsLength 和 childrenLength
  // style 和 script 元素不需要这些字段
  if (depth === 0 && !skipTextContent) {
    info.childsLength = nonEmptyChildNodes.length;
    info.childrenLength = element.children ? element.children.length : 0;
  }

  // 获取属性
  if (element.attributes) {
    for (const attr of element.attributes) {
      info.attrs[attr.name] = attr.value;
    }
  }

  // 获取 Shadow DOM 信息（只有存在时才添加字段）
  if (element.shadowRoot) {
    const shadowChildren = Array.from(element.shadowRoot.children).filter(
      (node) => node.nodeType === Node.ELEMENT_NODE,
    );
    info.shadowRoot = {
      mode: element.shadowRoot.mode || "open",
      childsLength: shadowChildren.length,
      childs:
        depth > 0
          ? shadowChildren.map((node) =>
              getElementInfo(node, depth - 1, styles, includeRect),
            )
          : [],
    };
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
        return getElementInfo(node, depth - 1, styles, includeRect);
      }
    });
  }

  // style 和 script 元素不获取 text 内容（避免返回大量无用信息）
  if (!skipTextContent) {
    // 获取所有文本内容（用于快速访问）
    info.text = nonEmptyChildNodes
      .filter((node) => node.nodeType === Node.TEXT_NODE)
      .map((node) => node.textContent.trim())
      .join(" ");
  }

  // 只有传入 styles 参数才获取计算样式
  if (styles.length > 0) {
    try {
      const computedStyles = window.getComputedStyle(element);
      styles.forEach((style) => {
        info.styles[style] = computedStyles.getPropertyValue(style);
      });
    } catch (e) {
      // 如果无法获取样式，忽略错误
    }
  }

  // style 和 script 元素不需要 rect 信息，其他元素根据 includeRect 参数决定
  if (!skipTextContent && includeRect) {
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
  }

  return info;
}
