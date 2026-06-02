/**
 * 获取元素样式数据的工具库
 * 递归获取从body开始的所有元素的外观信息
 * 支持数据压缩和配置选项
 */

// 默认配置
const DEFAULT_CONFIG = {
  // 提取选项
  includeDimensions: true,      // 尺寸位置
  includeBoxModel: true,        // 盒模型
  includeAppearance: true,      // 外观样式
  includeText: true,            // 文本样式
  includeLayout: true,          // 布局相关
  includeFlex: false,           // Flex布局（默认不提取）
  includeGrid: false,           // Grid布局（默认不提取）

  // 压缩选项
  skipDefaultValues: true,      // 跳过默认值
  skipInheritedStyles: true,    // 跳过继承的样式
  compactFieldNames: true,      // 使用简写字段名

  // 过滤选项
  minElementSize: 0,            // 最小元素尺寸（像素），小于此值的元素不提取
  skipHiddenElements: true,     // 跳过隐藏元素
  skipEmptyText: true           // 跳过空文本节点
};

// 简写字段名映射
const COMPACT_NAMES = {
  // 基础信息
  tagName: 't',
  className: 'c',
  id: 'i',
  depth: 'd',

  // 尺寸
  dimensions: 'dim',
  width: 'w',
  height: 'h',
  x: 'x',
  y: 'y',

  // 盒模型
  boxModel: 'box',
  margin: 'm',
  padding: 'p',
  border: 'b',

  // 外观
  appearance: 'app',
  backgroundColor: 'bg',
  borderRadius: 'br',
  boxShadow: 'bs',
  opacity: 'o',
  transform: 'tf',

  // 文本
  text: 'txt',
  color: 'cl',
  fontSize: 'fs',
  fontFamily: 'ff',
  fontWeight: 'fw',
  lineHeight: 'lh',

  // 布局
  layout: 'lyt',
  display: 'dp',
  position: 'pos',
  visibility: 'vis',
  overflow: 'ov'
};

/**
 * 检查值是否为默认值
 */
function isDefaultValue(key, value) {
  const defaultValues = {
    // 尺寸相关
    width: 0, height: 0, x: 0, y: 0,

    // 盒模型
    margin: [0, 0, 0, 0],
    padding: [0, 0, 0, 0],
    border: [0, 0, 0, 0],

    // 外观
    backgroundColor: 'rgba(0, 0, 0, 0)',
    backgroundImage: 'none',
    borderRadius: ['0px', '0px', '0px', '0px'],
    boxShadow: 'none',
    opacity: 1,
    transform: 'none',

    // 文本
    color: 'rgb(0, 0, 0)',
    fontSize: '16px',
    fontWeight: '400',
    lineHeight: 'normal',

    // 布局
    display: 'block',
    position: 'static',
    visibility: 'visible',
    overflow: 'visible',
    zIndex: 'auto'
  };

  if (Array.isArray(value) && Array.isArray(defaultValues[key])) {
    return JSON.stringify(value) === JSON.stringify(defaultValues[key]);
  }

  return value === defaultValues[key];
}

/**
 * 检查元素是否应该被跳过
 */
function shouldSkipElement(element, computedStyle, rect, config) {
  // 跳过隐藏元素
  if (config.skipHiddenElements) {
    if (computedStyle.display === 'none' ||
        computedStyle.visibility === 'hidden' ||
        computedStyle.opacity === '0') {
      return true;
    }
  }

  // 跳过小元素
  if (config.minElementSize > 0) {
    if (rect.width < config.minElementSize || rect.height < config.minElementSize) {
      return true;
    }
  }

  // 跳过空文本
  if (config.skipEmptyText) {
    const text = element.textContent?.trim();
    if (!text && !element.children.length && rect.width === 0 && rect.height === 0) {
      return true;
    }
  }

  return false;
}

/**
 * 简化字段名
 */
function compactKey(key, useCompact) {
  if (!useCompact) return key;
  return COMPACT_NAMES[key] || key;
}

/**
 * 获取单个元素的样式信息（优化版）
 */
