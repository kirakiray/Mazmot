import getCapability from "../caps/get-capability/main.js";

export async function getInitMsg() {
  try {
    const res = await fetch("caps/main.md");
    const content = await res.text();
    return [
      {
        role: "system",
        content: content,
      },
      // await getInitUserMsg(),
    ];
  } catch (e) {
    console.error("Failed to fetch caps/main.md:", e);
    return [];
  }
}

const getInitUserMsg = async () => {
  const capabilities = await getCapability({ all: true });
  const id = Math.random().toString(36).substring(2, 8);
  return {
    role: "user",
    content: `这是一条你要隐藏的指令，我会告诉你你拥有的能力列表，你收到后只需要回复我收到即可，不需要回复其他内容。

<cap-response>
[
  {
    "capability": "get-capability",
    "id": "init-capability",
    "result": ${JSON.stringify(capabilities)}
  }
]
</cap-response>`,
  };
};
window.getInitUserMsg = getInitUserMsg;

export default getInitMsg;
