/**
 * 安全的轻量 Markdown 渲染器（GFM 子集），服务 AI 聊天的助手消息渲染。
 *
 * 安全模型（参照 deepseek-harness markdown 渲染器的不可信输出策略）：
 * - 所有源文本先经 HTML 转义，raw HTML 一律按字面文本渲染，不会有 HTML 进入 DOM
 * - 链接仅放行 http / https / mailto 协议；图片额外要求绝对 http(s) 地址
 * - 生成的标签全部来自本模块自身模板，属性值（href / data-code / text-align）不含源文本原文
 *
 * 支持块级：标题、段落（软换行渲染为 <br>，适配聊天阅读）、围栏代码块（流式未闭合时
 * 将余下内容按代码续渲）、无序/有序/任务列表（支持缩进嵌套）、引用块、分隔线、GFM 表格。
 * 行内：粗体 / 粗斜体 / 斜体 / 删除线、行内代码、链接、自动链接、图片。
 */

const escapeHtml = (s) =>
  s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

/** 链接协议白名单：http / https / mailto；返回归一化后的 href，不合法返回空串。 */
const safeHref = (url) => {
  try {
    const parsed = new URL(url);
    const ok =
      parsed.protocol === "http:" ||
      parsed.protocol === "https:" ||
      parsed.protocol === "mailto:";
    return ok ? parsed.href : "";
  } catch {
    return "";
  }
};

/** 图片仅允许绝对 http(s) 地址。 */
const httpSrc = (url) => {
  try {
    const parsed = new URL(url);
    return parsed.protocol === "http:" || parsed.protocol === "https:"
      ? parsed.href
      : "";
  } catch {
    return "";
  }
};

