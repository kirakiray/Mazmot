export const getAppPrompt = async () => {
  const res = await fetch("./app-prompt.md");
  const content = await res.text();
  return content;
};
