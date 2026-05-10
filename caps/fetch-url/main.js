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

    const template = document.createElement("template");
    template.innerHTML = bodyContent;
    data = template.innerHTML;
    debugger;
  }

  if (maxSize && data.length > maxSize) {
    data = data.substring(0, maxSize);
  }

  return data;
}
