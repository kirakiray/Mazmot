# read_skill（工具包）

读取框架知识库文档（技能）：编写 ofa.js 模板 / senti-ui 组件前先查文档拿准确语法。

## 依赖注入（ctx）

`{ readSkill }`——`(skill, path) => Promise<string>`，由 builder-store 注入；实际读取在 `lib/skill-sync.js` 的 `readSkillFile`（VFS `skills/<id>/` 副本，含「技能未安装 + 可用清单」提示）。插件是薄壳：只做「未注入提示 + 参数 / 返回值透传」，不直接 import 宿主模块。

## 行为要点

- `path` 缺省传 `undefined`，默认落到 `SKILL.md` 由读取层处理。

## 内置测试

`self-test.js`（基座用法见 [../../test-space/README.md](../../test-space/README.md)）：包结构、未注入提示、参数 / 返回值透传、path 缺省、读取层提示原样透传（`ctx.readSkill` 全程 fake 替身）。`test/read-skill.sb.html` 跑同一 `runSelfTest()` 做回归。
