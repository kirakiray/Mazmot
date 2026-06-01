---
name: about-emulator
description: 帮助AI理解模拟器的技巧，应用开发模式下可用。
method: main.js
---

# 理解模拟器

在应用开发模式下，你可以使用 `emulator-navigate` 能力来获取当前模拟器的网页地址、刷新当前页面或跳转到指定页面。可通过 `get-capability` 能力获取该能力的详细使用说明。

## 相关技巧

通常情况下，获取到的地址会以 `/$` 开头，例如：`/$mazmot/apps/xxxx`。这是因为当前运行在 noneos-core 环境下，浏览器导航地址会带有此前缀，而实际的虚拟地址位于 `mazmot/apps/xxxx`，你可以通过 noneos-core 的 fs 模块来修改该文件。