function getElementStyles(element, config = {}) {
  if (!element || element.nodeType !== 1) {
    return null;
  }

  const cfg = { ...DEFAULT_CONFIG, ...config };
  const computedStyle = window.getComputedStyle(element);
  const rect = element.getBoundingClientRect();

  // 检查是否应该跳过此元素
  if (shouldSkipElement(element, computedStyle, rect, cfg)) {
    return null;
  }

  const useCompact = cfg.compactFieldNames;
  const styleInfo = {};

  // 基础信息
  styleInfo[compactKey('tagName', useCompact)] = element.tagName.toLowerCase();

  if (element.className) {
    styleInfo[compactKey('className', useCompact)] = element.className;
  }

  if (element.id) {
    styleInfo[compactKey('id', useCompact)] = element.id;
  }

  // 尺寸和位置信息
  if (cfg.includeDimensions) {
    const dimensions = {};

    const addDimension = (key, value) => {
      if (!cfg.skipDefaultValues || !isDefaultValue(key, value)) {
        dimensions[compactKey(key, useCompact)] = Math.round(value * 100) / 100;
      }
    };

    addDimension('width', rect.width);
    addDimension('height', rect.height);
    addDimension('x', rect.x);
    addDimension('y', rect.y);

    if (Object.keys(dimensions).length > 0) {
      styleInfo[compactKey('dimensions', useCompact)] = dimensions;
    }
  }

  // 盒模型
  if (cfg.includeBoxModel) {
    const boxModel = {};

    const addBoxValue = (key, values) => {
      const arr = values.map(v => parseFloat(v) || 0);
      if (!cfg.skipDefaultValues || !isDefaultValue(key, arr)) {
        boxModel[compactKey(key, useCompact)] = arr;
      }
    };

    addBoxValue('margin', [
      computedStyle.marginTop,
      computedStyle.marginRight,
      computedStyle.marginBottom,
      computedStyle.marginLeft
    ]);

    addBoxValue('padding', [
      computedStyle.paddingTop,
      computedStyle.paddingRight,
      computedStyle.paddingBottom,
      computedStyle.paddingLeft
    ]);

    addBoxValue('border', [
      computedStyle.borderTopWidth,
      computedStyle.borderRightWidth,
      computedStyle.borderBottomWidth,
      computedStyle.borderLeftWidth
    ]);

    if (Object.keys(boxModel).length > 0) {
      styleInfo[compactKey('boxModel', useCompact)] = boxModel;
    }
  }

  // 外观样式
  if (cfg.includeAppearance) {
    const appearance = {};

    const addAppearance = (key, value) => {
      if (!cfg.skipDefaultValues || !isDefaultValue(key, value)) {
        appearance[compactKey(key, useCompact)] = value;
      }
    };

    // 背景色（简化）
    const bgColor = computedStyle.backgroundColor;
    if (bgColor && bgColor !== 'rgba(0, 0, 0, 0)' && bgColor !== 'transparent') {
      addAppearance('backgroundColor', bgColor);
    }

    // 圆角
    const borderRadius = [
      computedStyle.borderTopLeftRadius,
      computedStyle.borderTopRightRadius,
      computedStyle.borderBottomRightRadius,
      computedStyle.borderBottomLeftRadius
    ];
    const hasRadius = borderRadius.some(r => r !== '0px');
    if (hasRadius) {
      addAppearance('borderRadius', borderRadius);
    }

    // 阴影
    const boxShadow = computedStyle.boxShadow;
    if (boxShadow && boxShadow !== 'none') {
      addAppearance('boxShadow', boxShadow);
    }

    // 透明度
    const opacity = parseFloat(computedStyle.opacity);
    if (opacity < 1) {
      addAppearance('opacity', opacity);
    }

    // 变换
    const transform = computedStyle.transform;
    if (transform && transform !== 'none') {
      addAppearance('transform', transform);
    }

    if (Object.keys(appearance).length > 0) {
      styleInfo[compactKey('appearance', useCompact)] = appearance;
    }
  }

  // 文本样式
  if (cfg.includeText) {
    const text = {};

    const addText = (key, value) => {
      if (!cfg.skipDefaultValues || !isDefaultValue(key, value)) {
        text[compactKey(key, useCompact)] = value;
      }
    };

    // 只提取有文本的元素
    const hasText = element.textContent?.trim();
    if (hasText) {
      const color = computedStyle.color;
      if (color && color !== 'rgb(0, 0, 0)') {
        addText('color', color);
      }

      const fontSize = computedStyle.fontSize;
      if (fontSize && fontSize !== '16px') {
        addText('fontSize', fontSize);
      }

      const fontWeight = computedStyle.fontWeight;
      if (fontWeight && fontWeight !== '400') {
        addText('fontWeight', fontWeight);
      }

      const lineHeight = computedStyle.lineHeight;
      if (lineHeight && lineHeight !== 'normal') {
        addText('lineHeight', lineHeight);
      }
    }

    if (Object.keys(text).length > 0) {
      styleInfo[compactKey('text', useCompact)] = text;
    }
  }

  // 布局相关
  if (cfg.includeLayout) {
    const layout = {};

    const addLayout = (key, value) => {
      if (!cfg.skipDefaultValues || !isDefaultValue(key, value)) {
        layout[compactKey(key, useCompact)] = value;
      }
    };

    const display = computedStyle.display;
    if (display && display !== 'block') {
      addLayout('display', display);
    }

    const position = computedStyle.position;
    if (position && position !== 'static') {
      addLayout('position', position);
    }

    const overflow = computedStyle.overflow;
    if (overflow && overflow !== 'visible') {
      addLayout('overflow', overflow);
    }

    const zIndex = computedStyle.zIndex;
    if (zIndex && zIndex !== 'auto') {
      addLayout('zIndex', zIndex);
    }

    if (Object.keys(layout).length > 0) {
      styleInfo[compactKey('layout', useCompact)] = layout;
    }
  }

  // Flex布局（仅在启用时提取）
  if (cfg.includeFlex && computedStyle.display === 'flex') {
    const flex = {};
    flex[compactKey('direction', useCompact)] = computedStyle.flexDirection;
    flex[compactKey('justify', useCompact)] = computedStyle.justifyContent;
    flex[compactKey('align', useCompact)] = computedStyle.alignItems;
    flex[compactKey('gap', useCompact)] = computedStyle.gap;

    styleInfo[compactKey('flex', useCompact)] = flex;
  }

  // Grid布局（仅在启用时提取）
  if (cfg.includeGrid && computedStyle.display === 'grid') {
    const grid = {};
    grid[compactKey('columns', useCompact)] = computedStyle.gridTemplateColumns;
    grid[compactKey('rows', useCompact)] = computedStyle.gridTemplateRows;
    grid[compactKey('gap', useCompact)] = computedStyle.gap;

    styleInfo[compactKey('grid', useCompact)] = grid;
  }

  return Object.keys(styleInfo).length > 0 ? styleInfo : null;
}

