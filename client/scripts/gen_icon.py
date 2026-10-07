#!/usr/bin/env python3
"""生成 Mazmot Runtime 应用图标（1024×1024 PNG）。

仓库里没有现成 logo，且本机没有 PIL/ImageMagick，这里用纯 Python 实现
SDF（signed distance field）渲染：Material 3 风格渐变圆角方块 + 白色 "M"。
输出 client/assets/icon.png，供 `tauri icon` 派生全平台尺寸。
"""

import math
import struct
import sys
import zlib
from pathlib import Path

SIZE = 1024
SS = 2  # 2x 超采样抗锯齿
OUT = Path(__file__).resolve().parent.parent / "assets" / "icon.png"

# Material Design 3 主色：浅紫容器 → 深主紫，对角渐变
TOP = (208, 188, 255)   # #D0BCFF
BOTTOM = (103, 80, 164)  # #6750A4
WHITE = (255, 255, 255)


def clamp(v, lo, hi):
    return max(lo, min(hi, v))


def smoothstep(edge0, edge1, x):
    t = clamp((x - edge0) / (edge1 - edge0), 0.0, 1.0)
    return t * t * (3 - 2 * t)


def sd_rounded_rect(px, py, cx, cy, half, radius):
    """圆角方形 SDF（负值在内部）"""
    qx = abs(px - cx) - (half - radius)
    qy = abs(py - cy) - (half - radius)
    ox = max(qx, 0.0)
    oy = max(qy, 0.0)
    return math.hypot(ox, oy) + min(max(qx, qy), 0.0) - radius


def sd_segment(px, py, ax, ay, bx, by):
    """线段 SDF（点到线段的最短距离）"""
    abx, aby = bx - ax, by - ay
    apx, apy = px - ax, py - ay
    h = clamp((apx * abx + apy * aby) / (abx * abx + aby * aby), 0.0, 1.0)
    dx, dy = apx - h * abx, apy - h * aby
    return math.hypot(dx, dy)


# "M" 笔画折线（归一化坐标，画布中心为原点、右/下为正）
M_PATH = [
    (-0.235, 0.215),
    (-0.235, -0.135),
    (0.0, 0.10),
    (0.235, -0.135),
    (0.235, 0.215),
]
M_STROKE = 0.085  # 笔画宽度（归一化）


def main():
    n = SIZE * SS
    scale = n / 2.0
    radius_ratio = 0.225  # Material 风格大圆角
    half = 0.5 * 0.88  # 留 12% 边距（macOS 图标惯例）

    rows = []
    for y in range(n):
        # 归一化坐标：中心原点，范围约 [-1, 1]
        py = (y + 0.5) / scale - 1.0
        row = bytearray()
        for x in range(n):
            px = (x + 0.5) / scale - 1.0

            # 背景圆角方块（AA 由 smoothstep 覆盖 ±2 像素带）
            d_bg = sd_rounded_rect(px, py, 0.0, 0.0, half, radius_ratio)
            bg_alpha = smoothstep(1.5 / n, -1.5 / n, d_bg)

            # 对角渐变
            t = clamp((px + py + 2 * half) / (4 * half), 0.0, 1.0)
            r = TOP[0] + (BOTTOM[0] - TOP[0]) * t
            g = TOP[1] + (BOTTOM[1] - TOP[1]) * t
            b = TOP[2] + (BOTTOM[2] - TOP[2]) * t

            # 白色 "M"（胶囊形笔画）
            d_m = min(
                sd_segment(px, py, ax, ay, bx, by)
                for (ax, ay), (bx, by) in zip(M_PATH, M_PATH[1:])
            ) - M_STROKE / 2
            m_alpha = smoothstep(1.5 / n, -1.5 / n, d_m)

            rr = r + (WHITE[0] - r) * m_alpha
            gg = g + (WHITE[1] - g) * m_alpha
            bb = b + (WHITE[2] - b) * m_alpha

            row += bytes((int(rr), int(gg), int(bb), int(bg_alpha * 255)))
        rows.append(bytes(row))

    # 2x 盒式降采样 → 1024
    out_rows = []
    for y in range(SIZE):
        top, bottom = rows[2 * y], rows[2 * y + 1]
        line = bytearray()
        for x in range(SIZE):
            for c in range(4):
                s = (
                    top[4 * (2 * x) + c]
                    + top[4 * (2 * x + 1) + c]
                    + bottom[4 * (2 * x) + c]
                    + bottom[4 * (2 * x + 1) + c]
                )
                line.append(s // 4)
        out_rows.append(bytes(line))

    write_png(OUT, SIZE, SIZE, b"".join(out_rows))
    print(f"icon written: {OUT}")


def write_png(path: Path, w: int, h: int, raw: bytes):
    def chunk(tag: bytes, data: bytes) -> bytes:
        return (
            struct.pack(">I", len(data))
            + tag
            + data
            + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF)
        )

    ihdr = struct.pack(">IIBBBBB", w, h, 8, 6, 0, 0, 0)  # 8bit RGBA
    scan = b"".join(b"\x00" + raw[y * w * 4 : (y + 1) * w * 4] for y in range(h))
    png = (
        b"\x89PNG\r\n\x1a\n"
        + chunk(b"IHDR", ihdr)
        + chunk(b"IDAT", zlib.compress(scan, 9))
        + chunk(b"IEND", b"")
    )
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(png)


if __name__ == "__main__":
    sys.exit(main())
