# o-md 组件

Markdown 渲染组件，支持代码高亮。

## 使用方式

### 方式一：直接内容

```html
<o-md>
## 标题
这是 **markdown** 内容
</o-md>
```

### 方式二：用 `<pre>` 标签包裹内容

适合在 HTML 编辑器内编写时使用，`<pre>` 可以保持内容的缩进和格式，避免因编辑器自动格式化导致 Markdown 排版错乱。

```html
<o-md>
  <pre>
## 标题
这是 **markdown** 内容

```javascript
const hello = "world";
```
  </pre>
</o-md>
```

## 功能特性

- **Markdown 解析** - 使用 `marked` 库
- **代码高亮** - 使用 `highlight.js` 支持多语言语法高亮
- **样式兼容** - 适配 GitHub Markdown 样式

## 依赖文件

- `github-markdown.css` - Markdown 样式
- `hljs.css` - 代码高亮样式

## 事件

| 事件 | 说明 |
|------|------|
| `loaded` | Markdown 加载完成 |
| `click-md-link` | 点击 .md 链接时触发 |
