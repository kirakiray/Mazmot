import yaml from "/npm/js-yaml@4.1.1/dist/js-yaml.min.mjs";

export function normalizeCapPath(path) {
  const segments = path.split("/");
  const result = [];
  for (const seg of segments) {
    if (seg === "." || seg === "") continue;
    if (seg === "..") {
      result.pop();
    } else {
      result.push(seg);
    }
  }
  return "/" + result.join("/");
}

export async function loadCapabilityConfig(capabilityName) {
  const skillUrl = `/capabilities/${capabilityName}/SKILL.md`;
  const skillResp = await fetch(skillUrl);
  if (!skillResp.ok) {
    throw new Error(`Capability not found: ${skillUrl}`);
  }
  let yamlConfig;
  try {
    const skillText = await skillResp.text();
    const yamlStr = skillText.match(/^---(.*?)---/s)[1];
    yamlConfig = yaml.load(yamlStr);
  } catch (e) {
    // 解析SKILL.md失败，抛出更详细的错误信息
    throw new Error(
      `Failed to parse SKILL.md for capability "${capabilityName}": ${e.message}`,
    );
  }
  return yamlConfig;
}
