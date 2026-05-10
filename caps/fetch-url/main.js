export default async function fetchUrl(options) {
  const {
    url,
    maxSize = 32 * 1024, // 32KB
    cleanHTML = true, // 如果遇到是html内容，是否清理多余标签，只返回包含文本的内容
  } = options;

  const response = await fetch(url);

  if (!response.ok) {
    throw new Error(`HTTP error! status: ${response.status}`);
  }

  let data = await response.text();

  // 确定是html内容，才清理多余标签
  if (cleanHTML && data.toLocaleLowerCase().includes("<!doctype html")) {
    data = clearHTML(data);
  }

  if (maxSize && data.length > maxSize) {
    data = data.slice(0, maxSize);
  }

  return data;
}

const clearHTML = (html) => {
  const bodyMatch = html.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
  let bodyContent = bodyMatch ? bodyMatch[1] : html;
  bodyContent = bodyContent.replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "");
  bodyContent = bodyContent.replace(/<svg[^>]*>[\s\S]*?<\/svg>/gi, "");
  bodyContent = bodyContent.replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "");
  bodyContent = bodyContent.replace(
    /<noscript[^>]*>[\s\S]*?<\/noscript>/gi,
    "",
  );
  bodyContent = bodyContent.replace(/<!--[\s\S]*?-->/g, "");
  bodyContent = bodyContent.replace(/<iframe[^>]*>[\s\S]*?<\/iframe>/gi, "");

  const template = document.createElement("template");
  template.innerHTML = bodyContent;
  const allowedAttrs = [
    "href",
    "src",
    "alt",
    "title",
    "role",
    "aria-label",
    "aria-labelledby",
    "aria-describedby",
    "aria-hidden",
    "aria-expanded",
    "aria-disabled",
    "aria-pressed",
    "aria-checked",
    "aria-selected",
    "for",
    "type",
    "name",
    "value",
    "placeholder",
    "disabled",
    "checked",
    "selected",
    "multiple",
    "maxlength",
    "minlength",
    "pattern",
    "required",
    "readonly",
  ];
  template.content.querySelectorAll("*").forEach((el) => {
    const attrs = [...el.attributes];
    attrs.forEach((attr) => {
      if (!allowedAttrs.includes(attr.name) && !attr.name.startsWith("aria-")) {
        el.removeAttribute(attr.name);
      }
    });
  });
  const removeEmpty = (el) => {
    const children = [...el.childNodes];
    children.forEach((child) => {
      if (child.nodeType === 1) {
        removeEmpty(child);
      }
    });
    if (
      el.textContent.trim() === "" &&
      !el.hasAttribute("src") &&
      !el.hasAttribute("href")
    ) {
      el.remove();
    }
  };
  removeEmpty(template.content);
  const simplifyWrappers = (el) => {
    const children = [...el.childNodes];
    children.forEach((child) => {
      if (child.nodeType === 1) {
        simplifyWrappers(child);
        const tagName = child.tagName.toLowerCase();
        if (
          [
            "span",
            "b",
            "i",
            "u",
            "strong",
            "em",
            "small",
            "mark",
            "sub",
            "sup",
          ].includes(tagName)
        ) {
          const textContent = child.textContent;
          const importantAttrs = ["href", "src", "alt", "title", "role"];
          const hasImportantAttr = [...child.attributes].some(
            (attr) =>
              importantAttrs.includes(attr.name) ||
              attr.name.startsWith("aria-"),
          );
          if (
            child.childNodes.length === 1 &&
            child.childNodes[0].nodeType === 3 &&
            !hasImportantAttr
          ) {
            el.replaceChild(document.createTextNode(textContent), child);
          }
        }
      }
    });
  };
  simplifyWrappers(template.content);
  const unwrapNesting = (el) => {
    const children = [...el.childNodes];
    children.forEach((child) => {
      if (child.nodeType === 1) {
        unwrapNesting(child);
        const importantAttrs = [
          "href",
          "src",
          "alt",
          "title",
          "role",
          "for",
          "type",
          "name",
          "value",
          "placeholder",
          "disabled",
          "checked",
          "selected",
        ];
        const hasImportantAttr = [...child.attributes].some(
          (attr) =>
            importantAttrs.includes(attr.name) || attr.name.startsWith("aria-"),
        );
        if (
          child.childNodes.length === 1 &&
          child.childNodes[0].nodeType === 1 &&
          !hasImportantAttr
        ) {
          const inner = child.childNodes[0];
          el.replaceChild(inner.cloneNode(true), child);
        }
      }
    });
  };
  unwrapNesting(template.content);
  return template.innerHTML;
};
