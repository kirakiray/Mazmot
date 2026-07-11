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
    <link
      rel="stylesheet"
      href="https://punch-ui-v2.pages.dev/packages/css/pui-global.css"
    />
    <l-m
      src="/capabilities/capability-diagnosis/src/capability-diagnosis.html"
    ></l-m>
    <l-m src="/comps/cap-request/cap-request.html"></l-m>
  </head>
  <body>
    <!-- 测试内容 -->
  </body>
</html>
```

## 核心标签

| 标签                             | 作用                                                                            |
| -------------------------------- | ------------------------------------------------------------------------------- |
| `<capability-diagnosis>`         | 测试容器，`label` 属性设置标题                                                  |
| `<cap-request>`                  | 包裹所有能力调用                                                                |
| `<template>` (在 cap-request 内) | 发起能力调用，`name` 指定能力名，`cid` 唯一标识，`desc` 描述，`data-*` 传递参数 |
| `<template result>`              | 断言结果，通过 `cid` 与调用配对                                                 |

断言函数返回 `{ assert: boolean, content: any }`，所有 `assert` 为 `true` 则测试通过。

## 纯脚本能力测试

纯脚本能力（SKILL.md 含 `method` 字段）直接调用：

```html
<capability-diagnosis label="测试 fetch-url 能力">
  <cap-request>
    <template
      name="fetch-url"
      cid="fetch-01"
      desc="请求本地文件"
      data-url="/package.json"
    ></template>
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
</capability-diagnosis>
```

若能力需要传入脚本内容（如 `run-js`），使用 `<script type="text/plain">`：

```html
<template name="run-js" cid="run-js-01" desc="运行 1+2+3">
  <script type="text/plain">
    return 1 + 2 + 3;
  </script>
</template>
```

## 应用开发模式能力测试

部分能力（如 `emulator-navigate`、`emulator-console`、`emulator-inspect`、`emulator-interact` 等）只能在应用开发模式下运行，它们的 SKILL.md 描述中会标注"只有在应用开发模式下可用"。测试这类能力时需要模拟器：

1. 添加 `<iframe slot="emulator">` 作为模拟器容器（`slot="emulator"` 不可省略）
2. 使用 `emulator-navigate` 能力导航到目标页面

```html
<capability-diagnosis label="测试应用开发模式能力">
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
          assert:
            result.success &&
            result.url.includes("/capabilities/custom-form/src/form.html"),
          content: result,
        };
      }
    </script>
  </template>
</capability-diagnosis>
```

`emulator-navigate` 的 `go` 操作返回 `{ success: boolean, url: string }`。

## 页面交互能力测试

页面类型能力（SKILL.md 含 `page` 字段）会渲染 UI 组件并等待用户交互（如提交表单、点击按钮等）。测试时需要通过 `<template interaction>` 编程式驱动交互，否则测试将因等待用户操作而卡住。

### interaction 模板

`<template interaction>` 在页面 `init` 完成后自动执行，用于模拟用户操作。通过 `cid` 与调用配对。

| 属性          | 必需 | 说明                    |
| ------------- | ---- | ----------------------- |
| `interaction` | 是   | 标记为交互脚本模板      |
| `cid`         | 是   | 与调用模板的 `cid` 配对 |

脚本导出的函数接收一个参数 —— ofa.js 实例化的 page 对象，可直接访问其 `data`、调用其 `proto` 方法。

```html
<capability-diagnosis label="测试 custom-form 能力">
  <cap-request>
    <template name="custom-form" cid="form-01" desc="测试表单提交">
      [{"type":"text","name":"username","desc":"用户名","required":true,"placeholder":"请输入用户名"},{"type":"radio","name":"gender","desc":"性别","required":true,"options":[{"label":"男","value":"male"},{"label":"女","value":"female"}],"defaultValue":"male"},{"type":"submit","name":"提交"},{"type":"cancel","name":"取消"}]
    </template>
  </cap-request>

  <!-- 交互脚本：在页面 init 后自动执行，模拟用户操作 -->
  <template interaction cid="form-01">
    <script type="module">
      export default async function (page) {
        // page 是 ofa.js 实例化对象，可直接操作其数据和方法
        page.formItems[0].value = "test-user";
        page.formItems[1].value = "male";
        // 触发提交，使页面 emit submit 事件
        page.submit();
      }
    </script>
  </template>

  <!-- 断言结果 -->
  <template result cid="form-01">
    <script type="module">
      export default async function (result) {
        return {
          assert: result.username === "test-user" && result.gender === "male",
          content: result,
        };
      }
    </script>
  </template>
</capability-diagnosis>
```

### 执行流程

```
页面加载 → page.init() → 执行 interaction 脚本 → 页面 emit submit/cancel → 断言
```

### 参数说明

**重要**：断言函数的 `data` 参数对应页面 `emit("submit", {data})` 中传入的 `data` 字段值。

```javascript
// 页面代码中的 emit
this.emit("submit", {
  data: {
    username: "test-user",
    gender: "male",
  },
});

export default async function (data) {
  // data === { username: "test-user", gender: "male" }
  return {
    assert: data.username === "test-user",
    content: data,
  };
}
```

> **注意**：示例中参数名使用 `data` 是为了方便理解对应关系。在实际测试代码中，通常使用 `result` 作为参数名，两者是等价的。

### 测试取消操作

```html
<template interaction cid="form-cancel-01">
  <script type="module">
    export default async function (page) {
      page.cancel();
    }
  </script>
</template>
```

## 规则

- 每个 `<template>` 的 `cid` 必须唯一，用于关联调用与断言
- **每个 `<template>` 调用都必须有一个对应的 `<template result>`，通过 `cid` 一一配对**
- `<cap-request>` 内的多个 `<template>` 按顺序执行
- 测试应用开发模式能力时，`<iframe slot="emulator">` 必须放在 `<cap-request>` 之前
- 普通能力和应用开发模式能力可在同一个 `<capability-diagnosis>` 中混合测试
- 页面交互能力必须提供 `<template interaction>`，否则测试将因等待用户操作而无法完成
