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

### 返回值

返回指定元素的信息对象：

```javascript
{
  tag: "div",           // 元素标签名
  attrs: {},            // 元素属性对象
  childs: [],           // 子元素数组
  text: "",             // 文本内容
  styles: {},           // 计算样式
  rect: {               // 元素位置和尺寸
    x: 0,
    y: 0,
    width: 100,
    height: 50
  }
}
```

### 使用示例

获取 body 下的所有子元素：

<cap-request>
  <template name="emulator-inspect" cid="inspect-01" data-xpath="/html/body" desc="获取 body 元素信息"></template>
</cap-request>

获取特定 ID 的元素：

<cap-request>
  <template name="emulator-inspect" cid="inspect-02" data-xpath="/html/body/div[@id='app']" desc="获取 ID 为 app 的 div 元素"></template>
</cap-request>
