# 如何编写能力的测试用例

一般能力的测试用例，会放用例目录的 `test` 目录下。并且，会在能力 SKILL.md 中配置 `test` 字段，指定测试用例的路径。

例如：

```yaml
---
name: fetch-url
description: 从指定 URL 获取内容
method: main.js
test: test/test-fetch-url.html
---
```

测试的html是一个完整的html案例，需要引用 `test-capability.html` 文件。并且以来 ofa.js 库。和一用 cap-request 组件。

```html
<l-m src="/gh/ofajs/ofa.js/dist/ofa.mjs#debug" type="module"></l-m>
```

```html
<l-m src="/capabilities/test-capability/src/test-capability.html"></l-m>
```

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

像上面这个用例内容，为测试 fetch-url 能力的测试用例。其代码解释为：

- 使用 `fetch-url` 能力，data-url 请求参数为 `/package.json`。
- 测试结果会通过下面的 `script` 脚本返回，从 `result` 参数中获取测试结果。
- 然后将result 对比你实际期望的结果，判断是否一致。
- 如果一致，返回 `assert: true`，否则返回 `assert: false`。并带上 `content` 字段，说明测试结果。


完整代码:
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