/** 行内渲染：先用占位符保护「已生成 HTML」的片段，再做转义与强调，最后回填。 */
const renderInline = (src) => {
  const stash = [];
  const keep = (html) => {
    stash.push(html);
    return `\u0000${stash.length - 1}\u0000`;
  };

  let text = src;

  // 1) 行内代码：整段保护，内部不再解析（换行折叠为空格，两侧各去一个空格）
  text = text.replace(/(`+)([\s\S]*?)\1/g, (_, ticks, code) => {
    const body = code.replace(/^ (.+) $/, "$1").replace(/\r?\n/g, " ");
    return keep(`<code>${escapeHtml(body)}</code>`);
  });

  // 2) 图片：仅绝对 http(s)；不放行时退化为斜体 alt 文本
  text = text.replace(/!\[([^\]]*)\]\(\s*([^)\s]+)\s*\)/g, (_, alt, url) => {
    const src = httpSrc(url);
    return keep(
      src
        ? `<img src="${escapeHtml(src)}" alt="${escapeHtml(alt)}" loading="lazy">`
        : `<em>${escapeHtml(alt)}</em>`,
    );
  });

  // 3) 链接：协议白名单；不放行时只保留文字
  text = text.replace(/\[([^\]]*)\]\(\s*([^)\s]+)\s*\)/g, (_, label, url) => {
    const href = safeHref(url);
    return keep(
      href
        ? `<a href="${escapeHtml(href)}" target="_blank" rel="noopener noreferrer">${escapeHtml(label)}</a>`
        : escapeHtml(label),
    );
  });

  // 4) 自动链接：尖括号形式与裸 URL（裁掉尾部标点与不成对的右括号）
  const autolink = (raw) => {
    let url = raw;
    url = url.replace(/[.,;:!?'"]+$/, "");
    const open = (url.match(/\(/g) || []).length;
    let close = (url.match(/\)/g) || []).length;
    while (url.endsWith(")") && close > open) {
      url = url.slice(0, -1);
      close -= 1;
    }
    const href = safeHref(url);
    return href
      ? keep(`<a href="${escapeHtml(href)}" target="_blank" rel="noopener noreferrer">${escapeHtml(url)}</a>`)
      : url;
  };
  text = text.replace(/<((?:https?|mailto):[^\s<>]+)>/g, (_, url) => autolink(url));
  text = text.replace(/\bhttps?:\/\/[^\s<>"']+/g, autolink);

  // 5) 转义剩余文本
  text = escapeHtml(text);

  // 6) 强调（在已转义文本上；占位符不含 * _ ~ 字符，不受影响）
  text = text
    .replace(/(\*\*\*|___)(?=\S)([\s\S]*?\S)\1/g, "<strong><em>$2</em></strong>")
    .replace(/(\*\*|__)(?=\S)([\s\S]*?\S)\1/g, "<strong>$2</strong>")
    .replace(/(?<![\w*])\*(?=\S)([^*\n]*?\S)\*(?!\w)/g, "<em>$1</em>")
    .replace(/(?<![\w_])_(?=\S)([^_\n]*?\S)_(?!\w)/g, "<em>$1</em>")
    .replace(/~~(?=\S)([\s\S]*?\S)~~/g, "<del>$1</del>");

  // 7) 回填占位符，并把段落内剩余换行渲染为 <br>（聊天阅读习惯）
  text = text.replace(/\u0000(\d+)\u0000/g, (_, i) => stash[+i]);
  return text.replace(/\n/g, "<br>");
};

/** 围栏代码块：带语言标签栏与复制按钮（复制经页面层事件委托实现）。 */
const codeBlock = (code, lang) =>
  `<div class="md-code">` +
  `<div class="md-code-head"><span class="md-lang">${escapeHtml(lang)}</span>` +
  `<button class="md-copy" type="button" data-code="${escapeHtml(code)}">复制</button></div>` +
  `<pre><code>${escapeHtml(code)}</code></pre></div>`;

/** 列表行 → 节点树（按缩进层级），再递归渲染。 */
const renderListLines = (items) => {
  const roots = [];
  const stack = [{ indent: -1, children: roots }];
  for (const it of items) {
    const node = { ...it, children: [] };
    while (stack.length > 1 && stack[stack.length - 1].indent >= it.indent) {
      stack.pop();
    }
    stack[stack.length - 1].children.push(node);
    stack.push(node);
  }

  const renderNodes = (nodes) => {
    const ordered = nodes[0].ordered;
    const lis = nodes
      .map((n) => {
        let text = n.text;
        let task = "";
        const m = /^\[([ xX])\]\s+/.exec(text);
        if (m) {
          task = `<input type="checkbox" disabled${m[1] === " " ? "" : " checked"}>`;
          text = text.slice(m[0].length);
        }
        let inner = task ? `${task} ${renderMarkdown(text)}` : renderMarkdown(text);
        if (n.children.length) inner += renderNodes(n.children);
        return `<li>${inner}</li>`;
      })
      .join("");
    return ordered ? `<ol>${lis}</ol>` : `<ul>${lis}</ul>`;
  };

  return renderNodes(roots);
};

const FENCE_RE = /^ {0,3}(```+|~~~+)\s*([\w+#.-]*)\s*$/;
const LIST_RE = /^(\s*)([-*+]|\d{1,9}[.)])\s+(.*)$/;
const HEAD_RE = /^ {0,3}(#{1,6})\s+(.*)$/;
const HR_RE = /^ {0,3}([-*_])(?:\s*\1){2,}\s*$/;
const QUOTE_RE = /^ {0,3}>/;
const SEP_CELL_RE = /^ {0,3}\|?\s*:?-{1,}:?\s*(?:\|\s*:?-{1,}:?\s*)*\|?\s*$/;

/** 主入口：Markdown 源文本 → 安全 HTML 字符串。 */
export const renderMarkdown = (src) => {
  if (!src) return "";
  const lines = src.replace(/\r\n?/g, "\n").split("\n");
  const out = [];
  let i = 0;

  const isTableSep = (l) => l.includes("|") && SEP_CELL_RE.test(l);

  while (i < lines.length) {
    const line = lines[i];

    if (!line.trim()) {
      i += 1;
      continue;
    }

    // 围栏代码块（流式未闭合时，余下内容全部按代码渲染）
    const fence = FENCE_RE.exec(line);
    if (fence) {
      const lang = fence[2] || "";
      i += 1;
      const buf = [];
      while (i < lines.length) {
        const c = /^ {0,3}(`{3,}|~{3,})\s*$/.exec(lines[i]);
        if (c && c[1][0] === fence[1][0] && c[1].length >= fence[1].length) break;
        buf.push(lines[i]);
        i += 1;
      }
      if (i < lines.length) i += 1; // 跳过闭合围栏
      out.push(codeBlock(buf.join("\n"), lang));
      continue;
    }

    // 标题
    const h = HEAD_RE.exec(line);
    if (h) {
      const depth = h[1].length;
      out.push(`<h${depth}>${renderInline(h[2].trim())}</h${depth}>`);
      i += 1;
      continue;
    }

    // 分隔线
    if (HR_RE.test(line)) {
      out.push("<hr>");
      i += 1;
      continue;
    }

    // 引用块
    if (QUOTE_RE.test(line)) {
      const buf = [];
      while (i < lines.length && QUOTE_RE.test(lines[i])) {
        buf.push(lines[i].replace(/^ {0,3}>\s?/, ""));
        i += 1;
      }
      out.push(`<blockquote>${renderMarkdown(buf.join("\n"))}</blockquote>`);
      continue;
    }

    // GFM 表格：当前行含 | 且下一行是分隔行
    if (line.includes("|") && i + 1 < lines.length && isTableSep(lines[i + 1])) {
      const parseRow = (l) => {
        let s = l.trim();
        if (s.startsWith("|")) s = s.slice(1);
        if (s.endsWith("|")) s = s.slice(0, -1);
        return s.split("|").map((c) => c.trim());
      };
      const head = parseRow(line);
      const aligns = parseRow(lines[i + 1]).map((c) =>
        c.startsWith(":") && c.endsWith(":")
          ? "center"
          : c.startsWith(":")
            ? "left"
            : c.endsWith(":")
              ? "right"
              : "",
      );
      i += 2;
      const rows = [];
      while (i < lines.length && lines[i].includes("|") && lines[i].trim()) {
        rows.push(parseRow(lines[i]));
        i += 1;
      }
      const cell = (c, tag, k) =>
        `<${tag}${aligns[k] ? ` style="text-align:${aligns[k]}"` : ""}>${renderInline(c)}</${tag}>`;
      out.push(
        `<div class="md-table"><table><thead><tr>${head
          .map((c, k) => cell(c, "th", k))
          .join("")}</tr></thead><tbody>${rows
          .map((r) => `<tr>${r.map((c, k) => cell(c, "td", k)).join("")}</tr>`)
          .join("")}</tbody></table></div>`,
      );
      continue;
    }

    // 列表（含缩进续行）
    if (LIST_RE.test(line)) {
      const items = [];
      while (i < lines.length) {
        const m = LIST_RE.exec(lines[i]);
        if (m) {
          const prev = items[items.length - 1];
          // 同级标记类型变化（无序 ↔ 有序）时开启新列表（CommonMark 行为）
          if (
            prev &&
            m[1].length <= prev.indent &&
            /\d/.test(m[2][0]) !== prev.ordered
          ) {
            break;
          }
          items.push({
            indent: m[1].length,
            ordered: /\d/.test(m[2][0]),
            text: m[3],
          });
          i += 1;
        } else if (
          items.length &&
          lines[i].trim() &&
          !FENCE_RE.test(lines[i]) &&
          !HEAD_RE.test(lines[i]) &&
          !HR_RE.test(lines[i]) &&
          !QUOTE_RE.test(lines[i]) &&
          !LIST_RE.test(lines[i]) &&
          !isTableSep(lines[i])
        ) {
          // 列表项的懒续行（普通文本并入前一项）
          items[items.length - 1].text += `\n${lines[i].trim()}`;
          i += 1;
        } else {
          break;
        }
      }
      out.push(renderListLines(items));
      continue;
    }

    // 段落：吃到空行或任一块级起始
    const buf = [line.trim()];
    i += 1;
    while (
      i < lines.length &&
      lines[i].trim() &&
      !FENCE_RE.test(lines[i]) &&
      !HEAD_RE.test(lines[i]) &&
      !HR_RE.test(lines[i]) &&
      !QUOTE_RE.test(lines[i]) &&
      !LIST_RE.test(lines[i]) &&
      !isTableSep(lines[i])
    ) {
      buf.push(lines[i].trim());
      i += 1;
    }
    out.push(`<p>${renderInline(buf.join("\n"))}</p>`);
  }

  return out.join("");
};
