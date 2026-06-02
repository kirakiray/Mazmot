/**
 * 递归获取元素及其所有子元素的样式信息和内容
 * 返回嵌套树形结构，每个元素通过 children 包含子元素
 */

/**
 * 获取单个元素的完整样式信息
 * @param {Element} element - DOM 元素
 * @returns {object|null} 样式信息对象
 */
function getCaptureStyle(element) {
  if (!element || element.nodeType !== 1) return null;

  const computed = window.getComputedStyle(element);
  const rect = element.getBoundingClientRect();

  // 跳过不可见元素
  if (computed.display === 'none' || computed.visibility === 'hidden') return null;

  const info = {
    tagName: element.tagName.toLowerCase(),
    className: element.className || undefined,
    id: element.id || undefined,

    // 位置和尺寸（相对于视口）
    rect: {
      x: Math.round(rect.x * 100) / 100,
      y: Math.round(rect.y * 100) / 100,
      width: Math.round(rect.width * 100) / 100,
      height: Math.round(rect.height * 100) / 100,
    },

    // 盒模型
    margin: {
      top: parseFloat(computed.marginTop) || 0,
      right: parseFloat(computed.marginRight) || 0,
      bottom: parseFloat(computed.marginBottom) || 0,
      left: parseFloat(computed.marginLeft) || 0,
    },
    padding: {
      top: parseFloat(computed.paddingTop) || 0,
      right: parseFloat(computed.paddingRight) || 0,
      bottom: parseFloat(computed.paddingBottom) || 0,
      left: parseFloat(computed.paddingLeft) || 0,
    },
    border: {
      topWidth: parseFloat(computed.borderTopWidth) || 0,
      rightWidth: parseFloat(computed.borderRightWidth) || 0,
      bottomWidth: parseFloat(computed.borderBottomWidth) || 0,
      leftWidth: parseFloat(computed.borderLeftWidth) || 0,
      topColor: computed.borderTopColor,
      rightColor: computed.borderRightColor,
      bottomColor: computed.borderBottomColor,
      leftColor: computed.borderLeftColor,
      topStyle: computed.borderTopStyle,
      rightStyle: computed.borderRightStyle,
      bottomStyle: computed.borderBottomStyle,
      leftStyle: computed.borderLeftStyle,
    },

    // 外观
    backgroundColor: computed.backgroundColor,
    color: computed.color,
    fontSize: computed.fontSize,
    fontFamily: computed.fontFamily,
    fontWeight: computed.fontWeight,
    fontStyle: computed.fontStyle,
    lineHeight: computed.lineHeight,
    textAlign: computed.textAlign,
    textDecoration: computed.textDecoration,
    letterSpacing: computed.letterSpacing,
    whiteSpace: computed.whiteSpace,
    wordBreak: computed.wordBreak,

    borderRadius: {
      topLeft: computed.borderTopLeftRadius,
      topRight: computed.borderTopRightRadius,
      bottomRight: computed.borderBottomRightRadius,
      bottomLeft: computed.borderBottomLeftRadius,
    },
    boxShadow: computed.boxShadow !== 'none' ? computed.boxShadow : undefined,
    opacity: parseFloat(computed.opacity),
    overflow: computed.overflow,
    overflowX: computed.overflowX,
    overflowY: computed.overflowY,

    // 布局
    display: computed.display,
    position: computed.position,
    zIndex: computed.zIndex !== 'auto' ? computed.zIndex : undefined,
    transform: computed.transform !== 'none' ? computed.transform : undefined,

    // Flex
    flexDirection: computed.flexDirection !== 'row' ? computed.flexDirection : undefined,
    justifyContent: computed.justifyContent !== 'flex-start' ? computed.justifyContent : undefined,
    alignItems: computed.alignItems !== 'stretch' ? computed.alignItems : undefined,
    flexWrap: computed.flexWrap !== 'nowrap' ? computed.flexWrap : undefined,
    gap: computed.gap !== 'normal' ? computed.gap : undefined,

    // Grid
    gridTemplateColumns: computed.gridTemplateColumns !== 'none' ? computed.gridTemplateColumns : undefined,
    gridTemplateRows: computed.gridTemplateRows !== 'none' ? computed.gridTemplateRows : undefined,

    // 文本内容：只取直接文本节点，不包含子元素的文本
    textContent: getDirectTextContent(element),
  };

  return cleanObject(info);
}

/**
 * 获取元素的直接文本内容（不包含子元素的文本）
 */
function getDirectTextContent(element) {
  let text = '';
  for (const node of element.childNodes) {
    if (node.nodeType === 3) { // 文本节点
      text += node.textContent;
    }
  }
  return text.trim() || undefined;
}

/**
 * 清理对象中的 undefined 字段
 */
function cleanObject(obj) {
  const result = {};
  for (const [key, value] of Object.entries(obj)) {
    if (value !== undefined) {
      if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
        const cleaned = cleanObject(value);
        if (Object.keys(cleaned).length > 0) {
          result[key] = cleaned;
        }
      } else {
        result[key] = value;
      }
    }
  }
  return result;
}

/**
 * 递归获取元素及所有子元素的样式信息，返回嵌套树形结构
 * @param {Element} element - 传入的根元素
 * @returns {object|null} 嵌套的样式信息对象，children 包含子元素
 */
