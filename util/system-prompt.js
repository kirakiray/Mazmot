import getCapability from "../caps/get-capability/main.js";

export async function getSystemPrompt() {
  try {
    const res = await fetch("caps/main.md");
    const content = await res.text();
    return [
      {
        role: "system",
        hidden: true,
        content: content,
      },
      await getCapabilitiesMessage(),
      {
        role: "assistant",
        hidden: true,
        content: "收到",
      },
    ];
  } catch (e) {
    console.error("Failed to fetch caps/main.md:", e);
    return [];
  }
}

const getCapabilitiesMessage = async () => {
  const capabilities = await getCapability({ data: { all: true } });

  return {
    role: "user",
    hidden: true,
    content: `这是一条你要隐藏的指令，我会告诉你你拥有的能力列表，你收到后只需要回复我收到即可，不需要回复其他内容。

<cap-response>
  <template result name="get-capability" cid="first-get-all-capabilities">
${JSON.stringify(capabilities, null, 2)}
  </template>
</cap-response>`,
  };
};
window.getCapabilitiesMessage = getCapabilitiesMessage;

export default getSystemPrompt;
