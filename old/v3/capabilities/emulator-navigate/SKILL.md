---
name: emulator-navigate
description: 导航应用模拟器页面，支持获取当前页面信息、刷新页面和跳转到指定页面；只有在应用开发模式下可用。
method: main.js
test: test/test-emulator-navigate.html
---

# 模拟器导航

**emulator-navigate** 用于在应用开发模式下控制模拟器的页面导航。支持获取当前页面信息、刷新页面和跳转到指定页面。

## 获取当前页面信息

使用 `current-info` 操作获取当前模拟器的网页地址：

<cap-request>
  <template name="emulator-navigate" cid="nav001" desc="获取当前模拟器页面信息" data-action="current-info"></template>
</cap-request>

工具将返回当前模拟器页面的 URL 地址。

## 刷新当前页面

使用 `reload` 操作刷新模拟器当前所在的网页：

<cap-request>
  <template name="emulator-navigate" cid="nav002" desc="刷新当前模拟器页面" data-action="reload"></template>
</cap-request>

工具将刷新模拟器中当前显示的页面，并返回刷新后的 URL 地址。

## 跳转到指定页面

使用 `go` 操作跳转到指定的网页地址：

<cap-request>
  <template name="emulator-navigate" cid="nav003" desc="跳转到test页面" data-action="go" data-url="/$mazmot/apps/test/project/index.html"></template>
</cap-request>

工具将导航模拟器到指定的 URL 地址，并返回跳转后的 URL 地址和成功状态。

## 加载失败

`reload` 和 `go` 在等待 iframe 加载时（默认 30 秒）若发生错误或超时，操作将以失败返回，响应格式为：

<cap-response>
  <template error name="emulator-navigate" cid="nav004">
    {
      "success": false,
      "error": "Iframe load failed"   // 或 "Iframe load timeout"
    }
  </template>
</cap-response>

触发失败的常见情况：

- 目标地址不可达、网络中断，iframe 触发 `error` 事件 → `error: "Iframe load failed"`
- 页面加载耗时超过 30 秒仍未触发 `load` 事件 → `error: "Iframe load timeout"`

`current-info` 操作不涉及加载流程，不会返回失败信息。
