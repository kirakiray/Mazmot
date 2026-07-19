# m-ercode

基于 [qrcode-generator](https://github.com/kazuhikoarase/qrcode-generator) 的二维码生成组件。支持任意文本内容的二维码生成，可通过 `content` 属性动态更新。

## 安装

在页面中加载组件文件即可使用：

```html
<l-m src="./path/to/ercode.html"></l-m>
```

## 使用

### 基本用法

设置 `content` 属性指定二维码内容：

```html
<m-ercode content="https://github.com/ofajs/ofa.js"></m-ercode>
```

### 动态绑定

配合 ofa.js 的数据绑定使用：

```html
<input sync:value="myText" placeholder="输入内容" />
<m-ercode :content="myText"></m-ercode>
```

### 设置尺寸

通过 CSS 设置组件宽高来控制二维码尺寸：

```css
m-ercode {
  width: 160px;
  height: 160px;
}
```

```html
<m-ercode content="https://github.com/ofajs/ofa.js"></m-ercode>
```

## API

| 属性 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| content | string | "" | 要编码为二维码的文本内容 |

## 示例

参考 `demo.html` 和 `demo-page.html` 获取完整示例。
