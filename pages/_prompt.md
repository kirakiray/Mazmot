我当前的这个项目，最开始是模仿skill的模式去制作的ai系统，现在我想将原来和skill相关的命名改为capability。
其中，主体的文件现在是存放在 skills 目录下的，将其更名为 caps 目录。
其中 skills/get-skill 改为 get-capability，其中的内容也要改一下。
默认使用 SKILL.md文件不需要更名，但如果内容有说到 skill 的地方，需要将其改为 capability。
comps/skill-request/skill-request.html 中的 skill 改为 capability，并且文件名也改为 cap-request.html，组件tag也改为 cap-request。返回的响应组件也改为 cap-response.
skills/main.md 内的提示词也需要改为使用 capability。
中文描述里将“技能”改为“能力”,"Skill"改为"Capability"。
其中存放单个能力的目录（存放在 caps 内的目录），正式名称叫“能力包”（Capability Package）。