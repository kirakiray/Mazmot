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

  const base64Code = btoa(
    encodeURIComponent(code).replace(/%([0-9A-F]{2})/g, (match, p1) =>
      String.fromCharCode(parseInt(p1, 16)),
    ),
  );

  const workerCode = `
    const code = decodeURIComponent(escape(atob('${base64Code}')));
    const fn = new Function(code);
    const result = fn();
    if (result instanceof Promise) {
      result.then(r => postMessage({ type: 'result', value: r }))
            .catch(e => postMessage({ type: 'error', message: e.message, stack: e.stack }));
    } else {
      postMessage({ type: 'result', value: result });
    }
  `;

  const blob = new Blob([workerCode], { type: "application/javascript" });
  const url = URL.createObjectURL(blob);

  return new Promise((resolve, reject) => {
    const worker = new Worker(url);
    worker.onmessage = (e) => {
      if (e.data.type === "result") {
        resolve(e.data.value);
      } else if (e.data.type === "error") {
        reject(new Error(e.data.message));
      }
      worker.terminate();
      URL.revokeObjectURL(url);
    };
    worker.onerror = (e) => {
      reject(new Error(e.message));
      worker.terminate();
      URL.revokeObjectURL(url);
    };
  });
}
