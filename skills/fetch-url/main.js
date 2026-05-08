export default async function fetchUrl(options) {
  const {
    url, // 要请求的URL
    maxSize, // 限制最大返回大小
    cleanHTML = false, // 如果遇到是html内容，是否清理多余标签，只返回包含文本的内容
  } = options;

  const response = await fetch(url);

  const data = await response.text();

  return data;
}
