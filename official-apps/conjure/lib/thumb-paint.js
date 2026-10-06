// 线框缩略图绘制：把 wire 指令回传的节点清单（盒模型 + 底色/边框/文字色/文本，
// 见 /bridge/debug-runtime.js 的 wireSnapshot）画成一张近似缩略图 JPEG。
//
// 预览气泡的窗口方块用它代替屏幕捕获——免授权、手机设备（无 getDisplayMedia）
// 同样可用。这是「数据 → 画布」的纯函数：主域只绘制样式数据，不执行任何
// AI 生成的代码（隔离预览的安全边界不受影响）。近似程度：布局几何、色块、
// 圆角、边框、文字色与字号保真；渐变/图片/阴影等不还原。

/**
 * 把线框数据画到一张 cover 裁填 16:10 的画布上，返回 JPEG dataURL。
 * @param {{ w: number, h: number, nodes: Array<Object> }} payload wireSnapshot 的返回值
 * @param {{ maxSide?: number, quality?: number }} [opts] maxSide 为画布长边上限（默认 440）
 * @returns {string} data:image/jpeg dataURL（payload 非法或无节点时返回 ""）
 */
export function paintWireframe(payload, opts = {}) {
  const maxSide = Math.max(120, opts.maxSide || 440);
  const quality = opts.quality ?? 0.7;
  if (
    !payload ||
    !Number.isFinite(payload.w) ||
    !Number.isFinite(payload.h) ||
    payload.w < 1 ||
    payload.h < 1 ||
    !Array.isArray(payload.nodes)
  ) {
    return "";
  }
  // cover 裁填 16:10 方块：scale 取「宽贴满」与「高贴满」的较大者，顶部对齐
  const scale = Math.max(maxSide / payload.w, maxSide / 1.6 / payload.h);
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(payload.w * scale));
  canvas.height = Math.max(1, Math.round(payload.h * scale));
  const ctx = canvas.getContext("2d");
  ctx.scale(scale, scale);
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, payload.w, payload.h);

  const roundRectPath = (ctx, x, y, w, h, r) => {
    const rr = Math.min(r, w / 2, h / 2);
    ctx.beginPath();
    if (typeof ctx.roundRect === "function") {
      ctx.roundRect(x, y, w, h, rr);
    } else {
      ctx.rect(x, y, w, h);
    }
  };

  for (const n of payload.nodes) {
    if (!n || !(n.w > 0) || !(n.h > 0)) continue;
    if (n.bg) {
      ctx.fillStyle = n.bg;
      roundRectPath(ctx, n.x, n.y, n.w, n.h, n.r || 0);
      ctx.fill();
    }
    if (n.bw > 0 && n.bc) {
      ctx.strokeStyle = n.bc;
      ctx.lineWidth = n.bw;
      roundRectPath(ctx, n.x, n.y, n.w, n.h, n.r || 0);
      ctx.stroke();
    }
    if (n.t) {
      ctx.save();
      // 文字裁进自身盒子，超宽自然截断
      ctx.beginPath();
      ctx.rect(n.x, n.y, n.w, n.h);
      ctx.clip();
      ctx.fillStyle = n.tc || "#000";
      const fs = n.fs || 14;
      ctx.font = `${fs}px -apple-system, BlinkMacSystemFont, "Segoe UI", "Microsoft Yahei", sans-serif`;
      ctx.textBaseline = "top";
      ctx.fillText(n.t, n.x + 2, n.y + 2, Math.max(4, n.w - 4));
      ctx.restore();
    }
  }
  return canvas.toDataURL("image/jpeg", quality);
}
