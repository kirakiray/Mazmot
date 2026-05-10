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

  if (cleanHTML) {
    const bodyMatch = data.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
    let bodyContent = bodyMatch ? bodyMatch[1] : data;
    bodyContent = bodyContent.replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "");
    bodyContent = bodyContent.replace(/<svg[^>]*>[\s\S]*?<\/svg>/gi, "");
    bodyContent = bodyContent.replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "");
    bodyContent = bodyContent.replace(
      /<noscript[^>]*>[\s\S]*?<\/noscript>/gi,
      "",
    );

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
        if (
          !allowedAttrs.includes(attr.name) &&
          !attr.name.startsWith("aria-")
        ) {
          el.removeAttribute(attr.name);
        }
      });
    });
    data = template.innerHTML;
    debugger;
  }

  if (maxSize && data.length > maxSize) {
    data = data.substring(0, maxSize);
  }

  return data;
}
