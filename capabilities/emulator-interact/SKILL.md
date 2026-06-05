---
name: emulator-interact
description: 与应用模拟器交互，支持对当前应用模拟器中的指定元素进行点击、输入、聚焦、滚动等操作；只有在应用开发模式下可用。
method: main.js
test: test/test-interact.html
---

# 模拟器交互操作

**emulator-interact** 用于在应用开发模式下与模拟器内的元素进行交互操作。支持点击、输入、聚焦、滚动等多种交互方式。

## 参数说明

所有操作都需要以下基础参数：

- `data-xpath` (必需): XPath 表达式，指定要操作的元素路径
- `data-action` (必需): 操作类型，支持以下值：
  - `click` - 点击元素
  - `input` - 输入文本
  - `focus` - 聚焦元素
  - `blur` - 失焦元素
  - `scroll` - 滚动到元素
  - `select` - 选择文本
  - `clear` - 清空输入框
  - `hover` - 鼠标悬停
  - `getAttribute` - 获取属性值
  - `setValue` - 设置属性值
- `data-value` (可选): 根据操作类型不同，含义不同
- `data-options` (可选): 操作选项，JSON 格式字符串

## 操作详解

### 1. 点击元素 (click)

点击指定元素，支持单击和双击。

**参数**：
- `data-xpath`: 元素路径
- `data-action`: "click"
- `data-options`: JSON 字符串，可选字段：
  - `doubleClick`: 是否双击，默认 false
  - `button`: 鼠标按钮，可选 "left"、"right"、"middle"，默认 "left"

**示例**：

<cap-request>
  <template name="emulator-interact" cid="click-01" data-xpath="/html/body/div/button" data-action="click" desc="点击按钮"></template>
</cap-request>

双击示例：

<cap-request>
  <template name="emulator-interact" cid="click-02" data-xpath="/html/body/div" data-action="click" data-options='{"doubleClick": true}' desc="双击元素"></template>
</cap-request>

**返回值**：

```javascript
{
  success: true,
  action: "click",
  xpath: "/html/body/div/button",
  message: "已点击元素",
  position: { x: 100, y: 50 }
}
```

### 2. 输入文本 (input)

向输入框或文本区域输入文本内容。

**参数**：
- `data-xpath`: 输入元素路径
- `data-action`: "input"
- `data-value`: 要输入的文本内容
- `data-options`: JSON 字符串，可选字段：
  - `clear`: 是否先清空输入框，默认 false
  - `delay`: 输入延迟（毫秒），模拟逐字输入，默认 0

**示例**：

<cap-request>
  <template name="emulator-interact" cid="input-01" data-xpath="/html/body/input[@type='text']" data-action="input" data-value="Hello World" desc="输入文本"></template>
</cap-request>

清空并输入：

<cap-request>
  <template name="emulator-interact" cid="input-02" data-xpath="/html/body/input" data-action="input" data-value="新内容" data-options='{"clear": true}' desc="清空并输入文本"></template>
</cap-request>

模拟逐字输入：

<cap-request>
  <template name="emulator-interact" cid="input-03" data-xpath="/html/body/input" data-action="input" data-value="测试文本" data-options='{"delay": 50}' desc="逐字输入文本"></template>
</cap-request>

**返回值**：

```javascript
{
  success: true,
  action: "input",
  xpath: "/html/body/input",
  message: "已输入文本",
  value: "Hello World"
}
```

### 3. 聚焦元素 (focus)

将焦点设置到指定元素。

**参数**：
- `data-xpath`: 元素路径
- `data-action`: "focus"

**示例**：

<cap-request>
  <template name="emulator-interact" cid="focus-01" data-xpath="/html/body/input" data-action="focus" desc="聚焦输入框"></template>
</cap-request>

**返回值**：

```javascript
{
  success: true,
  action: "focus",
  xpath: "/html/body/input",
  message: "已聚焦元素"
}
```

### 4. 失焦元素 (blur)

让指定元素失去焦点。

**参数**：
- `data-xpath`: 元素路径
- `data-action`: "blur"

**示例**：

<cap-request>
  <template name="emulator-interact" cid="blur-01" data-xpath="/html/body/input" data-action="blur" desc="失焦输入框"></template>
</cap-request>

**返回值**：

```javascript
{
  success: true,
  action: "blur",
  xpath: "/html/body/input",
  message: "已失焦元素"
}
```

### 5. 滚动到元素 (scroll)

将页面滚动到指定元素可见位置。

