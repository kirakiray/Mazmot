# 002 · 取当前页面 / 诊断渲染要查 `o-app > o-page`（本版本 `$('o-app').current` 为 undefined）

**症状**：`action=dom` 查 `<o-app>` 只返回 `#shadow-root`（里面只有 `<style>` + `<slot>`，看不到任何页面内容），`$('o-app').current` / `document.querySelector('o-app').current` 全是 `undefined`，`pg.data` 也读不到——看起来像「页面根本没渲染」，容易误判成页面模块加载失败而反复改代码。

**根因**：本环境的 ofa.js 版本里 `o-app` 把当前页面作为**插槽子节点放在自己的 light DOM**（`<o-app src="..."><o-page src=".../pages/home.html"></o-page></o-app>`），`current` 属性没有暴露。页面内容实际都在那个 `<o-page>` 的 shadowRoot 里，所以从 `o-app` 的 shadowRoot 里当然找不到东西；此外 `pg.data` 在该版本也没有对外暴露。

**正确姿势**：诊断当前页面的渲染 / 状态时：
- 直接用 `eval` 取 `document.querySelector('o-app > o-page').shadowRoot`，再在其内 `querySelector('.greeting')` / `querySelectorAll('.chip')` 读真实 DOM；
- 页面内部状态（`data` 字段）对外不可读时，**用可观测的副作用替代**——本应用在 `ready()` 里置了 `window.__helloReady = true`，`eval` 读它即可确认生命周期是否执行、页面模块是否真的跑起来了；
- `action=dom` 的 selector 直接给 `o-app > o-page` 或页面内的类名，别只看 `o-app`。
