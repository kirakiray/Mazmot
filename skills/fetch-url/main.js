export default async function fetchUrl(options) {
  const {
    url, // 要请求的URL
    maxSize, // 最大返回大小
    compressHTML = false, // 是否压缩HTML
  } = options;

  const response = await fetch(url);

  const data = await response.text();

  return data;
}
