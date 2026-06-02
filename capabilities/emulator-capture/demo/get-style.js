/**
 * 获取元素样式数据的工具库
 * 递归获取从body开始的所有元素的外观信息
 */

/**
 * 获取单个元素的样式信息
 * @param {Element} element - DOM元素
 * @returns {Object} 元素的样式信息
 */
function getElementStyles(element) {
  if (!element || element.nodeType !== 1) {
    return null;
  }

  const computedStyle = window.getComputedStyle(element);
  const rect = element.getBoundingClientRect();

  // 获取元素的基本信息
  const styleInfo = {
    tagName: element.tagName.toLowerCase(),
    className: element.className || '',
    id: element.id || '',

    // 尺寸和位置信息
    dimensions: {
      width: rect.width,
      height: rect.height,
      x: rect.x,
      y: rect.y,
      top: rect.top,
      left: rect.left,
      right: rect.right,
      bottom: rect.bottom
    },

    // 盒模型
    boxModel: {
      margin: [
        parseFloat(computedStyle.marginTop) || 0,
        parseFloat(computedStyle.marginRight) || 0,
        parseFloat(computedStyle.marginBottom) || 0,
        parseFloat(computedStyle.marginLeft) || 0
      ],
      padding: [
        parseFloat(computedStyle.paddingTop) || 0,
        parseFloat(computedStyle.paddingRight) || 0,
        parseFloat(computedStyle.paddingBottom) || 0,
        parseFloat(computedStyle.paddingLeft) || 0
      ],
      border: [
        parseFloat(computedStyle.borderTopWidth) || 0,
        parseFloat(computedStyle.borderRightWidth) || 0,
        parseFloat(computedStyle.borderBottomWidth) || 0,
        parseFloat(computedStyle.borderLeftWidth) || 0
      ]
    },

    // 外观样式
    appearance: {
      backgroundColor: computedStyle.backgroundColor || 'transparent',
      backgroundImage: computedStyle.backgroundImage || 'none',
      backgroundSize: computedStyle.backgroundSize || 'auto',
      backgroundPosition: computedStyle.backgroundPosition || '0% 0%',
      backgroundRepeat: computedStyle.backgroundRepeat || 'repeat',

      // 边框
      borderColor: [
        computedStyle.borderTopColor || 'rgb(0, 0, 0)',
        computedStyle.borderRightColor || 'rgb(0, 0, 0)',
        computedStyle.borderBottomColor || 'rgb(0, 0, 0)',
        computedStyle.borderLeftColor || 'rgb(0, 0, 0)'
      ],
      borderStyle: [
        computedStyle.borderTopStyle || 'none',
        computedStyle.borderRightStyle || 'none',
        computedStyle.borderBottomStyle || 'none',
        computedStyle.borderLeftStyle || 'none'
      ],

      // 圆角
      borderRadius: [
        computedStyle.borderTopLeftRadius || '0px',
        computedStyle.borderTopRightRadius || '0px',
        computedStyle.borderBottomRightRadius || '0px',
        computedStyle.borderBottomLeftRadius || '0px'
      ],

      // 阴影
      boxShadow: computedStyle.boxShadow || 'none',

      // 透明度
      opacity: parseFloat(computedStyle.opacity) || 1,

      // 变换
      transform: computedStyle.transform || 'none',
      transformOrigin: computedStyle.transformOrigin || '50% 50% 0px'
    },

    // 文本样式
    text: {
      color: computedStyle.color || 'rgb(0, 0, 0)',
      fontSize: computedStyle.fontSize || '16px',
      fontFamily: computedStyle.fontFamily || 'Times New Roman',
      fontWeight: computedStyle.fontWeight || '400',
      fontStyle: computedStyle.fontStyle || 'normal',
      lineHeight: computedStyle.lineHeight || 'normal',
      textAlign: computedStyle.textAlign || 'start',
      textDecoration: computedStyle.textDecoration || 'none solid rgb(0, 0, 0)',
      textShadow: computedStyle.textShadow || 'none',
      letterSpacing: computedStyle.letterSpacing || 'normal',
      wordSpacing: computedStyle.wordSpacing || 'normal'
    },

    // 布局相关
    layout: {
      display: computedStyle.display || 'block',
      position: computedStyle.position || 'static',
      visibility: computedStyle.visibility || 'visible',
      overflow: computedStyle.overflow || 'visible',
      overflowX: computedStyle.overflowX || 'visible',
      overflowY: computedStyle.overflowY || 'visible',
      zIndex: computedStyle.zIndex || 'auto',
      float: computedStyle.float || 'none',
      clear: computedStyle.clear || 'none'
    },

    // Flex布局
    flex: {
      flexDirection: computedStyle.flexDirection || 'row',
      justifyContent: computedStyle.justifyContent || 'flex-start',
      alignItems: computedStyle.alignItems || 'stretch',
      alignContent: computedStyle.alignContent || 'stretch',
      flexWrap: computedStyle.flexWrap || 'nowrap',
      flexGrow: computedStyle.flexGrow || '0',
      flexShrink: computedStyle.flexShrink || '1',
      flexBasis: computedStyle.flexBasis || 'auto',
      gap: computedStyle.gap || 'normal',
      rowGap: computedStyle.rowGap || 'normal',
      columnGap: computedStyle.columnGap || 'normal'
    },

    // Grid布局
    grid: {
      gridTemplateColumns: computedStyle.gridTemplateColumns || 'none',
      gridTemplateRows: computedStyle.gridTemplateRows || 'none',
      gridTemplateAreas: computedStyle.gridTemplateAreas || 'none',
      gridGap: computedStyle.gridGap || '0px 0px',
      gridRowGap: computedStyle.gridRowGap || '0px',
      gridColumnGap: computedStyle.gridColumnGap || '0px'
    }
  };

  return styleInfo;
}