/**
 * 递归获取元素及其所有子元素的样式信息
 */
function getAllElementStyles(element, config = {}, depth = 0) {
  const result = [];

  if (!element || element.nodeType !== 1) {
    return result;
  }

  // 获取当前元素的样式
  const styleInfo = getElementStyles(element, config);
  if (styleInfo) {
    const useCompact = config.compactFieldNames ?? DEFAULT_CONFIG.compactFieldNames;
    styleInfo[compactKey('depth', useCompact)] = depth;

    const children = [];
    const childElements = element.children;

    for (let i = 0; i < childElements.length; i++) {
      const childStyles = getAllElementStyles(childElements[i], config, depth + 1);
      children.push(...childStyles);
    }

    if (children.length > 0) {
      styleInfo.children = children;
    }

    result.push(styleInfo);
  } else {
    // 即使当前元素被跳过，也要检查子元素
    const childElements = element.children;
    for (let i = 0; i < childElements.length; i++) {
      const childStyles = getAllElementStyles(childElements[i], config, depth + 1);
      result.push(...childStyles);
    }
  }

  return result;
}

/**
 * 获取整个页面的样式数据（从body开始）
 */
function getDocumentStyles(doc = document, config = {}) {
  const startTime = performance.now();

  const body = doc.body;
  if (!body) {
    console.error('Document body not found');
    return null;
  }

  const allStyles = getAllElementStyles(body, config, 0);

  const endTime = performance.now();

  return {
    metadata: {
      totalElements: allStyles.length,
      processingTime: `${(endTime - startTime).toFixed(2)}ms`,
      timestamp: new Date().toISOString(),
      documentTitle: doc.title || '',
      documentURL: doc.location?.href || '',
      config: config
    },
    styles: allStyles
  };
}

