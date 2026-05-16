export default async function runJS({ data = {}, content }) {
  const code = data.code || content;

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
