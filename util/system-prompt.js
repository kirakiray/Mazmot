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
</cap-response>

⚠️ **重要提醒**：以上仅为能力概览（名称和简短描述），**不包含详细用法**。在调用任何能力之前，你必须先使用 \`get-capability\` 并指定 \`data-name\` 参数获取该能力的完整文档，了解正确的调用方式、参数格式、返回值结构等。禁止根据能力名称猜测用法。`,
  };
};
window.getCapabilitiesMessage = getCapabilitiesMessage;

export default getSystemPrompt;