/**
 * 递归获取元素及其所有子元素的样式信息
 * @param {Element} element - 起始元素
 * @param {number} depth - 当前深度（用于层级标识）
 * @returns {Array} 样式信息数组
 */
function getAllElementStyles(element, depth = 0) {
  const result = [];

  if (!element || element.nodeType !== 1) {
    return result;
  }

  // 获取当前元素的样式
  const styleInfo = getElementStyles(element);
  if (styleInfo) {
    styleInfo.depth = depth;
    styleInfo.children = [];
    result.push(styleInfo);
  }

  // 递归获取子元素
  const children = element.children;
  for (let i = 0; i < children.length; i++) {
    const childStyles = getAllElementStyles(children[i], depth + 1);
    if (childStyles.length > 0) {
      // 将子元素添加到当前元素的children数组中
      if (result[0]) {
        result[0].children = childStyles;
      }
      result.push(...childStyles);
    }
  }

  return result;
}

/**
 * 获取整个页面的样式数据（从body开始）
 * @param {Document} doc - 文档对象（默认为当前文档）
 * @returns {Object} 包含所有样式数据的对象
 */
function getDocumentStyles(doc = document) {
  const startTime = performance.now();

  const body = doc.body;
  if (!body) {
    console.error('Document body not found');
    return null;
  }

  const allStyles = getAllElementStyles(body, 0);

  const endTime = performance.now();

  return {
    metadata: {
      totalElements: allStyles.length,
      processingTime: `${(endTime - startTime).toFixed(2)}ms`,
      timestamp: new Date().toISOString(),
      documentTitle: doc.title || '',
      documentURL: doc.location?.href || ''
    },
    styles: allStyles
  };
}

/**
 * 获取iframe内文档的样式数据
 * @param {HTMLIFrameElement} iframe - iframe元素
 * @returns {Promise<Object>} 包含所有样式数据的Promise
 */
function getIframeStyles(iframe) {
  return new Promise((resolve, reject) => {
    try {
      const iframeDoc = iframe.contentDocument || iframe.contentWindow.document;

      if (!iframeDoc) {
        reject(new Error('Cannot access iframe document'));
        return;
      }

      // 等待iframe加载完成
      if (iframeDoc.readyState === 'complete') {
        const styles = getDocumentStyles(iframeDoc);
        resolve(styles);
      } else {
        iframe.addEventListener('load', () => {
          const styles = getDocumentStyles(iframeDoc);
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
 * @param {Object} stylesData - 样式数据对象
 * @returns {string} JSON字符串
 */
function exportStylesToJSON(stylesData) {
  return JSON.stringify(stylesData, null, 2);
}

/**
 * 打印样式统计信息
 * @param {Object} stylesData - 样式数据对象
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
  console.groupEnd();

  // 统计元素类型
  const elementTypes = {};
  stylesData.styles.forEach(style => {
    const tag = style.tagName;
    elementTypes[tag] = (elementTypes[tag] || 0) + 1;
  });

  console.group('📋 元素类型统计');
  Object.entries(elementTypes)
    .sort((a, b) => b[1] - a[1])
    .forEach(([tag, count]) => {
      console.log(`${tag}: ${count}`);
    });
  console.groupEnd();
}

// 导出函数（支持ES6模块和全局变量）
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    getElementStyles,
    getAllElementStyles,
    getDocumentStyles,
    getIframeStyles,
    exportStylesToJSON,
    printStylesStats
  };
} else {
  // 浏览器环境下挂载到全局对象
  window.StyleExtractor = {
    getElementStyles,
    getAllElementStyles,
    getDocumentStyles,
    getIframeStyles,
    exportStylesToJSON,
    printStylesStats
  };
}
