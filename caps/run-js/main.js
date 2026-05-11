export default async function runJS(options) {
  const { code } = options;

  if (!code) {
    throw new Error("code is required");
  }

  try {
    const fn = new Function(code);
    const result = fn();

    if (result instanceof Promise) {
      return await result;
    }

    return result;
  } catch (error) {
    throw new Error(`JS execution error: ${error.message}`);
  }
}
