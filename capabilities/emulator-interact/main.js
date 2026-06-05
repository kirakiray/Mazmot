export default async function emulatorInteract({ data = {}, emulator }) {
  const xpath = data.xpath;
  const action = data.action || "click";

  // 解析 value 参数（可能是 JSON 字符串）
  let value = data.value;
  if (typeof value === "string") {
    try {
      value = JSON.parse(value);
    } catch (e) {
      // 如果不是 JSON，保持原字符串
    }
  }

  // 解析 options 参数（可能是 JSON 字符串）
  let options = data.options || {};
  if (typeof options === "string") {
    try {
      options = JSON.parse(options);
    } catch (e) {
      options = {};
    }
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

  // 执行交互操作
  try {
    const actionResult = await performAction(element, action, value, options);
    return {
      success: true,
      action,
      xpath,
      ...actionResult,
    };
  } catch (err) {
    throw new Error(`执行操作失败: ${err.message}`);
  }
}

/**
 * 执行交互操作
 */
async function performAction(element, action, value, options) {
  switch (action) {
    case "click":
      return await clickElement(element, options);

    case "input":
      return await inputElement(element, value, options);

    case "focus":
      return focusElement(element);

    case "blur":
      return blurElement(element);

    case "scroll":
      return scrollElement(element, options);

    case "select":
      return selectElement(element, value, options);

    case "clear":
      return clearElement(element);

    case "hover":
      return hoverElement(element);

    case "getAttribute":
      return getAttribute(element, value);

    case "setValue":
      return setValue(element, value);

    default:
      throw new Error(`不支持的操作类型: ${action}`);
  }
}

/**
 * 点击元素
 */
async function clickElement(element, options = {}) {
  const { doubleClick = false, button = "left" } = options;

  // 滚动到元素可见
  element.scrollIntoView({ behavior: "smooth", block: "center" });

  // 等待滚动完成
  await new Promise((resolve) => setTimeout(resolve, 100));

  // 创建鼠标事件
  const rect = element.getBoundingClientRect();
  const centerX = rect.left + rect.width / 2;
  const centerY = rect.top + rect.height / 2;

  // 模拟鼠标移动
  const moveEvent = new MouseEvent("mousemove", {
    bubbles: true,
    cancelable: true,
    view: window,
    clientX: centerX,
    clientY: centerY,
  });
  element.dispatchEvent(moveEvent);

  // 模拟鼠标悬停
  const overEvent = new MouseEvent("mouseover", {
    bubbles: true,
    cancelable: true,
    view: window,
    clientX: centerX,
    clientY: centerY,
  });
  element.dispatchEvent(overEvent);

  // 模拟鼠标按下
  const downEvent = new MouseEvent("mousedown", {
    bubbles: true,
    cancelable: true,
    view: window,
    clientX: centerX,
    clientY: centerY,
    button: button === "right" ? 2 : button === "middle" ? 1 : 0,
  });
  element.dispatchEvent(downEvent);

  // 模拟鼠标释放
  const upEvent = new MouseEvent("mouseup", {
    bubbles: true,
    cancelable: true,
    view: window,
    clientX: centerX,
    clientY: centerY,
    button: button === "right" ? 2 : button === "middle" ? 1 : 0,
  });
  element.dispatchEvent(upEvent);

  // 模拟点击
  const clickEvent = new MouseEvent("click", {
    bubbles: true,
    cancelable: true,
    view: window,
    clientX: centerX,
    clientY: centerY,
    button: button === "right" ? 2 : button === "middle" ? 1 : 0,
  });
  element.dispatchEvent(clickEvent);

  // 如果是双击
  if (doubleClick) {
    await new Promise((resolve) => setTimeout(resolve, 50));
    const dblClickEvent = new MouseEvent("dblclick", {
      bubbles: true,
      cancelable: true,
      view: window,
      clientX: centerX,
      clientY: centerY,
    });
    element.dispatchEvent(dblClickEvent);
  }

  return {
    message: doubleClick ? "已双击元素" : "已点击元素",
    position: { x: centerX, y: centerY },
  };
}

/**
 * 输入文本
 */
async function inputElement(element, value, options = {}) {
  if (value === undefined || value === null) {
    throw new Error("input 操作需要提供 value 参数");
  }

  const { clear = false, delay = 0 } = options;

  // 聚焦元素
  element.focus();

  // 如果需要清空
  if (clear) {
    element.value = "";
  }

  // 如果有延迟，模拟逐字输入
  if (delay > 0) {
    const currentValue = element.value || "";
    for (let i = 0; i < value.length; i++) {
      element.value = currentValue + value.substring(0, i + 1);
      element.dispatchEvent(new Event("input", { bubbles: true }));
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  } else {
    // 直接设置值
    element.value = value;
    element.dispatchEvent(new Event("input", { bubbles: true }));
    element.dispatchEvent(new Event("change", { bubbles: true }));
  }

  return {
    message: "已输入文本",
    value: value,
  };
}

/**
 * 聚焦元素
 */
function focusElement(element) {
  element.focus();
  return { message: "已聚焦元素" };
}

/**
 * 失焦元素
 */
function blurElement(element) {
  element.blur();
  return { message: "已失焦元素" };
}

/**
 * 滚动到元素
 */
function scrollElement(element, options = {}) {
  const { behavior = "smooth", block = "center", inline = "nearest" } = options;

  element.scrollIntoView({ behavior, block, inline });

  return {
    message: "已滚动到元素",
    options: { behavior, block, inline },
  };
}

/**
 * 选择文本
 */
function selectElement(element, value, options = {}) {
  if (element.tagName === "INPUT" || element.tagName === "TEXTAREA") {
    if (value) {
      // 选择指定范围的文本
      const [start, end] = Array.isArray(value) ? value : [0, element.value.length];
      element.setSelectionRange(start, end);
    } else {
      // 选择全部文本
      element.select();
    }
    return { message: "已选择文本", selectedText: element.value.substring(element.selectionStart, element.selectionEnd) };
  } else {
    // 对于其他元素，尝试选择其文本内容
    const selection = window.getSelection();
    const range = document.createRange();
    range.selectNodeContents(element);
    selection.removeAllRanges();
    selection.addRange(range);
    return { message: "已选择元素内容" };
  }
}

/**
 * 清空输入框
 */
function clearElement(element) {
  if (element.tagName === "INPUT" || element.tagName === "TEXTAREA") {
    element.value = "";
    element.dispatchEvent(new Event("input", { bubbles: true }));
    element.dispatchEvent(new Event("change", { bubbles: true }));
    return { message: "已清空输入框" };
  } else {
    throw new Error("只能清空 INPUT 或 TEXTAREA 元素");
  }
}

/**
 * 鼠标悬停
 */
function hoverElement(element) {
  const rect = element.getBoundingClientRect();
  const centerX = rect.left + rect.width / 2;
  const centerY = rect.top + rect.height / 2;

  const moveEvent = new MouseEvent("mousemove", {
    bubbles: true,
    cancelable: true,
    view: window,
    clientX: centerX,
    clientY: centerY,
  });
  element.dispatchEvent(moveEvent);

  const overEvent = new MouseEvent("mouseover", {
    bubbles: true,
    cancelable: true,
    view: window,
    clientX: centerX,
    clientY: centerY,
  });
  element.dispatchEvent(overEvent);

  return {
    message: "已悬停元素",
    position: { x: centerX, y: centerY },
  };
}

/**
 * 获取属性值
 */
function getAttribute(element, attributeName) {
  if (!attributeName) {
    throw new Error("getAttribute 操作需要提供 value 参数（属性名）");
  }

  const value = element.getAttribute(attributeName);
  return {
    message: "已获取属性值",
    attribute: attributeName,
    value: value,
  };
}

/**
 * 设置属性值
 */
function setValue(element, value) {
  if (!value || typeof value !== "object") {
    throw new Error("setValue 操作需要提供 value 参数（对象格式：{ name: '属性名', value: '属性值' }）");
  }

  const { name, value: attrValue } = value;
  if (!name) {
    throw new Error("setValue 操作需要提供属性名");
  }

  element.setAttribute(name, attrValue || "");
  return {
    message: "已设置属性值",
    attribute: name,
    value: attrValue,
  };
}