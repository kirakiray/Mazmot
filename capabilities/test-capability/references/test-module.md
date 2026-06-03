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

## 测试页面交互能力

能力分为**纯脚本能力**（SKILL.md 中包含 `method` 字段）和**页面交互能力**（SKILL.md 中包含 `page` 字段）。前面介绍的 `fetch-url`、`run-js` 属于纯脚本能力，而 `custom-form`、`preview-web` 等属于页面交互能力。

页面交互能力会在模拟器中渲染可视化界面，因此测试时需要：

1. 在 `<test-capability>` 内添加一个 `<iframe slot="emulator">` 作为模拟器容器
2. 使用 `emulator-navigate` 能力控制模拟器导航，触发页面交互能力的加载

### 添加模拟器 iframe

在 `<test-capability>` 内部、`<cap-request>` 之前添加一个空的 iframe，并设置 `slot="emulator"`：

```html
<test-capability label="测试页面交互能力">
  <iframe src="" frameborder="0" slot="emulator"></iframe>
  <cap-request>
    ...
  </cap-request>
</test-capability>
```

### 使用 emulator-navigate 导航

`emulator-navigate` 是一个纯脚本能力，用于控制模拟器的页面导航。测试页面交互能力时，通过 `data-action="go"` 和 `data-url` 将模拟器导航到目标页面：

```html
<cap-request>
  <template
    name="emulator-navigate"
    data-action="go"
    data-url="/capabilities/custom-form/src/form.html"
    cid="emulator-navigate-01"
    desc="导航到 custom-form 页面"
  >
  </template>
</cap-request>
```

### 断言导航结果

`emulator-navigate` 的 `go` 操作返回一个包含 `success` 和 `url` 属性的对象。在 `<template result>` 中通过检查这两个属性来验证页面是否成功加载：

```html
<template result cid="emulator-navigate-01">
  <script type="module">
    export default async function (result) {
      return {
        assert:
          result.success &&
          result.url.includes("/capabilities/custom-form/src/form.html"),
        content: result,
      };
    }
  </script>
</template>
```

### 代码说明

- **`<iframe slot="emulator">`**：为 `<test-capability>` 组件提供模拟器容器，页面交互能力将在此 iframe 中渲染。`slot="emulator"` 是固定写法，不可省略。
- **`emulator-navigate`**：通过 `data-action="go"` 跳转到指定 URL，`data-url` 指定目标页面地址。导航成功后返回 `{ success: true, url: "..." }`，失败时返回错误响应。
- **断言逻辑**：同时检查 `result.success` 为 `true` 且 `result.url` 包含目标路径，确保页面确实导航到了预期地址。

### 混合测试示例

以下示例同时测试纯脚本能力和页面交互能力：

```html
<test-capability label="测试多个能力">
  <iframe src="" frameborder="0" slot="emulator"></iframe>
  <cap-request>
    <template
      name="fetch-url"
      cid="fetch-01"
      desc="请求 package.json 文件内容"
      data-url="/package.json"
    >
    </template>
    <template
      name="emulator-navigate"
      data-action="go"
      data-url="/capabilities/custom-form/src/form.html"
      cid="emulator-navigate-01"
      desc="导航到 custom-form 页面"
    >
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
  <template result cid="emulator-navigate-01">
    <script type="module">
      export default async function (result) {
        return {
          assert:
            result.success &&
            result.url.includes("/capabilities/custom-form/src/form.html"),
          content: result,
        };
      }
    </script>
  </template>
</test-capability>
```

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
