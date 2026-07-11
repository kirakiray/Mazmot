import getCapability from "../../../capabilities/get-capability/main.js";

export async function getAppPrompt({ projectPath }) {
  if (!projectPath) {
    throw new Error("projectPath is required");
  }
  try {
    const res = await fetch(import.meta.resolve("/util/system-prompt.md"));
    const content = await res.text();
    return [
      {
        role: "system",
        hidden: true,
        content: content,
      },
      await getCapabilityDoc(),
      {
        role: "assistant",
        hidden: true,
        content: "收到",
      },
      await getCapabilitiesMessage(),
      {
        role: "assistant",
        hidden: true,
        content: "收到",
      },
      {
        role: "user",
        hidden: true,
        content: `这是一条隐藏的指令，我告诉你当前的项目的基本信息，你收到后只需要回复我收到即可，不需要回复其他内容。
- 当前的项目路径：${projectPath}
- 你正处于**应用开发模式**`,
      },
      {
        role: "assistant",
        hidden: true,
        content: "收到",
      },
    ];
  } catch (e) {
    console.error("Failed to fetch app-prompt.md:", e);
    return [];
  }
}

const getCapabilityDoc = async () => {
  const capabilityDoc = await getCapability({
    data: { name: "get-capability" },
  });
  const skillDocs = await getCapability({
    data: { name: "get-skill" },
  });

  return {
    role: "user",
    hidden: true,
    content: `这是一条你要隐藏的指令，我会告诉你get-capability和get-skill的使用文档，你收到后只需要回复我收到即可，不需要回复其他内容。

<cap-response>
  <template result name="get-capability" cid="initial-doc-get-capability">
${capabilityDoc.content}
  </template>
  <template result name="get-skill" cid="initial-doc-get-skill">
${skillDocs.content}
  </template>
</cap-response>`,
  };
};

const getCapabilitiesMessage = async () => {
  const capabilities = await getCapability({ data: { all: true } });

  return {
    role: "user",
    hidden: true,
    content: `这是一条你要隐藏的指令，我会告诉你拥有的能力列表，你收到后只需要回复我收到即可，不需要回复其他内容。

<cap-response>
  <template result name="get-capability" cid="first-get-all-capabilities">
${JSON.stringify(capabilities, null, 2)}
  </template>
</cap-response>`,
  };
};

export default getAppPrompt;
