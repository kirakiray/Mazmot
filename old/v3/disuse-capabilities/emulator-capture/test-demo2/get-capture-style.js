/**
 * 递归获取元素及其所有子元素的样式信息和内容
 * 返回压缩后的嵌套树形结构，使用短键名和简写值减少数据量
 */

// 短键名映射
const K = {
  tagName: 't', className: 'c', id: 'i',
  rect: 'r', margin: 'm', padding: 'p', border: 'b',
  backgroundColor: 'bg', backgroundImage: 'bi', backgroundSize: 'bs',
  backgroundPosition: 'bp', backgroundRepeat: 'br',
  color: 'co', fontSize: 'fs', fontFamily: 'ff', fontWeight: 'fw',
  fontStyle: 'fi', lineHeight: 'lh', textAlign: 'ta',
  textDecoration: 'td', letterSpacing: 'ls', whiteSpace: 'ws', wordBreak: 'wb',
  borderRadius: 'ra', boxShadow: 'sh', opacity: 'o',
  overflow: 'ov', overflowX: 'ox', overflowY: 'oy',
  display: 'd', position: 'po', zIndex: 'z', transform: 'tf',
  flexDirection: 'fd', justifyContent: 'jc', alignItems: 'ai',
  flexWrap: 'fwr', gap: 'g',
  gridTemplateColumns: 'gc', gridTemplateRows: 'gr',
  textContent: 'tx', children: 'ch',
};

// 反向映射
const RK = Object.fromEntries(Object.entries(K).map(([k, v]) => [v, k]));

/**
 * 盒模型四值简写：全0→undefined，全同→单值，否则→数组[T,R,B,L]
 */
function shorthandBox(top, right, bottom, left) {
  if (top === 0 && right === 0 && bottom === 0 && left === 0) return undefined;
  if (top === right && right === bottom && bottom === left) return top;
  return [top, right, bottom, left];
}

/**
 * 获取元素的直接文本内容（不包含子元素的文本）
 */
function getDirectTextContent(element) {
  let text = '';
  for (const node of element.childNodes) {
    if (node.nodeType === 3) {
      text += node.textContent;
    }
  }
  return text.trim() || undefined;
}

/**
 * 获取单个元素的完整样式信息（压缩格式）
 */