function captureElementStyles(element) {
  if (!element || element.nodeType !== 1) {
    console.warn('captureElementStyles: 传入的不是一个有效的元素');
    return null;
  }

  const styleInfo = getCaptureStyle(element);

  if (!styleInfo) {
    // 当前元素被跳过，但如果只有一个子元素，直接返回该子元素的结果
    const children = element.children;
    if (children.length === 1) {
      return captureElementStyles(children[0]);
    }
    // 多个子元素时，将它们合并到一个虚拟容器中
    if (children.length > 0) {
      const childResults = [];
      for (let i = 0; i < children.length; i++) {
        const child = captureElementStyles(children[i]);
        if (child) childResults.push(child);
      }
      if (childResults.length === 1) return childResults[0];
      if (childResults.length > 1) {
        return { tagName: 'fragment', children: childResults };
      }
    }
    return null;
  }

  // 递归处理子元素
  const childElements = element.children;
  if (childElements.length > 0) {
    const children = [];
    for (let i = 0; i < childElements.length; i++) {
      const childInfo = captureElementStyles(childElements[i]);
      if (childInfo) children.push(childInfo);
    }
    if (children.length > 0) {
      styleInfo.children = children;
    }
  }

  return styleInfo;
}

/**
 * 将截取的样式信息应用到元素上
 */
function applyStyles(el, item) {
  const s = el.style;

  if (item.rect) {
    s.position = 'absolute';
    s.left = item.rect.x + 'px';
    s.top = item.rect.y + 'px';
    s.width = item.rect.width + 'px';
    s.height = item.rect.height + 'px';
  }

  if (item.margin) {
    s.marginTop = item.margin.top + 'px';
    s.marginRight = item.margin.right + 'px';
    s.marginBottom = item.margin.bottom + 'px';
    s.marginLeft = item.margin.left + 'px';
  }
  if (item.padding) {
    s.paddingTop = item.padding.top + 'px';
    s.paddingRight = item.padding.right + 'px';
    s.paddingBottom = item.padding.bottom + 'px';
    s.paddingLeft = item.padding.left + 'px';
  }
  if (item.border) {
    if (item.border.topWidth) s.borderTop = `${item.border.topWidth}px ${item.border.topStyle || 'solid'} ${item.border.topColor || 'transparent'}`;
    if (item.border.rightWidth) s.borderRight = `${item.border.rightWidth}px ${item.border.rightStyle || 'solid'} ${item.border.rightColor || 'transparent'}`;
    if (item.border.bottomWidth) s.borderBottom = `${item.border.bottomWidth}px ${item.border.bottomStyle || 'solid'} ${item.border.bottomColor || 'transparent'}`;
    if (item.border.leftWidth) s.borderLeft = `${item.border.leftWidth}px ${item.border.leftStyle || 'solid'} ${item.border.leftColor || 'transparent'}`;
  }

  if (item.backgroundColor && item.backgroundColor !== 'rgba(0, 0, 0, 0)') {
    s.backgroundColor = item.backgroundColor;
  }
  if (item.color) s.color = item.color;
  if (item.fontSize) s.fontSize = item.fontSize;
  if (item.fontFamily) s.fontFamily = item.fontFamily;
  if (item.fontWeight) s.fontWeight = item.fontWeight;
  if (item.fontStyle) s.fontStyle = item.fontStyle;
  if (item.lineHeight) s.lineHeight = item.lineHeight;
  if (item.textAlign) s.textAlign = item.textAlign;
  if (item.textDecoration) s.textDecoration = item.textDecoration;
  if (item.letterSpacing) s.letterSpacing = item.letterSpacing;
  if (item.whiteSpace) s.whiteSpace = item.whiteSpace;
  if (item.wordBreak) s.wordBreak = item.wordBreak;

  if (item.borderRadius) {
    s.borderRadius = `${item.borderRadius.topLeft} ${item.borderRadius.topRight} ${item.borderRadius.bottomRight} ${item.borderRadius.bottomLeft}`;
  }

  if (item.boxShadow) s.boxShadow = item.boxShadow;
  if (item.opacity !== undefined && item.opacity < 1) s.opacity = item.opacity;
  if (item.overflow) s.overflow = item.overflow;

  if (item.display) s.display = item.display;
  if (item.position) s.position = item.position;
  if (item.zIndex) s.zIndex = item.zIndex;
  if (item.transform) s.transform = item.transform;

  if (item.flexDirection) s.flexDirection = item.flexDirection;
  if (item.justifyContent) s.justifyContent = item.justifyContent;
  if (item.alignItems) s.alignItems = item.alignItems;
  if (item.flexWrap) s.flexWrap = item.flexWrap;
  if (item.gap) s.gap = item.gap;

  if (item.gridTemplateColumns) s.gridTemplateColumns = item.gridTemplateColumns;
  if (item.gridTemplateRows) s.gridTemplateRows = item.gridTemplateRows;
}

/**
 * 将截取的嵌套样式信息还原为真实 DOM 元素
 * @param {object} captureNode - captureElementStyles 返回的嵌套对象
 * @returns {HTMLElement|null} 还原的元素
 */
function restoreFromCapture(captureNode) {
  if (!captureNode) return null;

  // fragment 虚拟容器
  if (captureNode.tagName === 'fragment') {
    const wrapper = document.createElement('div');
    if (captureNode.children) {
      captureNode.children.forEach(child => {
        const el = restoreFromCapture(child);
        if (el) wrapper.appendChild(el);
      });
    }
    return wrapper;
  }

  const el = document.createElement(captureNode.tagName);

  if (captureNode.className) el.className = captureNode.className;
  if (captureNode.id) el.id = captureNode.id;
  if (captureNode.textContent) el.textContent = captureNode.textContent;

  applyStyles(el, captureNode);

  // 递归还原子元素
  if (captureNode.children) {
    captureNode.children.forEach(child => {
      const childEl = restoreFromCapture(child);
      if (childEl) el.appendChild(childEl);
    });
  }

  return el;
}

// 导出
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { captureElementStyles, getCaptureStyle, restoreFromCapture, applyStyles };
} else {
  window.CaptureStyle = { captureElementStyles, getCaptureStyle, restoreFromCapture, applyStyles };
}
