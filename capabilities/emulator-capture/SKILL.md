---
name: emulator-capture
description: 获取应用模拟器视图，支持获取当前应用模拟器的元素样式信息或页面截图；只有在应用开发模式下可用。
method: main.js
---

# 模拟器视图捕获

**emulator-capture** 用于在应用开发模式下获取模拟器的视图信息。支持获取指定元素的样式信息或截取当前页面截图。

## 获取元素样式

使用 `element-style` 操作获取指定元素的样式信息：

<cap-request>
  <template name="emulator-capture" cid="cap001" desc="获取元素样式信息" data-action="element-style" data-selector="#target-element"></template>
</cap-request>

工具将返回指定元素的计算样式信息。

参数说明：

- `data-selector`：CSS 选择器，用于定位目标元素

## 获取页面截图

使用 `screenshot` 操作获取当前模拟器页面的截图：

<cap-request>
  <template name="emulator-capture" cid="cap002" desc="获取模拟器页面截图" data-action="screenshot"></template>
</cap-request>

工具将返回当前模拟器页面的截图数据（Base64 格式）。

## 获取失败

当操作失败时，将返回错误信息：

<cap-response>
  <template error name="emulator-capture" cid="cap003">
    {
      "success": false,
      "error": "Element not found"
    }
  </template>
</cap-response>

常见错误情况：

- 元素选择器未匹配到任何元素 → `error: "Element not found"`
- iframe 不可用或未加载完成 → `error: "Iframe not available"`
- 截图生成失败 → `error: "Screenshot failed"`
