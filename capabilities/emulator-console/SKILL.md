---
name: emulator-console
description: 获取应用模拟器日志，支持获取或清空当前应用模拟器的控制台打印信息；只有在应用开发模式下可用。
method: main.js
test: test/test-emulator-console.html
---

# 模拟器控制台日志

**emulator-console** 用于在应用开发模式下获取或清空模拟器的控制台日志。支持获取当前日志内容和清空日志记录。

## 获取控制台日志

使用 `get` 操作获取当前模拟器的控制台日志：

<cap-request>
  <template name="emulator-console" cid="log001" desc="获取模拟器控制台日志" data-action="get"></template>
</cap-request>

工具将返回当前模拟器的控制台日志内容。

## 清空控制台日志

使用 `clear` 操作清空模拟器的控制台日志：

<cap-request>
  <template name="emulator-console" cid="log002" desc="清空模拟器控制台日志" data-action="clear"></template>
</cap-request>

工具将清空模拟器中的控制台日志记录，并返回清空状态。
