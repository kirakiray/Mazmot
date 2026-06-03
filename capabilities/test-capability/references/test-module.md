# 能力测试用例编写指南

## 文件位置与配置

测试用例放在能力目录的 `test` 下，在 SKILL.md 中通过 `test` 字段指定路径：

```yaml
---
name: fetch-url
description: 从指定 URL 获取内容
method: main.js
test: test/test-fetch-url.html
---
```

## HTML 模板

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>测试 xxx 能力</title>
    <script src="/gh/ofajs/ofa.js/dist/ofa.mjs#debug" type="module"></script>
    <link rel="stylesheet" href="https://punch-ui-v2.pages.dev/packages/css/pui-global.css" />
    <l-m src="/capabilities/test-capability/src/test-capability.html"></l-m>
    <l-m src="/comps/cap-request/cap-request.html"></l-m>
  </head>
  <body>
    <!-- 测试内容 -->
  </body>
</html>
```

## 核心标签

| 标签 | 作用 |
|------|------|
| `<test-capability>` | 测试容器，`label` 属性设置标题 |
| `<cap-request>` | 包裹所有能力调用 |
| `<template>` (在 cap-request 内) | 发起能力调用，`name` 指定能力名，`cid` 唯一标识，`desc` 描述，`data-*` 传递参数 |
| `<template result>` | 断言结果，通过 `cid` 与调用配对 |

断言函数返回 `{ assert: boolean, content: any }`，所有 `assert` 为 `true` 则测试通过。

## 纯脚本能力测试

纯脚本能力（SKILL.md 含 `method` 字段）直接调用：

```html
<test-capability label="测试 fetch-url 能力">
  <cap-request>
    <template name="fetch-url" cid="fetch-01" desc="请求本地文件" data-url="/package.json"></template>
  </cap-request>
  <template result cid="fetch-01">
    <script type="module">
      export default async function (result) {
        const data = await fetch("/package.json");
        const jsonText = await data.text();
        return { assert: jsonText === result, content: "获取成功" };
      }
    </script>
  </template>
</test-capability>
```

若能力需要传入脚本内容（如 `run-js`），使用 `<script type="text/plain">`：

```html
<template name="run-js" cid="run-js-01" desc="运行 1+2+3">
  <script type="text/plain">
    return 1 + 2 + 3;
  </script>
</template>
```

## 页面交互能力测试

页面交互能力（SKILL.md 含 `page` 字段）需在模拟器中渲染，需要：

1. 添加 `<iframe slot="emulator">` 作为模拟器容器（`slot="emulator"` 不可省略）
2. 使用 `emulator-navigate` 能力导航到目标页面

```html
<test-capability label="测试页面交互能力">
  <iframe src="" frameborder="0" slot="emulator"></iframe>
  <cap-request>
    <template
      name="emulator-navigate"
      data-action="go"
      data-url="/capabilities/custom-form/src/form.html"
      cid="nav-01"
      desc="导航到 custom-form 页面"
    ></template>
  </cap-request>
  <template result cid="nav-01">
    <script type="module">
      export default async function (result) {
        return {
          assert: result.success && result.url.includes("/capabilities/custom-form/src/form.html"),
          content: result,
        };
      }
    </script>
  </template>
</test-capability>
```

`emulator-navigate` 的 `go` 操作返回 `{ success: boolean, url: string }`。

## 规则

- 每个 `<template>` 的 `cid` 必须唯一，用于关联调用与断言
- `<cap-request>` 内的多个 `<template>` 按顺序执行
- 测试页面交互能力时，`<iframe slot="emulator">` 必须放在 `<cap-request>` 之前
- 纯脚本能力和页面交互能力可在同一个 `<test-capability>` 中混合测试
