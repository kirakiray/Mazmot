export default async function runJS({ data = {}, content }) {
  let code = "";

  if (!code && content) {
    const temp = $(`<template>${content}</template>`);
    const scriptEl = temp.$("script[type='text/plain']");
    if (scriptEl) {
      code = scriptEl.html.trim();
    } else {
      throw new Error(
        "必须将JS代码包裹在<script type='text/plain'></script>标签中",
      );
    }
  }

  if (!code) {
    throw new Error("没有JS代码，无法执行");
  }

  const fn = new Function(code);
  const result = fn();

  if (result instanceof Promise) {
    return await result;
  }

  return result;
}
