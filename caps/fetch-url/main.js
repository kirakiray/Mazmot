export default async function fetchUrl(options) {
  const { url, maxSize, cleanHTML = true } = options;

  const response = await fetch(url);

  if (!response.ok) {
    throw new Error(`HTTP error! status: ${response.status}`);
  }

  let data = await response.text();

  if (maxSize && data.length > maxSize) {
    data = data.substring(0, maxSize);
  }

  if (cleanHTML) {
    const bodyMatch = data.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
    const bodyContent = bodyMatch ? bodyMatch[1] : data;

    debugger;

    const template = document.createElement("template");
    template.innerHTML = bodyContent;
    data = template.content.textContent.trim();
  }

  return data;
}
