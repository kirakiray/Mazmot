export async function getInitMsg() {
  try {
    const res = await fetch("caps/main.md");
    const content = await res.text();
    return [{
      role: "system",
      content: content,
    }];
  } catch (e) {
    console.error("Failed to fetch caps/main.md:", e);
    return [];
  }
}

export default getInitMsg;