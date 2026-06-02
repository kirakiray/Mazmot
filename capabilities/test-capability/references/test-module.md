# 如何编写能力的测试用例

能力的测试用例通常放在能力目录的 `test` 目录下，并在 SKILL.md 中通过 `test` 字段指定测试用例的路径。

例如：

```yaml
---
name: fetch-url
description: 从指定 URL 获取内容
method: main.js
test: test/test-fetch-url.html
---
```

## 测试用例结构

测试用例是一个完整的 HTML 文件，需要引入以下依赖：

1. **ofa.js 库**：通过 `<l-m>` 标签加载
2. **test-capability 组件**：提供测试容器和结果展示
3. **cap-request 组件**：用于发起能力调用

```html
<l-m src="/gh/ofajs/ofa.js/dist/ofa.mjs#debug" type="module"></l-m>
```

```html
<l-m src="/capabilities/test-capability/src/test-capability.html"></l-m>
```

## 用例编写示例

以下是一个测试 `fetch-url` 能力的示例：

```html
<test-capability label="测试 fetch-url 能力">
  <cap-request>
    <template
      name="fetch-url"
      cid="fetch-01"
      desc="请求本地文件内容可用"
      data-url="/package.json"
    >
    </template>
  </cap-request>
  <template result cid="fetch-01">
    <script type="module">
      export default async function (result) {
        // 直接获取内容
        const data = await fetch("/package.json");
        const jsonText = await data.text();

        return {
          assert: jsonText === result,
          content: "获取成功",
        };
      }
    </script>
  </template>
</test-capability>
```

### 代码说明

- **`<cap-request>` 部分**：调用 `fetch-url` 能力，通过 `data-url` 参数指定请求路径为 `/package.json`。
- **`<template result>` 部分**：接收能力返回的结果，`result` 参数即为能力调用的返回值。
- **断言逻辑**：将 `result` 与期望结果进行对比，一致则返回 `{ assert: true, content: "..." }`，否则返回 `{ assert: false, content: "..." }`。

## 多个测试用例

一个 `<test-capability>` 中可以包含多个能力调用，只需在 `<cap-request>` 内添加多个 `<template>`，并为每个调用提供对应的 `<template result>` 进行断言。注意每个 `<template>` 的 `cid` 必须唯一，用于关联调用与断言。

```html
<test-capability label="测试多个能力">
  <cap-request>
    <template
      name="fetch-url"
      cid="fetch-01"
      desc="请求 package.json 文件内容"
      data-url="/package.json"
    >
    </template>
    <template
      name="run-js"
      cid="run-js-01"
      desc="运行 1+2+3"
    >
      <script type="text/plain">
        return 1 + 2 + 3;
      </script>
    </template>
  </cap-request>
  <template result cid="fetch-01">
    <script type="module">
      export default async function (result) {
        const data = await fetch("/package.json");
        const jsonText = await data.text();

        return {
          assert: jsonText === result,
          content: "获取成功",
        };
      }
    </script>
  </template>
  <template result cid="run-js-01">
    <script type="module">
      export default async function (result) {
        return {
          assert: result === 6,
          content: result,
        };
      }
    </script>
  </template>
</test-capability>
```

### 说明

- `<cap-request>` 内的多个 `<template>` 会按顺序执行。
- 每个 `<template result>` 通过 `cid` 与对应的调用 `<template>` 匹配。
- 所有断言均为 `true` 时测试通过，任一为 `false` 则测试失败。

## 完整代码

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>测试 fetch-url 能力</title>
    <script src="/gh/ofajs/ofa.js/dist/ofa.mjs#debug" type="module"></script>
    <link
      rel="stylesheet"
      href="https://punch-ui-v2.pages.dev/packages/css/pui-global.css"
    />
    <l-m src="/capabilities/test-capability/src/test-capability.html"></l-m>
    <l-m src="/comps/cap-request/cap-request.html"></l-m>
  </head>

  <body>
    <test-capability label="测试 fetch-url 能力">
      <cap-request>
        <template
          name="fetch-url"
          cid="fetch-01"
          desc="请求本地文件内容可用"
          data-url="/package.json"
        >
        </template>
      </cap-request>
      <template result cid="fetch-01">
        <script type="module">
          export default async function (result) {
            // 直接获取内容
            const data = await fetch("/package.json");
            const jsonText = await data.text();

            return {
              assert: jsonText === result,
              content: "获取成功",
            };
          }
        </script>
      </template>
    </test-capability>
  </body>
</html>
```