**参数**：
- `data-xpath`: 元素路径
- `data-action`: "scroll"
- `data-options`: JSON 字符串，可选字段：
  - `behavior`: 滚动行为，可选 "smooth"、"auto"，默认 "smooth"
  - `block`: 垂直对齐方式，可选 "start"、"center"、"end"、"nearest"，默认 "center"
  - `inline`: 水平对齐方式，可选 "start"、"center"、"end"、"nearest"，默认 "nearest"

**示例**：

<cap-request>
  <template name="emulator-interact" cid="scroll-01" data-xpath="/html/body/div[10]" data-action="scroll" desc="滚动到元素"></template>
</cap-request>

**返回值**：

```javascript
{
  success: true,
  action: "scroll",
  xpath: "/html/body/div[10]",
  message: "已滚动到元素",
  options: { behavior: "smooth", block: "center", inline: "nearest" }
}
```

### 6. 选择文本 (select)

选择输入框或文本区域中的文本内容。

**参数**：
- `data-xpath`: 输入元素路径
- `data-action`: "select"
- `data-value`: 可选，选择范围 [start, end] 数组，不传则选择全部文本

**示例**：

选择全部文本：

<cap-request>
  <template name="emulator-interact" cid="select-01" data-xpath="/html/body/input" data-action="select" desc="选择全部文本"></template>
</cap-request>

选择指定范围：

<cap-request>
  <template name="emulator-interact" cid="select-02" data-xpath="/html/body/input" data-action="select" data-value="[0, 5]" desc="选择前5个字符"></template>
</cap-request>

**返回值**：

```javascript
{
  success: true,
  action: "select",
  xpath: "/html/body/input",
  message: "已选择文本",
  selectedText: "Hello"
}
```

### 7. 清空输入框 (clear)

清空输入框或文本区域的内容。

**参数**：
- `data-xpath`: 输入元素路径
- `data-action`: "clear"

**示例**：

<cap-request>
  <template name="emulator-interact" cid="clear-01" data-xpath="/html/body/input" data-action="clear" desc="清空输入框"></template>
</cap-request>

**返回值**：

```javascript
{
  success: true,
  action: "clear",
  xpath: "/html/body/input",
  message: "已清空输入框"
}
```

### 8. 鼠标悬停 (hover)

将鼠标悬停在指定元素上。

**参数**：
- `data-xpath`: 元素路径
- `data-action`: "hover"

**示例**：

<cap-request>
  <template name="emulator-interact" cid="hover-01" data-xpath="/html/body/div/button" data-action="hover" desc="鼠标悬停"></template>
</cap-request>

**返回值**：

```javascript
{
  success: true,
  action: "hover",
  xpath: "/html/body/div/button",
  message: "已悬停元素",
  position: { x: 100, y: 50 }
}
```

### 9. 获取属性值 (getAttribute)

获取指定元素的属性值。

**参数**：
- `data-xpath`: 元素路径
- `data-action`: "getAttribute"
- `data-value`: 属性名称

**示例**：

<cap-request>
  <template name="emulator-interact" cid="attr-01" data-xpath="/html/body/div" data-action="getAttribute" data-value="class" desc="获取 class 属性"></template>
</cap-request>

**返回值**：

```javascript
{
  success: true,
  action: "getAttribute",
  xpath: "/html/body/div",
  message: "已获取属性值",
  attribute: "class",
  value: "container"
}
```

### 10. 设置属性值 (setValue)

设置指定元素的属性值。

**参数**：
- `data-xpath`: 元素路径
- `data-action`: "setValue"
- `data-value`: JSON 字符串，格式：`{"name": "属性名", "value": "属性值"}`

**示例**：

<cap-request>
  <template name="emulator-interact" cid="set-01" data-xpath="/html/body/div" data-action="setValue" data-value='{"name": "data-id", "value": "123"}' desc="设置 data-id 属性"></template>
</cap-request>

**返回值**：

```javascript
{
  success: true,
  action: "setValue",
  xpath: "/html/body/div",
  message: "已设置属性值",
  attribute: "data-id",
  value: "123"
}
```

## 错误处理

如果操作失败，将返回错误信息：

```javascript
{
  error: "执行操作失败: 未找到匹配 XPath 的元素: /html/body/nonexistent"
}
```

常见错误：
- XPath 路径不正确，未找到元素
- 操作类型不支持
- 缺少必需参数（如 input 操作缺少 value）
- 元素类型不支持该操作（如对非输入元素执行 clear）

## 使用建议

1. **组合操作**：可以先 `focus` 再 `input`，确保输入操作正确执行
2. **等待时机**：对于动态加载的元素，建议先使用 `emulator-inspect` 确认元素存在
3. **滚动优先**：对于不在可视区域的元素，建议先执行 `scroll` 操作
4. **测试验证**：操作完成后，可以使用 `emulator-inspect` 检查元素状态变化