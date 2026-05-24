export default async function runJS({ data = {}, content }) {
  let code = data.code;

  if (!code && content) {
    const temp = $(`<template>${content}</template>`);
    const scriptEl = temp.$("script[type='text/plain']");
    if (scriptEl) {
      code = scriptEl.html.trim();
    } else {
      code = content.trim();
    }
  }

  if (!code) {
    throw new Error("code is required");
  }

  const fn = new Function(code);
  const result = fn();

  if (result instanceof Promise) {
    return await result;
  }

  return result;
}
