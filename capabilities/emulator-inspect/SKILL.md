---
name: emulator-inspect
description: 让AI拥有像浏览器调试视察元素面板一样的功能；支持获取模拟器内的元素，有哪些元素，包含元素特征；也支持获取特定元素的样式信息，包括盒模型、定位、大小等；只有在应用开发模式下可用。
method: main.js
test: test/test-inspect.html
---

# 模拟器元素检查

用于获取模拟器内指定元素的信息，包括元素标签、属性、子元素、样式等。类似于浏览器开发者工具的元素检查功能。

## 使用方法

<cap-request>
  <template name="emulator-inspect" cid="inspect-01" data-xpath="/html/body" desc="获取模拟器内的 body 下的元素"></template>
</cap-request>

### 参数说明

- `data-xpath` (必需): XPath 表达式，指定要检查的元素路径
- `data-depth` (可选): 获取子元素的深度，默认为 1
- `data-max-size` (可选): 返回数据的最大大小（字节），默认为 32KB (1024 * 32)。超过此限制将抛出错误
- `data-styles` (可选): 需要获取的 CSS 样式属性，逗号分隔格式。例如：`data-styles="display, position, width"`。不传则不返回样式信息

⚠️ **警告**: 请谨慎使用 `data-depth` 参数。深度过大会导致返回数据量爆炸式增长，大幅消耗 AI 的 token 颞度。建议仅在必要时使用，且深度不超过 3。

### 返回值

返回指定元素的信息对象：

**当 depth > 0 时（有子元素信息）：**

```javascript
{
  tag: "div",           // 元素标签名
  attrs: {},            // 元素属性对象
  childs: [             // 子节点数组（保持原始顺序）
    { type: "text", text: "文本内容" },  // 文本节点
    { tag: "span", attrs: {}, ... }  // 元素节点
  ],
  text: "",             // 所有文本内容的合并（用于快速访问）
  rect: {               // 元素位置和尺寸
    x: 0,
    y: 0,
    width: 100,
    height: 50
  }
}
```

**当 depth = 0 时（最后一层，无子元素信息）：**

```javascript
{
  tag: "div",           // 元素标签名
  attrs: {},            // 元素属性对象
  childsLength: 2,      // 子节点数量（包括文本节点）
  childrenLength: 1,    // 子元素数量（不包括文本节点）
  text: "",             // 所有文本内容的合并（用于快速访问）
  rect: {               // 元素位置和尺寸
    x: 0,
    y: 0,
    width: 100,
    height: 50
  }
}
```

**注意**：
- `styles` 字段只有传入 `data-styles` 参数时才会返回
- `childs` 字段只在 depth > 0 时才返回
- `childsLength` 和 `childrenLength` 只在 depth = 0 时才返回
- `shadowRoot` 字段只有元素有 Shadow DOM 时才返回

### Shadow DOM 支持

当元素包含 Shadow DOM 时，`shadowRoot` 字段会返回 Shadow DOM 内部结构：

```javascript
{
  shadowRoot: {
    mode: "open",       // Shadow DOM 模式（"open" 或 "closed"）
    childsLength: 2,    // Shadow DOM 内子元素数量
    childs: [           // Shadow DOM 内子元素数组
      { tag: "style", ... },
      { tag: "div", attrs: {}, childs: [], ... }
    ]
  }
}
```

**注意**：XPath 无法穿透 Shadow DOM 边界。要获取 Shadow DOM 内的元素，需要先获取宿主元素，然后通过 `shadowRoot` 字段查看内部结构。

### 使用示例

获取 body 下的所有子元素：

<cap-request>
  <template name="emulator-inspect" cid="inspect-01" data-xpath="/html/body" desc="获取 body 元素信息"></template>
</cap-request>

获取特定 ID 的元素：

<cap-request>
  <template name="emulator-inspect" cid="inspect-02" data-xpath="/html/body/div[@id='app']" desc="获取 ID 为 app 的 div 元素"></template>
</cap-request>

获取元素及其子元素的子元素（深度为 2）：

<cap-request>
  <template name="emulator-inspect" cid="inspect-03" data-xpath="/html/body" data-depth="2" desc="获取 body 元素及其两层子元素"></template>
</cap-request>

限制返回数据大小为 16KB：

<cap-request>
  <template name="emulator-inspect" cid="inspect-04" data-xpath="/html/body" data-max-size="16384" desc="获取 body 元素信息（限制 16KB）"></template>
</cap-request>

获取 CSS 样式属性：

<cap-request>
  <template name="emulator-inspect" cid="inspect-05" data-xpath="/html/body/div" data-styles="display, position, width, height, z-index" desc="获取 div 元素及其样式"></template>
</cap-request>