export function getCaptureStyle(element) {
  if (!element || element.nodeType !== 1) return null;

  const computed = window.getComputedStyle(element);
  const rect = element.getBoundingClientRect();

  // 跳过不可见元素
  if (computed.display === 'none' || computed.visibility === 'hidden') return null;

  const info = {};

  // 基础标识
  info[K.tagName] = element.tagName.toLowerCase();
  if (element.className) info[K.className] = element.className;
  if (element.id) info[K.id] = element.id;

  // 位置和尺寸：[x, y, w, h]
  info[K.rect] = [
    Math.round(rect.x * 100) / 100,
    Math.round(rect.y * 100) / 100,
    Math.round(rect.width * 100) / 100,
    Math.round(rect.height * 100) / 100,
  ];

  // 盒模型简写
  const mt = parseFloat(computed.marginTop) || 0;
  const mr = parseFloat(computed.marginRight) || 0;
  const mb = parseFloat(computed.marginBottom) || 0;
  const ml = parseFloat(computed.marginLeft) || 0;
  const marginVal = shorthandBox(mt, mr, mb, ml);
  if (marginVal !== undefined) info[K.margin] = marginVal;

  const pt = parseFloat(computed.paddingTop) || 0;
  const pr = parseFloat(computed.paddingRight) || 0;
  const pb = parseFloat(computed.paddingBottom) || 0;
  const pl = parseFloat(computed.paddingLeft) || 0;
  const paddingVal = shorthandBox(pt, pr, pb, pl);
  if (paddingVal !== undefined) info[K.padding] = paddingVal;

  // 边框简写
  const btw = parseFloat(computed.borderTopWidth) || 0;
  const brw = parseFloat(computed.borderRightWidth) || 0;
  const bbw = parseFloat(computed.borderBottomWidth) || 0;
  const blw = parseFloat(computed.borderLeftWidth) || 0;
  if (btw !== 0 || brw !== 0 || bbw !== 0 || blw !== 0) {
    const allSame = btw === brw && brw === bbw && bbw === blw
      && computed.borderTopStyle === computed.borderRightStyle
      && computed.borderRightStyle === computed.borderBottomStyle
      && computed.borderBottomStyle === computed.borderLeftStyle
      && computed.borderTopColor === computed.borderRightColor
      && computed.borderRightColor === computed.borderBottomColor
      && computed.borderBottomColor === computed.borderLeftColor;
    if (allSame) {
      info[K.border] = `${btw}px ${computed.borderTopStyle} ${computed.borderTopColor}`;
    } else {
      info[K.border] = {
        w: shorthandBox(btw, brw, bbw, blw),
        s: [computed.borderTopStyle, computed.borderRightStyle, computed.borderBottomStyle, computed.borderLeftStyle],
        c: [computed.borderTopColor, computed.borderRightColor, computed.borderBottomColor, computed.borderLeftColor],
      };
    }
  }

  // 外观（跳过默认值）
  const bg = computed.backgroundColor;
  if (bg !== 'rgba(0, 0, 0, 0)') info[K.backgroundColor] = bg;

  if (computed.backgroundImage !== 'none') info[K.backgroundImage] = computed.backgroundImage;
  if (computed.backgroundSize !== 'auto') info[K.backgroundSize] = computed.backgroundSize;
  if (computed.backgroundPosition !== '0% 0%') info[K.backgroundPosition] = computed.backgroundPosition;
  if (computed.backgroundRepeat !== 'repeat') info[K.backgroundRepeat] = computed.backgroundRepeat;

  if (computed.color) info[K.color] = computed.color;
  if (computed.fontSize) info[K.fontSize] = computed.fontSize;
  if (computed.fontFamily) info[K.fontFamily] = computed.fontFamily;
  if (computed.fontWeight !== '400') info[K.fontWeight] = computed.fontWeight;
  if (computed.fontStyle !== 'normal') info[K.fontStyle] = computed.fontStyle;
  if (computed.lineHeight !== 'normal') info[K.lineHeight] = computed.lineHeight;
  if (computed.textAlign !== 'start') info[K.textAlign] = computed.textAlign;
  if (computed.textDecoration !== 'none solid rgb(0, 0, 0)') info[K.textDecoration] = computed.textDecoration;
  if (computed.letterSpacing !== 'normal') info[K.letterSpacing] = computed.letterSpacing;
  if (computed.whiteSpace !== 'normal') info[K.whiteSpace] = computed.whiteSpace;
  if (computed.wordBreak !== 'normal') info[K.wordBreak] = computed.wordBreak;

  // 圆角简写
  const rtl = computed.borderTopLeftRadius;
  const rtr = computed.borderTopRightRadius;
  const rbr = computed.borderBottomRightRadius;
  const rbl = computed.borderBottomLeftRadius;
  if (rtl !== '0px' || rtr !== '0px' || rbr !== '0px' || rbl !== '0px') {
    if (rtl === rtr && rtr === rbr && rbr === rbl) {
      info[K.borderRadius] = rtl;
    } else {
      info[K.borderRadius] = [rtl, rtr, rbr, rbl];
    }
  }

  if (computed.boxShadow !== 'none') info[K.boxShadow] = computed.boxShadow;

  const opacity = parseFloat(computed.opacity);
  if (opacity < 1) info[K.opacity] = opacity;

  if (computed.overflow !== 'visible') info[K.overflow] = computed.overflow;
  if (computed.overflowX !== 'visible') info[K.overflowX] = computed.overflowX;
  if (computed.overflowY !== 'visible') info[K.overflowY] = computed.overflowY;

  // 布局（跳过默认值）
  if (computed.display !== 'block') info[K.display] = computed.display;
  if (computed.position !== 'static') info[K.position] = computed.position;
  if (computed.zIndex !== 'auto') info[K.zIndex] = computed.zIndex;
  if (computed.transform !== 'none') info[K.transform] = computed.transform;

  // Flex（跳过默认值）
  if (computed.flexDirection !== 'row') info[K.flexDirection] = computed.flexDirection;
  if (computed.justifyContent !== 'flex-start') info[K.justifyContent] = computed.justifyContent;
  if (computed.alignItems !== 'stretch') info[K.alignItems] = computed.alignItems;
  if (computed.flexWrap !== 'nowrap') info[K.flexWrap] = computed.flexWrap;
  if (computed.gap !== 'normal') info[K.gap] = computed.gap;

  // Grid
  if (computed.gridTemplateColumns !== 'none') info[K.gridTemplateColumns] = computed.gridTemplateColumns;
  if (computed.gridTemplateRows !== 'none') info[K.gridTemplateRows] = computed.gridTemplateRows;

  // 文本内容
  const text = getDirectTextContent(element);
  if (text) info[K.textContent] = text;

  return info;
}

