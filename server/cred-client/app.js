// cred-hub 管理器 —— 调用 cred-hub 只读管理 API（/admin/stats / /admin/hot / /admin/expiring）。
// 纯静态单页，无框架无构建；连接信息持久化在 localStorage（仅本浏览器）。

const STORAGE_KEY = "cred-client-conn";

const $ = (sel) => document.querySelector(sel);
const els = {
  url: $("#server-url"),
  token: $("#admin-token"),
  connect: $("#btn-connect"),
  connState: $("#conn-state"),
  connError: $("#conn-error"),
  tabs: $("#tabs"),
  hotLimit: $("#hot-limit"),
  expiringDays: $("#expiring-days"),
};

let conn = { url: "", token: "" };

// ———— 连接信息持久化 ————

try {
  const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || "null");
  if (saved?.url) {
    conn = saved;
    els.url.value = saved.url;
    els.token.value = saved.token || "";
    setConnected(true);
    connect().catch(() => {}); // 恢复上次连接，失败静默（错误会在界面显示）
  }
} catch {}

function saveConn() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(conn));
  } catch {}
}

function setConnected(state, text) {
  els.connState.dataset.state = state === true ? "ok" : state === false ? "err" : "off";
  els.connState.textContent = text || (state === true ? "已连接" : state === false ? "连接失败" : "未连接");
  els.tabs.hidden = state !== true;
}

function showError(message) {
  els.connError.textContent = message;
  els.connError.hidden = !message;
}

// ———— 请求封装 ————

async function api(path) {
  let res;
  try {
    res = await fetch(conn.url + path, {
      headers: conn.token ? { authorization: `Bearer ${conn.token}` } : {},
    });
  } catch (err) {
    throw new Error(`网络请求失败（服务器不可达，或未开启 CORS）：${err.message}`);
  }
  if (res.status === 401) throw new Error("管理令牌无效（401）");
  if (res.status === 404) throw new Error("管理 API 不可用（404）：服务器可能未配置 CRED_HUB_ADMIN_TOKEN");
  let data;
  try {
    data = await res.json();
  } catch {
    throw new Error(`响应不是 JSON（HTTP ${res.status}）`);
  }
  if (!res.ok || !data.ok) throw new Error(data.error || `请求失败（HTTP ${res.status}）`);
  return data;
}

async function connect() {
  const url = els.url.value.trim().replace(/\/+$/, "");
  if (!/^https?:\/\/.+/i.test(url)) {
    setConnected(false, "地址无效");
    showError("请输入以 http(s):// 开头的服务器地址");
    return;
  }
  showError("");
  conn = { url, token: els.token.value.trim() };
  els.connect.disabled = true;
  try {
    await api("/admin/stats"); // stats 同时验证可达性、令牌与管理 API 开关
    saveConn();
    setConnected(true);
    refreshTab("stats");
  } catch (err) {
    setConnected(false);
    showError(err.message);
  } finally {
    els.connect.disabled = false;
  }
}

// ———— 渲染 ————

const fmtTime = (ts) => (ts ? new Date(ts).toLocaleString() : "—");
const fmtExpire = (ts) => (ts == null ? "永不过期" : fmtTime(ts));
const esc = (s) =>
  String(s ?? "").replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]),
  );

function renderTable(container, columns, items) {
  if (!items.length) {
    container.innerHTML = `<p class="empty">暂无数据</p>`;
    return;
  }
  const head = columns.map((c) => `<th>${esc(c.label)}</th>`).join("");
  const rows = items
    .map(
      (it) =>
        `<tr>${columns
          .map((c) => {
            const cls = c.mono ? " class='mono'" : c.dim ? " class='dim'" : "";
            return `<td${cls}>${esc(c.render(it))}</td>`;
          })
          .join("")}</tr>`,
    )
    .join("");
  container.innerHTML = `<table><thead><tr>${head}</tr></thead><tbody>${rows}</tbody></table>`;
}

// ———— 各标签页数据 ————

const loaders = {
  async stats() {
    const data = await api("/admin/stats");
    const defs = [
      ["凭证总数", data.creds.total],
      ["active（活跃）", data.creds.active],
      ["cooling（变冷）", data.creds.cooling],
      ["有效配对码", data.pairing.activeCodes],
      ["保留期（天）", (data.retentionMs / 86400000).toFixed(1)],
    ];
    $("#stats-grid").innerHTML = defs
      .map(
        ([label, num]) =>
          `<div class="stat"><div class="num">${esc(num)}</div><div class="label">${esc(label)}</div></div>`,
      )
      .join("");
  },

  async hot() {
    const limit = Math.min(Math.max(parseInt(els.hotLimit.value, 10) || 50, 1), 200);
    const data = await api(`/admin/hot?limit=${limit}`);
    renderTable($("#hot-table"), [
      { label: "角色", render: (it) => it.role },
      { label: "签发者", render: (it) => it.issuer, mono: true },
      { label: "主体", render: (it) => it.subject, mono: true },
      { label: "到期", render: (it) => fmtExpire(it.expire) },
      { label: "最后访问", render: (it) => fmtTime(it.lastAccessMs), dim: true },
      { label: "凭证 ID", render: (it) => it.id, mono: true },
    ], data.items);
  },

  async expiring() {
    let days = parseInt(els.expiringDays.value, 10) || 30;
    days = Math.min(Math.max(days, 1), 3650);
    const data = await api(`/admin/expiring?withinDays=${days}`);
    renderTable($("#expiring-table"), [
      { label: "到期时间", render: (it) => fmtTime(it.expire) },
      { label: "角色", render: (it) => it.role },
      { label: "签发者", render: (it) => it.issuer, mono: true },
      { label: "主体", render: (it) => it.subject, mono: true },
      { label: "最后访问", render: (it) => fmtTime(it.lastAccessMs), dim: true },
      { label: "凭证 ID", render: (it) => it.id, mono: true },
    ], data.items);
  },
};

async function refreshTab(name) {
  const btn = document.querySelector(`[data-refresh="${name}"]`);
  btn.disabled = true;
  try {
    await loaders[name]();
    showError("");
  } catch (err) {
    showError(err.message);
  } finally {
    btn.disabled = false;
  }
}

// ———— 事件 ————

els.connect.addEventListener("click", connect);
els.url.addEventListener("keydown", (e) => e.key === "Enter" && connect());
els.token.addEventListener("keydown", (e) => e.key === "Enter" && connect());

document.querySelectorAll(".tab").forEach((tab) => {
  tab.addEventListener("click", () => {
    document.querySelectorAll(".tab").forEach((t) => t.classList.remove("active"));
    tab.classList.add("active");
    document.querySelectorAll(".tab-panel").forEach((p) => (p.hidden = true));
    const name = tab.dataset.tab;
    $(`#panel-${name}`).hidden = false;
    refreshTab(name); // 切到即刷新，保证数据新鲜
  });
});

document.querySelectorAll("[data-refresh]").forEach((btn) => {
  btn.addEventListener("click", () => refreshTab(btn.dataset.refresh));
});