/**
 * 获取iframe内文档的样式数据
 */
function getIframeStyles(iframe, config = {}) {
  return new Promise((resolve, reject) => {
    try {
      const iframeDoc = iframe.contentDocument || iframe.contentWindow.document;

      if (!iframeDoc) {
        reject(new Error('Cannot access iframe document'));
        return;
      }

      if (iframeDoc.readyState === 'complete') {
        const styles = getDocumentStyles(iframeDoc, config);
        resolve(styles);
      } else {
        iframe.addEventListener('load', () => {
          const styles = getDocumentStyles(iframeDoc, config);
          resolve(styles);
        });
      }
    } catch (error) {
      reject(new Error(`Failed to get iframe styles: ${error.message}`));
    }
  });
}

/**
 * 导出样式数据为JSON格式
 */
function exportStylesToJSON(stylesData) {
  return JSON.stringify(stylesData, null, 2);
}

/**
 * 打印样式统计信息
 */
function printStylesStats(stylesData) {
  if (!stylesData || !stylesData.metadata) {
    console.log('No styles data available');
    return;
  }

  console.group('📊 样式数据统计');
  console.log(`📄 文档: ${stylesData.metadata.documentTitle}`);
  console.log(`🔗 URL: ${stylesData.metadata.documentURL}`);
  console.log(`📈 总元素数: ${stylesData.metadata.totalElements}`);
  console.log(`⏱️  处理时间: ${stylesData.metadata.processingTime}`);
  console.log(`🕐 时间戳: ${stylesData.metadata.timestamp}`);
  console.log(`⚙️  配置:`, stylesData.metadata.config);
  console.groupEnd();

  // 统计元素类型
  const elementTypes = {};
  const countElements = (styles) => {
    styles.forEach(style => {
      const tag = style.t || style.tagName;
      elementTypes[tag] = (elementTypes[tag] || 0) + 1;
      if (style.children) {
        countElements(style.children);
      }
    });
  };
  countElements(stylesData.styles);

  console.group('📋 元素类型统计');
  Object.entries(elementTypes)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .forEach(([tag, count]) => {
      console.log(`${tag}: ${count}`);
    });
  console.groupEnd();
}

// 预设配置
const PRESETS = {
  // 最小化配置（只提取基本样式）
  minimal: {
    includeDimensions: true,
    includeBoxModel: true,
    includeAppearance: true,
    includeText: false,
    includeLayout: false,
    includeFlex: false,
    includeGrid: false,
    skipDefaultValues: true,
    skipHiddenElements: true,
    compactFieldNames: true,
    minElementSize: 1
  },

  // 标准配置（平衡大小和完整性）
  standard: {
    includeDimensions: true,
    includeBoxModel: true,
    includeAppearance: true,
    includeText: true,
    includeLayout: true,
    includeFlex: false,
    includeGrid: false,
    skipDefaultValues: true,
    skipHiddenElements: true,
    compactFieldNames: true,
    minElementSize: 0
  },

  // 完整配置（包含所有样式）
  full: {
    includeDimensions: true,
    includeBoxModel: true,
    includeAppearance: true,
    includeText: true,
    includeLayout: true,
    includeFlex: true,
    includeGrid: true,
    skipDefaultValues: false,
    skipHiddenElements: false,
    compactFieldNames: false,
    minElementSize: 0
  }
};

// 导出函数
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    getElementStyles,
    getAllElementStyles,
    getDocumentStyles,
    getIframeStyles,
    exportStylesToJSON,
    printStylesStats,
    PRESETS,
    DEFAULT_CONFIG
  };
} else {
  window.StyleExtractor = {
    getElementStyles,
    getAllElementStyles,
    getDocumentStyles,
    getIframeStyles,
    exportStylesToJSON,
    printStylesStats,
    PRESETS,
    DEFAULT_CONFIG
  };
}
