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
  const skillUrl = `/caps/${capabilityName}/SKILL.md`;
  const skillResp = await fetch(skillUrl);
  const skillText = await skillResp.text();
  const yamlStr = skillText.match(/^---(.*?)---/s)[1];
  const yamlConfig = yaml.load(yamlStr);
  return yamlConfig;
}