/**
 * 递归获取元素及所有子元素的样式信息，返回压缩的嵌套树形结构
 */
export function captureElementStyles(element) {
  if (!element || element.nodeType !== 1) {
    console.warn('captureElementStyles: 传入的不是一个有效的元素');
    return null;
  }

  const styleInfo = getCaptureStyle(element);

  if (!styleInfo) {
    const children = element.children;
    if (children.length === 1) {
      return captureElementStyles(children[0]);
    }
    if (children.length > 0) {
      const childResults = [];
      for (let i = 0; i < children.length; i++) {
        const child = captureElementStyles(children[i]);
        if (child) childResults.push(child);
      }
      if (childResults.length === 1) return childResults[0];
      if (childResults.length > 1) {
        return { [K.tagName]: 'fragment', [K.children]: childResults };
      }
    }
    return null;
  }

  const childElements = element.children;
  if (childElements.length > 0) {
    const children = [];
    for (let i = 0; i < childElements.length; i++) {
      const childInfo = captureElementStyles(childElements[i]);
      if (childInfo) children.push(childInfo);
    }
    if (children.length > 0) {
      styleInfo[K.children] = children;
    }
  }

  return styleInfo;
}

/**
 * 解析盒模型简写值为 {top, right, bottom, left}
 */
function parseBox(val) {
  if (val === undefined) return { top: 0, right: 0, bottom: 0, left: 0 };
  if (typeof val === 'number') return { top: val, right: val, bottom: val, left: val };
  if (Array.isArray(val)) return { top: val[0], right: val[1], bottom: val[2], left: val[3] };
  return { top: 0, right: 0, bottom: 0, left: 0 };
}

/**
 * 将截取的样式信息应用到元素上
 * @param {HTMLElement} el - 目标元素
 * @param {object} item - 截取数据
 * @param {boolean} isRoot - 是否为根元素
 */
