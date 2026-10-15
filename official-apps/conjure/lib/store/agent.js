/* ---------- Agent 与模型配置 ----------
 * Agent 的创建与失效（工具清单 / 系统提示词 / 记忆检查点装配）、上下文压缩、
 * 推理等级、对话 API Key 与模型选择。跨领域协作经 api.*（晚绑定）：工具
 * ctx 里的 openPreview / runTests / setSessionTasks 等分别由 preview / tests
 * / tasks 领域提供，app.json 覆写回填由 turn 领域提供。
 */

import {
  buildSystemPrompt,
  readAppFile,
  writeAppFile,
  withTestingRule,
  pickAutoKey,
  sanitizeAppName,
  MODEL_OPTIONS,
  COMPACTION_PROMPT,
  tailThread,
} from "../builder.js";
import { readSkillFile } from "../skill-sync.js";
import { createTools } from "../tools/index.js";

export function createAgentPart(api) {
  const { state, set, fs, selfStore, load, res, pushMessage, bucketFor, viewKey } = api;

  // /mz/ai/efforts.js（思考档位表；纯函数模块，惰性加载一次）
  let effortsModules = null;
  const ensureEfforts = async () => {
    if (!effortsModules) {
      effortsModules = await load("/mz/ai/efforts.js");
    }
    return effortsModules;
  };
  // /mz/ai/chain 模块与 checkpointer 惰性产物（仅本领域使用）
  let chainModules = null;
  let checkpointer = null;

  const pickAssistant = async () => {
    const { getAssistant, getApiKeys } = res.aiModules;
    const keys = getApiKeys().filter((k) => !k.disabled);

    // key 选择：用户手动指定的优先（切换后经 invalidateAgent 生效），否则
    // 自动（pickAutoKey：deepseek 优先 / 单台锁定 / 多台随机负载均衡）
    let key = null;
    if (state.activeKeyId) {
      key = keys.find((k) => k.id === state.activeKeyId) || null;
    }
    if (!key) {
      key = pickAutoKey(keys);
    }

    // 模型选择：手动选中的模型优先，但须在已知可用清单里——清单来自
    // getModels 动态拉取（缓存数组）；拉取失败用内置表校验（缓存 null）；
    // 尚未拉取过（无缓存，如刷新后恢复的偏好）则不指定模型，relay 供应商
    // 会自行静默取上游首个可用模型，其余供应商走各自默认
    const cached = key ? modelOptionsCache.get(key.id) : undefined;
    const knownModels = Array.isArray(cached)
      ? cached.map((o) => o.id)
      : cached === null
        ? MODEL_OPTIONS[key.provider] || []
        : null;
    let model;
    if (
      key &&
      state.activeModelId &&
      (knownModels === null || knownModels.includes(state.activeModelId))
    ) {
      model = state.activeModelId;
    } else if (key?.provider === "deepseek") {
      model = "deepseek-flash";
    } else if (Array.isArray(knownModels) && knownModels.length) {
      // 未选模型（或选中的已不在清单里）：取已知清单第一个兜底，
      // 避免落到供应商默认模型上撞白名单 403
      model = knownModels[0];
    } else {
      model = undefined;
    }
    return { assistant: getAssistant(key?.id), model };
  };

  async function ensureAgent() {
    if (res.agent) return res.agent;
    if (!res.aiModules) {
      res.aiModules = await load("/mz/ai/main.js");
    }
    if (!chainModules) {
      chainModules = await load("/mz/ai/chain/main.js");
    }
    if (!res.netModules) {
      // 联网能力（web_fetch 工具的底层）：provider 解析见 /mz/net/README.md
      res.netModules = await load("/mz/net/main.js");
    }
    if (!checkpointer) {
      checkpointer = selfStore
        ? {
            async get(threadId) {
              return (await selfStore.getItem(`thread:${threadId}`)) ?? [];
            },
            async set(threadId, messages) {
              await selfStore.setItem(`thread:${threadId}`, messages);
            },
            async delete(threadId) {
              await selfStore.removeItem(`thread:${threadId}`);
            },
          }
        : new chainModules.MemorySaver();
    }

    const { assistant, model } = await pickAssistant();
    res.activeModel = model || assistant.providerName || "";
    set("activeModel", res.activeModel);
    // 写入目标：已选应用随应用记录锁定；草稿阶段跟随目标偏好
    const useLocal =
      state.currentAppName !== ""
        ? state.currentAppMode === "local"
        : state.storageMode === "local" && !!res.localRootHandle;
    const lockedMode =
      state.currentAppName !== "" ? state.currentAppMode : state.storageMode;
    const tools = createTools({
      tool: chainModules.tool,
      fs,
      rootHandle: useLocal ? res.localRootHandle : undefined,
      onAppCreated: (info) => {
        res.pendingNewApp = { ...info, mode: lockedMode };
      },
      // 模型覆写 app.json 时回填项目元数据（fresh 项目创建后的正式命名）；
      // 覆写 AGENTS.md 时失效缓存 Agent——下一回合重建即读到新版项目规则；
      // 同时记录本回合变更：同文件多次写只保留「首次写前内容 + 末次写后
      // 内容」，回合收尾一次性算行级 diff（即该回合真实的净变化）
      onFileWrite: (info) => {
        const hit = res.turnChanges.find((c) => c.path === info.path);
        if (hit) {
          hit.op = info.op || "write";
          hit.nextText = info.nextText ?? "";
        } else {
          res.turnChanges.push({
            path: info.path,
            op: info.op || "write",
            prevText: info.prevText ?? null,
            nextText: info.nextText ?? "",
          });
        }
        if (info?.path === "app.json") {
          api.syncAppMetaFromDisk(info.appName);
        } else if (info?.path === "AGENTS.md") {
          invalidateAgent();
        }
      },
      readSkill: (id, path) => readSkillFile(fs, id, path),
      requestForm: api.requestForm,
      // 隔离预览调试（preview_* 工具）：推送入口 + dbg 指令通道 + 截图卡片
      openPreview: (appName) => {
        const hit = state.apps.find((a) => a.name === sanitizeAppName(appName));
        return api.runRemotePreview(appName, hit?.mode || state.currentAppMode);
      },
      previewDebug: api.previewDebug,
      // 多窗口清单（preview 工具 action=windows）：按需加载 remote-preview
      listPreviewWindows: async () => {
        const mod = await api.ensurePreviewMod();
        return mod.listPreviewWindows();
      },
      // 弹窗放行探测（preview 工具 action=check-popup）：被拦截后的确认重试用
      checkPopup: async () => {
        const mod = await api.ensurePreviewMod();
        return mod.checkPopupAllowed();
      },
      onPreviewShot: api.pushPreviewShot,
      // 场景测试（preview 工具 action=run-tests）：跑 client/test/ 下用例
      runTests: (files) => api.runTests(files),
      // 会话任务清单（task_list 工具）：拆解任务 / 随做随勾，右侧面板展示
      setSessionTasks: (tasks) => api.setSessionTasks(tasks),
      // web_fetch / web_search 工具：平台联网能力（mz/net 负责通道调度与结果规整）
      netFetch: (url, opts) => res.netModules.fetchText(url, opts),
      netSearch: (query, opts) => res.netModules.searchWeb(query, opts),
    });
    // 全新项目首回合：项目已由宿主建好，移除 create_app 并换「空项目生成」提示词
    const isFresh =
      !!res.freshTurn && res.freshTurn.appName === state.currentAppName;
    const toolList = Object.values(tools);
    // 已存在项目：自动读取项目 AGENTS.md 注入系统提示词（harness 常规机制——
    // 项目规则随会话开始自动生效，不依赖模型自觉去读；尚未写这份文档的新
    // 项目读不到则不注入，由提示词引导模型按需 read_file）
    let projectRules = "";
    if (!isFresh && state.currentAppName) {
      try {
        const rulesHandle = useLocal ? res.localRootHandle : undefined;
        const agentsRaw = await readAppFile(
          fs,
          state.currentAppName,
          "AGENTS.md",
          rulesHandle,
        );
        // 老项目迁移：AGENTS.md 缺「重要功能必须带场景测试」硬性约定时自动
        // 补齐并写回（新项目由 agents-template 模板自带）；本回合注入的就是
        // 补齐后的内容，失败则按原文注入不阻断
        projectRules =
          (await migrateAgentsTestingRule(agentsRaw, rulesHandle)) || "";
      } catch {
        projectRules = "";
      }
    }
    // 思考档位按当前模型支持情况夹取（各家档位不同，见 /mz/ai/efforts.js）；
    // 夹取结果为 null（模型思考不可调）时不注入思考参数；efforts 加载失败
    // 按旧逻辑直接使用偏好档位，不阻断回合
    let effort = state.reasoning;
    try {
      const { clampEffort } = await ensureEfforts();
      effort = clampEffort(assistant.providerName, model || "", state.reasoning);
    } catch {
      /* efforts 不可用：不夹取 */
    }
    res.agent = chainModules.createAgent({
      assistant,
      ...(model ? { model } : {}),
      thinking: !!effort && effort !== "off",
      ...(effort && effort !== "off" ? { reasoningEffort: effort } : {}),
      // 单回合步数上限（用户可在「单轮步数」菜单调整，见 setMaxSteps）
      maxSteps: res.maxSteps,
      tools: isFresh
        ? toolList.filter((t) => t.name !== "create_app")
        : toolList,
      // 注入当前应用上下文：已选应用时强制模型先读文件再回答/修改；
      // 同时列出可用技能知识库（read_skill）
      systemPrompt: buildSystemPrompt({
        appName: state.currentAppName || undefined,
        displayName: state.currentAppDisplay || undefined,
        mode: state.currentAppMode,
        skills: res.skillIndex,
        freshProject: isFresh,
        projectRules,
        // 上回合宿主自动检测收集的预览错误（预览窗口开着时才收集）：
        // 注入本回合提示词让模型优先修复；driveTurn 开始时取走清空
        autoErrors: state.autoErrors.length ? [...state.autoErrors] : undefined,
        // 当前会话任务清单（task_list 工具维护，按会话持久化）：每回合注入，
        // 模型跨回合 / 跨刷新续作清单（上下文压缩后记忆里未必还有它）
        sessionTasks: state.sessionTasks.length
          ? state.sessionTasks.map((t) => ({ ...t }))
          : undefined,
        // 待消费的回滚通知（中性 / 不满意）
        rollback:
          res.pendingRollback &&
          res.pendingRollback.appName === state.currentAppName
            ? { ...res.pendingRollback }
            : undefined,
      }),
      checkpointer,
    });
    return res.agent;
  }

  function invalidateAgent() {
    res.agent = null;
  }

  /* ---------- 技能文档读取（read_skill 工具 ctx 用）与 AGENTS.md 迁移 ---------- */

  // 老项目 AGENTS.md 迁移（withTestingRule 判定与插入，这里只做 IO）：缺场景
  // 测试硬性约定时补一条并写回，返回注入用内容；raw 为 null（尚无该文件）或
  // 写入失败时原样返回，不阻断注入
  async function migrateAgentsTestingRule(raw, rootHandle) {
    if (raw == null) return raw;
    const next = withTestingRule(raw);
    if (next == null) return raw;
    try {
      await writeAppFile(
        fs,
        state.currentAppName,
        "AGENTS.md",
        next,
        rootHandle,
      );
    } catch (err) {
      console.warn("[builder] AGENTS.md 补测试约定失败：", err);
      return raw;
    }
    return next;
  }

  /* ---------- 上下文压缩 ---------- */

  // 把 wire 消息拼成摘要请求用的对话稿（超长内容掐头留尾，防止摘要请求本身撑爆窗口）
  const clip = (t, n) => {
    const text = String(t ?? "");
    if (text.length <= n) return text;
    const half = Math.floor(n / 2);
    return text.slice(0, half) + "\n…[过长截断]…\n" + text.slice(-half);
  };
  // user 消息 content 的文本视图：多模态 wire（OpenAI content 数组）取 text 部分
  // 拼接并标注图片张数，供压缩 transcript 等纯文本场景使用
  const wireTextOf = (content) => {
    if (!Array.isArray(content)) return String(content ?? "");
    const texts = content
      .filter((p) => p?.type === "text")
      .map((p) => String(p.text ?? ""));
    const nImg = content.filter((p) => p?.type === "image_url").length;
    return texts.join("\n") + (nImg ? `\n[本条含 ${nImg} 张图片]` : "");
  };
  const buildTranscript = (thread) =>
    thread
      .map((m) => {
        if (m.role === "user") return `用户：${clip(wireTextOf(m.content), 3000)}`;
        if (m.role === "assistant") {
          const calls = (m.tool_calls || [])
            .map(
              (c) =>
                `  [调用工具] ${c.function?.name} ${clip(c.function?.arguments, 600)}`,
            )
            .join("\n");
          return `助手：${clip(m.content, 3000)}${calls ? "\n" + calls : ""}`;
        }
        if (m.role === "tool") return `工具结果：${clip(m.content, 1200)}`;
        return "";
      })
      .filter(Boolean)
      .join("\n\n");

  /**
   * 压缩指定会话的 Agent 记忆：用摘要替换旧历史 + 保留最近 2 个完整回合原文，
   * 并在聊天流里插一张 compact 卡片告知用户（显示层聊天记录不动）。
   * 只应在两回合之间调用（sending = false）。返回 { ok, reason? }。
   */
  async function compressThread(chatKey) {
    const threadId = chatKey === "chat:draft" ? "draft" : chatKey.slice("chat:".length);
    const threadKey = `thread:${threadId}`;
    const thread = (await selfStore.getItem(threadKey)) || [];
    const turns = thread.filter((m) => m.role === "user").length;
    // 太短不值得压：摘要 + 尾部原文不会比原记忆小多少
    if (turns < 3) return { ok: false, reason: "对话还很短，暂不需要压缩" };

    if (!res.aiModules) res.aiModules = await load("/mz/ai/main.js");
    const { assistant, model } = await pickAssistant();
    const res2 = await assistant.chat({
      ...(model ? { model } : {}),
      thinking: false,
      stream: false,
      messages: [
        { role: "system", content: COMPACTION_PROMPT },
        { role: "user", content: buildTranscript(thread) },
      ],
    });
    const summary = String(res2.content || "").trim();
    if (!summary) return { ok: false, reason: "摘要生成失败，请稍后重试" };

    const newThread = [
      {
        role: "user",
        content: `以下是此前对话的压缩摘要，请基于它继续工作（细节需要时先用 list_files / read_file 核实）：\n\n${summary}`,
      },
      { role: "assistant", content: "已了解，我将基于该摘要继续。" },
      ...tailThread(thread, 2),
    ];
    await selfStore.setItem(threadKey, newThread);

    // 聊天流里插卡片（显示层记录不动，仅告知）；pushMessage 路由到 activeKey 桶
    pushMessage({
      id: state.nextId++,
      role: "compact",
      count: thread.length - tailThread(thread, 2).length,
      summary,
      open: false,
      newGroup: true,
    });
    // 卡片随会话落盘
    await selfStore.setItem(
      chatKey,
      bucketFor(chatKey).map((m) => ({ ...m })),
    );
    return { ok: true };
  }

  // 手动压缩：压缩当前正在查看的会话
  async function compress() {
    if (!selfStore || state.sending) {
      return { ok: false, reason: state.sending ? "请等本轮对话结束后再压缩" : "" };
    }
    return await compressThread(viewKey());
  }

  // 设定上下文窗口（token），发送前的自动压缩判断用
  function setContextWindow(n) {
    res.contextWindow = Number(n) || 0;
  }

  // 设定单回合步数上限（createAgent 的 maxSteps）；agent 按会话缓存，
  // 这里置失效让下回合重建时带上新值（对话记忆在 checkpointer，不丢）
  function setMaxSteps(n) {
    const v = Math.round(Number(n) || 0);
    if (v < 20 || v > 9999 || v === res.maxSteps) return;
    res.maxSteps = v;
    invalidateAgent();
  }

  /* ---------- 推理等级 ---------- */

  // 切换推理等级并持久化偏好；Agent 随之重建（注入前按当前模型夹取档位，
  // 见 ensureAgent 的 clampEffort；偏好存用户视角档位，菜单项为当前模型可用档）
  async function setReasoning(level) {
    if (!["off", "minimal", "low", "medium", "high", "max"].includes(level)) return;
    set("reasoning", level);
    invalidateAgent();
    refreshEffortOptions();
    if (selfStore) {
      try {
        await selfStore.setItem("pref:reasoning", level);
      } catch {
        /* 存储失败不影响本次会话 */
      }
    }
  }

  /* ---------- 对话 API Key 切换 ---------- */

  const API_KEY_LIST_KEY = "pref:active-key";

  // 各 key 的可用模型缓存：keyId → [{id,label}]（getModels 成功）/ null（失败，
  // 校验与展示回退 MODEL_OPTIONS 内置表）/ 无记录（未拉取）
  const modelOptionsCache = new Map();
  let modelOptionsSeq = 0; // 串行化竞态：仅最后一次拉取允许写入 state

  const staticModelOptions = (key) =>
    (MODEL_OPTIONS[key?.provider] || []).map((id) => ({ id, label: id }));

  // 模型下拉数据源（st-select :options）：头部恒置「自动」项
  const applyModelOptions = (list) => {
    set("modelOptions", list);
    set("modelSelectOptions", [
      { value: "", label: "自动（供应商默认）" },
      ...list,
    ]);
    refreshEffortOptions();
  };

  // 推理等级菜单可选项：跟随当前生效 key 的供应商 + 选中模型（未选模型取
  // 清单首项，即供应商默认）动态生成（各家档位不同，见 /mz/ai/efforts.js），
  // 同时把用户偏好夹取为生效档位 effectiveReasoning（"" = 模型思考不可调）
  function refreshEffortOptions() {
    if (!effortsModules) return; // efforts 尚未加载（init 会补一次）
    const { effortLevelsFor, clampEffort, EFFORT_LABELS } = effortsModules;
    const key = state.activeKeyId
      ? state.apiKeys.find((k) => k.id === state.activeKeyId)
      : pickAutoKey(state.apiKeys);
    const provider = key?.provider || "";
    const model = state.activeModelId || state.modelOptions[0]?.id || "";
    const levels = effortLevelsFor(provider, model);
    set(
      "effortOptions",
      levels.map((id) => ({ id, label: EFFORT_LABELS[id] || id })),
    );
    set("effectiveReasoning", clampEffort(provider, model, state.reasoning) || "");
  }

  // 拉取当前生效 key 的可用模型（getModels，relay 供应商即 /v1/models），
  // 写入 state.modelOptions 供输入区气泡展示。静默自动拉取：进应用 / key 列表
  // 变化（syncApiKeyList）/ 手动切换 key 时都会执行，「自动」模式下解析的是
  // 自动选择将命中的 key（deepseek 优先，否则第一台），无需用户手动点开菜单
  async function refreshModelOptions() {
    const seq = ++modelOptionsSeq;
    const key = state.activeKeyId
      ? state.apiKeys.find((k) => k.id === state.activeKeyId)
      : pickAutoKey(state.apiKeys);
    if (!key || !res.aiModules?.getAssistant) {
      set("modelOptions", []);
      refreshEffortOptions();
      return;
    }
    const cached = modelOptionsCache.get(key.id);
    if (cached !== undefined) {
      applyModelOptions(cached === null ? staticModelOptions(key) : cached);
      return;
    }
    modelOptionsCache.set(key.id, null); // 占位防并发重复拉取
    try {
      const assistant = res.aiModules.getAssistant(key.id);
      const models = await assistant.getModels();
      const list = (Array.isArray(models) ? models : [])
        .map((m) => (typeof m === "string" ? m : m?.id || m?.name))
        .filter((id) => typeof id === "string" && id)
        .map((id) => ({ id, label: id }));
      modelOptionsCache.set(key.id, list);
      if (seq === modelOptionsSeq) applyModelOptions(list);
    } catch (err) {
      console.warn("获取模型列表失败，回退内置清单：", err?.message ?? err);
      modelOptionsCache.delete(key.id); // 不缓存失败结果，下次切换重试
      if (seq === modelOptionsSeq) applyModelOptions(staticModelOptions(key));
    }
  }

  // 把 /mz/ai 的 key 列表镜像进 state（只留展示所需字段）
  function syncApiKeyList(keys) {
    const active = (keys || []).filter((k) => !k.disabled);
    set(
      "apiKeys",
      active.map((k) => ({
        id: k.id,
        provider: k.provider,
        maskedKey: k.maskedKey,
        // relay 中转服务器的自定义命名（选择 provider 时展示）
        serverName: k.serverName,
      })),
    );
    set(
      "apiSelectOptions",
      [
        { value: "", label: "自动选择" },
        ...active.map((k) => ({
          value: k.id,
          label: `${k.provider === "relay" ? k.serverName || "Relay" : k.provider} · ${k.maskedKey}`,
        })),
      ],
    );
    // 选中的 key 已被删/禁用：回退自动
    if (state.activeKeyId && !keys?.some((k) => k.id === state.activeKeyId && !k.disabled)) {
      selectApiKey("");
    }
    refreshModelOptions();
  }

  // 切换对话模型（"" = 供应商默认）；切换即 invalidateAgent 下一回合生效，
  // 思考档位表跟随新模型重算
  async function selectModel(id) {
    if (state.activeModelId === id) return;
    set("activeModelId", id);
    invalidateAgent();
    refreshEffortOptions();
    if (selfStore) {
      try {
        await selfStore.setItem("pref:active-model", id);
      } catch {
        /* 存储失败不影响本次会话 */
      }
    }
  }

  // 切换对话用的 API Key（"" = 自动）；下一回合经 invalidateAgent 生效
  async function selectApiKey(id) {
    if (state.activeKeyId === id) return;
    set("activeKeyId", id);
    invalidateAgent();
    refreshModelOptions();
    if (selfStore) {
      try {
        await selfStore.setItem(API_KEY_LIST_KEY, id);
      } catch {
        /* 存储失败不影响本次会话 */
      }
    }
  }

  return {
    ensureEfforts,
    pickAssistant,
    ensureAgent,
    invalidateAgent,
    migrateAgentsTestingRule,
    compressThread,
    compress,
    setContextWindow,
    setMaxSteps,
    setReasoning,
    refreshEffortOptions,
    refreshModelOptions,
    syncApiKeyList,
    selectModel,
    selectApiKey,
    API_KEY_LIST_KEY,
  };
}
