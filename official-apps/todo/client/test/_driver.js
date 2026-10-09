// 场景测试的本地回放驱动（可选工具，不是用例本体）
//
// 用途：宿主**没有**注入 run-tests 通道时（`preview action=run-tests` 会返回「宿主未注入预览通道」），
// 用 preview 的 eval 动作手动回放 client/test/*.test.json，步骤语义与宿主一致：
//   eval  → 以 `T` 为参数执行异步函数体（辅助函数与中间状态挂在 T 上，同一用例内共享）
//   reload → 返回断点（reload 必须单独发一条 eval，见 pitfalls/018）
//   wait  → 毫秒数 或 { selector }
//   click → 深度查找元素并点击（st-button 等要点到内部原生 button）
//   expect→ 交回宿主校验（本驱动只记录，不判定）
//
// 用法（每条 preview eval 一条指令，单条别超过 30s，长用例用 to 分片）：
//   const d = await import(new URL('./test/_driver.js', location.href).href + '?t=' + Date.now());
//   return await d.run('trash-purge', 2, 5);   // 跑 index 2..4，返回 pausedAt: 5
//
// 注意：动态 import 必须用「相对 location.href 的绝对 URL」，写 './test/_driver.js' 会被解析到 /bridge/。
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const rootEl = () => {
  const page = document.querySelector('o-page');
  return page ? page.shadowRoot : null;
};

const findDeep = (sel) => {
  const root = rootEl();
  if (!root) return null;
  const direct = root.querySelector(sel);
  if (direct) return direct;
  const walk = Array.from(root.querySelectorAll('*'));
  for (const el of walk) {
    if (el.shadowRoot) {
      const hit = el.shadowRoot.querySelector(sel);
      if (hit) return hit;
    }
  }
  return null;
};

export async function run(file, from = 0, to = 9999) {
  const res = await fetch('./test/' + file + '.test.json?t=' + Date.now());
  const spec = await res.json();
  window.__RUN = window.__RUN || { T: {} };
  const T = window.__RUN.T;
  const log = [];
  for (let i = from; i < Math.min(spec.steps.length, to); i++) {
    const st = spec.steps[i];
    try {
      if (typeof st.eval === 'string') {
        const out = await new Function('T', 'return (async () => {' + st.eval + '})()')(T);
        log.push(i + ' eval ok ' + (out === undefined ? '' : String(out).slice(0, 60)));
      } else if (st.reload) {
        return { file, reloadAt: i + 1, log };
      } else if (st.wait !== undefined) {
        if (typeof st.wait === 'number') {
          await sleep(st.wait);
          log.push(i + ' wait ' + st.wait + 'ms');
        } else if (st.wait.selector) {
          let ok = false;
          for (let k = 0; k < 75; k++) {
            if (findDeep(st.wait.selector)) { ok = true; break; }
            await sleep(200);
          }
          if (!ok) throw new Error('等待超时: ' + st.wait.selector);
          log.push(i + ' wait ' + st.wait.selector);
        }
      } else if (typeof st.click === 'string') {
        const el = findDeep(st.click);
        if (!el) throw new Error('元素不存在: ' + st.click);
        const inner = el.shadowRoot && el.shadowRoot.querySelector('button');
        (inner || el).click();
        log.push(i + ' click ' + st.click);
      } else if (st.expect !== undefined) {
        log.push(i + ' expect（宿主校验项，本驱动跳过） ' + JSON.stringify(st.expect));
      } else {
        log.push(i + ' 未知步骤 ' + JSON.stringify(st).slice(0, 80));
      }
    } catch (e) {
      return { file, failedAt: i, step: JSON.stringify(st).slice(0, 180), error: String((e && e.message) || e), log };
    }
  }
  return { file, done: to >= spec.steps.length, pausedAt: spec.steps.length > to ? to : undefined, log };
}