export function applyStyles(el, item, isRoot = false) {
  const s = el.style;

  // 盒模型
  const margin = parseBox(item[K.margin]);
  if (margin.top || margin.right || margin.bottom || margin.left) {
    s.margin = `${margin.top}px ${margin.right}px ${margin.bottom}px ${margin.left}px`;
  }
  const padding = parseBox(item[K.padding]);
  if (padding.top || padding.right || padding.bottom || padding.left) {
    s.padding = `${padding.top}px ${padding.right}px ${padding.bottom}px ${padding.left}px`;
  }

  // 边框
  const border = item[K.border];
  if (border) {
    if (typeof border === 'string') {
      s.border = border;
    } else {
      const bw = parseBox(border.w);
      const bs = border.s;
      const bc = border.c;
      if (bw.top) s.borderTop = `${bw.top}px ${bs[0]} ${bc[0]}`;
      if (bw.right) s.borderRight = `${bw.right}px ${bs[1]} ${bc[1]}`;
      if (bw.bottom) s.borderBottom = `${bw.bottom}px ${bs[2]} ${bc[2]}`;
      if (bw.left) s.borderLeft = `${bw.left}px ${bs[3]} ${bc[3]}`;
    }
  }

  // 外观
  const bg = item[K.backgroundColor];
  if (bg && bg !== 'rgba(0, 0, 0, 0)') s.backgroundColor = bg;
  if (item[K.backgroundImage]) s.backgroundImage = item[K.backgroundImage];
  if (item[K.backgroundSize]) s.backgroundSize = item[K.backgroundSize];
  if (item[K.backgroundPosition]) s.backgroundPosition = item[K.backgroundPosition];
  if (item[K.backgroundRepeat]) s.backgroundRepeat = item[K.backgroundRepeat];
  if (item[K.color]) s.color = item[K.color];
  if (item[K.fontSize]) s.fontSize = item[K.fontSize];
  if (item[K.fontFamily]) s.fontFamily = item[K.fontFamily];
  if (item[K.fontWeight]) s.fontWeight = item[K.fontWeight];
  if (item[K.fontStyle]) s.fontStyle = item[K.fontStyle];
  if (item[K.lineHeight]) s.lineHeight = item[K.lineHeight];
  if (item[K.textAlign]) s.textAlign = item[K.textAlign];
  if (item[K.textDecoration]) s.textDecoration = item[K.textDecoration];
  if (item[K.letterSpacing]) s.letterSpacing = item[K.letterSpacing];
  if (item[K.whiteSpace]) s.whiteSpace = item[K.whiteSpace];
  if (item[K.wordBreak]) s.wordBreak = item[K.wordBreak];

  // 圆角
  const radius = item[K.borderRadius];
  if (radius) {
    if (typeof radius === 'string') {
      s.borderRadius = radius;
    } else {
      s.borderRadius = `${radius[0]} ${radius[1]} ${radius[2]} ${radius[3]}`;
    }
  }

  if (item[K.boxShadow]) s.boxShadow = item[K.boxShadow];
  if (item[K.opacity] !== undefined && item[K.opacity] < 1) s.opacity = item[K.opacity];
  if (item[K.overflow]) s.overflow = item[K.overflow];

  // 布局
  if (item[K.display]) s.display = item[K.display];
  if (item[K.position]) s.position = item[K.position];
  if (item[K.zIndex]) s.zIndex = item[K.zIndex];
  if (item[K.transform]) s.transform = item[K.transform];

  // Flex
  if (item[K.flexDirection]) s.flexDirection = item[K.flexDirection];
  if (item[K.justifyContent]) s.justifyContent = item[K.justifyContent];
  if (item[K.alignItems]) s.alignItems = item[K.alignItems];
  if (item[K.flexWrap]) s.flexWrap = item[K.flexWrap];
  if (item[K.gap]) s.gap = item[K.gap];

  // Grid
  if (item[K.gridTemplateColumns]) s.gridTemplateColumns = item[K.gridTemplateColumns];
  if (item[K.gridTemplateRows]) s.gridTemplateRows = item[K.gridTemplateRows];

  // 尺寸：根元素用 rect 的宽高，非根元素只在有明确尺寸时设置
  const r = item[K.rect];
  if (r) {
    if (isRoot) {
      s.width = r[2] + 'px';
      s.height = r[3] + 'px';
    } else {
      // 非根元素：只在非 auto 尺寸时设置（避免覆盖 flex/grid 的自动尺寸）
      if (r[2] > 0 && item[K.display] !== 'flex' && item[K.display] !== 'grid') {
        s.width = r[2] + 'px';
      }
      if (r[3] > 0 && !item[K.textContent]) {
        // 有文本内容的元素高度由内容撑开，不固定
      }
    }
  }
}

/**
 * 将截取的嵌套样式信息还原为真实 DOM 元素
 */
export function restoreFromCapture(captureNode, isRoot = true) {
  if (!captureNode) return null;

  const tagName = captureNode[K.tagName];

  // fragment 虚拟容器
  if (tagName === 'fragment') {
    const wrapper = document.createElement('div');
    const children = captureNode[K.children];
    if (children) {
      children.forEach(child => {
        const el = restoreFromCapture(child, false);
        if (el) wrapper.appendChild(el);
      });
    }
    return wrapper;
  }

  const el = document.createElement(tagName);

  if (captureNode[K.className]) el.className = captureNode[K.className];
  if (captureNode[K.id]) el.id = captureNode[K.id];
  if (captureNode[K.textContent]) el.textContent = captureNode[K.textContent];

  applyStyles(el, captureNode, isRoot);

  // 递归还原子元素
  const children = captureNode[K.children];
  if (children) {
    children.forEach(child => {
      const childEl = restoreFromCapture(child, false);
      if (childEl) el.appendChild(childEl);
    });
  }

  return el;
}
