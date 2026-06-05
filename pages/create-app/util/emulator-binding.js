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

    if (data.type === "inspect-element") {
      const port = ports[0];
      try {
        const result = inspectElement(data);
        if (port) {
          port.postMessage({ result });
        }
      } catch (err) {
        if (port) {
          port.postMessage({ error: err.message });
        }
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

/**
 * 检查元素信息
 */
function inspectElement({ xpath, depth = 1, maxSize = 1024 * 32, styles = [], includeRect = true }) {
  if (!xpath) {
    throw new Error("xpath 参数是必需的");
  }

  // 使用 XPath 查找元素
  const result = document.evaluate(
    xpath,
    document,
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
