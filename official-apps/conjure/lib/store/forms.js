/* ---------- 视觉交互表单（show_form 工具） ----------
 * 表单卡片作为 assistant 消息进对话流，用户提交后数据交回 Agent 工具调用；
 * 页面刷新后仍挂起的表单走「恢复回合」：合成记忆线程（用户请求 → show_form
 * 调用 → 工具结果）后以空输入重新驱动 agent 循环。
 */

export function createFormsPart(api) {
  const {
    state,
    set,
    setMany,
    fs,
    selfStore,
    res,
    sessionBuckets,
    bucketFor,
    viewKey,
    activeKey,
    pushMessage,
    patchMessage,
    setTurnKey,
    markBusy,
  } = api;

  // 当前挂起的表单等待器：{ msgId, resolve }；同一时刻最多一张
  let formWaiter = null;
  let formResuming = false; // 恢复回合防重入

  // show_form 工具入口：把表单卡片作为一条 assistant 消息推入当前回合，
  // 返回的 Promise 在用户提交（submitForm）或取消（cancelPendingForm）时落定
  function requestForm(spec) {
    const item = pushMessage({
      id: state.nextId++,
      role: "assistant",
      type: "form",
      content: "",
      form: { ...spec, status: "pending", data: null },
      newGroup: false,
    });
    return new Promise((resolve) => {
      formWaiter = { msgId: item.id, resolve };
    });
  }

  // 用户在卡片上点「提交」：数据写回消息（随会话桶持久化，历史只读回填），
  // 并把数据交回 Agent 工具调用。
  // 无活动等待器（页面刷新后恢复的挂起表单）→ 走恢复回合
  function submitForm(msgId, values) {
    if (formWaiter && formWaiter.msgId === msgId) {
      const { resolve } = formWaiter;
      formWaiter = null;
      const item = bucketFor(activeKey()).find((m) => m.id === msgId);
      const form = { ...(item?.form || {}), status: "submitted", data: values };
      patchMessage(msgId, { form });
      resolve({ data: values });
      return true;
    }
    const item = bucketFor(viewKey()).find((m) => m.id === msgId);
    if (item?.type === "form" && item.form?.status === "pending") {
      resumeFormTurn(item, values); // 异步恢复回合
      return true;
    }
    return false;
  }

  // 恢复回合：页面刷新后用户提交恢复的挂起表单时，原回合的工具等待已随页面
  // 消失、且本轮对话从未写入模型记忆（检查点只在回合收尾落盘）。
  // 做法：把「用户请求 → assistant 调 show_form → 工具结果（用户提交的数据）」
  // 合成进记忆线程，再以空输入重新驱动 agent 循环，模型即可接上上下文继续。
  async function resumeFormTurn(item, values) {
    if (state.sending || formResuming || !fs) return;
    formResuming = true;
    try {
      await doResumeFormTurn(item, values);
    } finally {
      formResuming = false;
    }
  }

  async function doResumeFormTurn(item, values) {
    if (!fs) return;
    const viewKeyNow = viewKey();

    // 找本轮的用户请求文本（表单消息之前最近一条 user 消息）
    const list = bucketFor(viewKeyNow);
    let firstUserText = "（继续表单）";
    for (let i = list.length - 1; i >= 0; i--) {
      if (list[i].role === "user") {
        firstUserText = list[i].content;
        break;
      }
    }

    const threadId =
      viewKeyNow === "chat:draft" ? "draft" : viewKeyNow.slice("chat:".length);
    setTurnKey(viewKeyNow);
    if (!sessionBuckets.has(res.turnKey)) {
      sessionBuckets.set(res.turnKey, [...state.messages]);
    }
    res.turnStartAt = Date.now();
    markBusy(res.turnKey, true);
    setMany({ keyError: "", turnStartTs: res.turnStartAt });

    try {
      await api.ensureAgent();
    } catch {
      setTurnKey(null);
      res.turnStartAt = 0;
      markBusy(null);
      setMany({
        keyError: "还没有可用的 API Key，请先在「AI 密钥管理器」应用中保存一个。",
        turnStartTs: 0,
      });
      return; // 表单保持 pending，修复环境后仍可提交
    }

    set("sending", true);
    // 表单落「已提交」（随会话桶持久化，历史只读回填）
    const form = { ...(item.form || {}), status: "submitted", data: values };
    patchMessage(item.id, { form });

    // 合成记忆：user 请求 → assistant 的 show_form 调用 → 工具结果（提交的数据）
    try {
      const threadKey = `thread:${threadId}`;
      const history = (await selfStore.getItem(threadKey)) ?? [];
      const toolCallId = `call_resume_${Date.now().toString(36)}`;
      const wire = [
        { role: "user", content: firstUserText },
        {
          role: "assistant",
          content: "",
          // DeepSeek 思考模式要求带 tool_calls 的 assistant 消息必须回传
          // reasoning_content（合成消息没有真实思考内容，传空字符串）
          reasoning_content: "",
          tool_calls: [
            {
              id: toolCallId,
              type: "function",
              function: {
                name: "show_form",
                arguments: JSON.stringify({
                  title: form.title,
                  description: form.description,
                  fields: form.fields,
                }),
              },
            },
          ],
        },
        {
          role: "tool",
          tool_call_id: toolCallId,
          name: "show_form",
          content: JSON.stringify({ data: values }),
        },
      ];
      await selfStore.setItem(threadKey, [...history, ...wire]);
      await api.driveTurn(threadId, firstUserText, []);
    } catch (err) {
      setTurnKey(null);
      res.turnStartAt = 0;
      markBusy(null);
      setMany({
        sending: false,
        stopRequested: false,
        liveTurnStats: null,
        turnStartTs: 0,
        keyError: err.message,
      });
    }
  }

  // 取消挂起的表单（用户停止 / 回合兜底结束）：卡片置 cancelled 只读
  function cancelPendingForm(reason = "") {
    if (!formWaiter) return;
    const { msgId, resolve } = formWaiter;
    formWaiter = null;
    const item = bucketFor(activeKey()).find((m) => m.id === msgId);
    const form = { ...(item?.form || {}), status: "cancelled" };
    patchMessage(msgId, { form });
    resolve({ cancelled: true, reason });
  }

  return { requestForm, submitForm, cancelPendingForm };
}
