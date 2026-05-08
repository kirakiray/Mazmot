export default async function fetchUrl(options) {
  const { url } = options;

  const response = await fetch(url);

  const data = await response.text();

  return data;
}
