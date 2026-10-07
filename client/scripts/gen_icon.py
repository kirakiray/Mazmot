#!/usr/bin/env python3
"""生成 Mazmot Runtime 应用图标（1024×1024 PNG）。

按 mz/comps/mascot/mascot.html 默认状态（相机机器人）复刻：
银色双环镜头 + 深蓝镜腔内 12 片蓝色光圈叶片（clip-path 轮廓放射排列）+
黑色瞳孔（带对叶片的投影）+ 镜面高光 + 上下眼睑 + 四颗边缘螺丝；
背景圆角方块用组件 model-badge 的品牌渐变（135° #667eea → #764ba2）。

纯 Python SDF 渲染（无 PIL 依赖），2x 超采样 + 盒式降采样抗锯齿。
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

# ---- 品牌色（取自 mascot.html）----
BG_TOP = (102, 126, 234)     # model-badge 渐变起 #667eea
BG_BOTTOM = (118, 75, 162)   # model-badge 渐变止 #764ba2
EYE = (59, 130, 246)         # --mascot-eye-color #3b82f6

# 镜头环（mascot.html 的 lens-outer / lens-middle / eyelid 渐变）
OUTER_A = (208, 208, 208)    # #d0d0d0
OUTER_B = (160, 160, 160)    # #a0a0a0
MID_A = (229, 229, 229)      # #e5e5e5
MID_B = (192, 192, 192)      # #c0c0c0
SCREW_A = (245, 245, 245)    # #f5f5f5
SCREW_B = (208, 208, 208)    # #d0d0d0
LENS_A = (26, 26, 46)        # #1a1a2e
LENS_B = (15, 15, 30)        # #0f0f1e
EYELID_A = (216, 216, 216)   # #d8d8d8
EYELID_B = (198, 198, 198)   # #c6c6c6

# ---- 几何（归一化坐标：画布半宽 = 1.0；比例换算 k = 0.95 × mascot em 值）----
K = 0.95
R_OUTER = 0.3335 * K          # lens-outer 半径
R_MID = 0.2665 * K            # lens-middle 半径
R_INNER = 0.2165 * K          # lens-inner 半径（深色镜腔）
R_MASK = 0.25 * K             # eyelid-mask 半径
EYELID_H = 0.083 * K          # 眼睑厚度（idle 态）
R_PUPIL = 0.0665 * K          # lens-center 瞳孔半径
R_BLADE_TIP = 0.20 * K        # 光圈叶片外端（blade 高 0.2em）
W_BLADE = 0.15 * K            # 光圈叶片宽（0.15em）
R_SCREW = 0.06 * K            # 螺丝半径（0.12em）
D_SCREW = 0.34 * K            # 螺丝到中心距离（body 1em 内 0.5±0.16）
SCREWS = [(0, -D_SCREW), (D_SCREW, 0), (0, D_SCREW), (-D_SCREW, 0)]  # 上右下左
N_BLADES = 12

# clip-path 轮廓：blade 元素内 y（0=外端尖，1=根部）处的左右边界（x 占宽比）
BLADE_LEFT = [(0.0, 0.40), (0.25, 0.25), (0.50, 0.12), (0.75, 0.02), (1.0, 0.0)]
BLADE_RIGHT = [(0.0, 0.60), (0.25, 0.75), (0.50, 0.88), (0.75, 0.98), (1.0, 1.0)]

# CSS 145° 渐变方向（0°=向上，顺时针；屏幕坐标 y 向下）
G145 = (math.sin(math.radians(145)), -math.cos(math.radians(145)))


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


def piecewise(table, t):
    """分段线性插值"""
    for (t0, v0), (t1, v1) in zip(table, table[1:]):
        if t <= t1:
            u = (t - t0) / (t1 - t0)
            return v0 + (v1 - v0) * u
    return table[-1][1]


def lerp3(a, b, t):
    return (
        a[0] + (b[0] - a[0]) * t,
        a[1] + (b[1] - a[1]) * t,
        a[2] + (b[2] - a[2]) * t,
    )


def render():
    n = SIZE * SS
    scale = n / 2.0
    aa = 1.5 / n  # 抗锯齿带宽（归一化单位）
    half = 0.5 * 0.88  # 背景圆角方块半宽（留 12% 边距）
    radius = 0.20  # 背景圆角半径
    blade_aa = 2.5 / n

    rows = []
    for y in range(n):
        py = (y + 0.5) / scale - 1.0
        row = bytearray()
        for x in range(n):
            px = (x + 0.5) / scale - 1.0

            # ---- 背景：品牌渐变圆角方块 ----
            d_bg = sd_rounded_rect(px, py, 0.0, 0.0, half, radius)
            alpha = smoothstep(aa, -aa, d_bg)
            t_bg = clamp(((px + 1) + (py + 1)) / 4.0, 0.0, 1.0)  # 135° 渐变
            r, g, b = lerp3(BG_TOP, BG_BOTTOM, t_bg)

            dx, dy = px, py
            dist = math.hypot(dx, dy)

            # ---- 四颗边缘螺丝（银色小球，上半亮下半暗）----
            for sx, sy in SCREWS:
                ddx, ddy = px - sx, py - sy
                d = math.hypot(ddx, ddy)
                if d < R_SCREW + aa:
                    t_s = clamp(0.5 + (ddx + ddy) / (2.2 * R_SCREW), 0.0, 1.0)
                    sr, sg, sb = lerp3(SCREW_A, SCREW_B, t_s)
                    rim = smoothstep(R_SCREW * 0.55, R_SCREW, d) * 0.18
                    sr *= 1 - rim
                    sg *= 1 - rim
                    sb *= 1 - rim
                    cov = smoothstep(aa, -aa, d - R_SCREW)
                    r += (sr - r) * cov
                    g += (sg - g) * cov
                    b += (sb - b) * cov

            # ---- lens-outer：银色外环（CSS 145° 渐变）----
            if dist < R_OUTER + aa:
                t_o = clamp((G145[0] * dx + G145[1] * dy + R_OUTER) / (2 * R_OUTER), 0.0, 1.0)
                orr, og, ob = lerp3(OUTER_A, OUTER_B, t_o)
                cov = smoothstep(aa, -aa, dist - R_OUTER)
                r += (orr - r) * cov
                g += (og - g) * cov
                b += (ob - b) * cov

            # ---- lens-middle：亮银内环（含内侧 inset 阴影）----
            if dist < R_MID + aa:
                t_m = clamp((G145[0] * dx + G145[1] * dy + R_MID) / (2 * R_MID), 0.0, 1.0)
                mr, mg, mb = lerp3(MID_A, MID_B, t_m)
                inset = smoothstep(R_MID - 0.35 * (R_MID - R_INNER), R_MID, dist) * 0.10
                mr *= 1 - inset
                mg *= 1 - inset
                mb *= 1 - inset
                cov = smoothstep(aa, -aa, dist - R_MID)
                r += (mr - r) * cov
                g += (mg - g) * cov
                b += (mb - b) * cov

            # ---- lens-inner：深蓝镜腔 ----
            if dist < R_INNER + aa:
                cov_inner = smoothstep(aa, -aa, dist - R_INNER)
                t_l = clamp((dy + R_INNER) / (2 * R_INNER), 0.0, 1.0)  # 180° 渐变
                lr, lg, lb = lerp3(LENS_A, LENS_B, t_l)
                # 镜腔外缘 inset 阴影（lens-outer 的内阴影观感）
                rim_dark = smoothstep(R_INNER - 0.014, R_INNER, dist) * 0.35
                lr *= 1 - rim_dark
                lg *= 1 - rim_dark
                lb *= 1 - rim_dark

                # ---- 12 片蓝色光圈叶片（clip-path 轮廓精确复刻）----
                if dist > R_PUPIL * 0.6 and dist < R_BLADE_TIP + blade_aa:
                    theta = math.atan2(dy, dx)
                    sector = 2 * math.pi / N_BLADES
                    k_bl = round(theta / sector)
                    # 转到叶片局部坐标（轴向 a=距中心距离，横向 o）
                    phi = theta - k_bl * sector
                    a_axial = dist * math.cos(phi)
                    o_lat = dist * math.sin(phi)
                    if 0 < a_axial <= R_BLADE_TIP:
                        y_bl = 1.0 - a_axial / R_BLADE_TIP  # 0=外端 1=根部
                        x_bl = 0.5 + o_lat / W_BLADE
                        lo = piecewise(BLADE_LEFT, y_bl)
                        hi = piecewise(BLADE_RIGHT, y_bl)
                        if lo < x_bl < hi:
                            # 叶片色：根部亮蓝 → 外端混 20% 黑
                            br, bg_, bb = lerp3(EYE, (0, 0, 0), 0.20 * y_bl)
                            # 瞳孔投影：靠瞳孔处压暗（lens-center 的黑 box-shadow）
                            shade = smoothstep(R_PUPIL * 1.45, R_PUPIL, dist) * 0.4
                            br *= 1 - shade
                            bg_ *= 1 - shade
                            bb *= 1 - shade
                            edge = min(x_bl - lo, hi - x_bl) * W_BLADE
                            cov_bl = smoothstep(0.0, blade_aa, edge)
                            lr += (br - lr) * cov_bl
                            lg += (bg_ - lg) * cov_bl
                            lb += (bb - lb) * cov_bl

                # ---- 瞳孔（lens-center，软边黑）----
                if dist < R_PUPIL + aa * 2:
                    cov_p = smoothstep(R_PUPIL, R_PUPIL - aa * 2, dist)
                    lr += (0 - lr) * cov_p
                    lg += (0 - lg) * cov_p
                    lb += (8 - lb) * cov_p

                # ---- 镜面高光（lens-reflection：-20° 斜向白痕，左上）----
                gx = dx - (-0.071 * K)
                gy = dy - (-0.046 * K)
                c, s = math.cos(math.radians(20)), math.sin(math.radians(20))
                ux = gx * c - gy * s
                uy = gx * s + gy * c
                d_glare = math.hypot(ux / 0.032, uy / 0.016)
                if d_glare < 1.6:
                    glint = (1.0 - smoothstep(0.2, 1.4, d_glare)) * 0.5
                    lr += (255 - lr) * glint
                    lg += (255 - lg) * glint
                    lb += (255 - lb) * glint

                r += (lr - r) * cov_inner
                g += (lg - g) * cov_inner
                b += (lb - b) * cov_inner

            # ---- 眼睑（eyelid：上下灰带，mask 圆裁剪，贴环色调）----
            if dist < R_MASK + aa:
                band_top = dy < -R_MASK + EYELID_H
                band_bot = dy > R_MASK - EYELID_H
                if band_top or band_bot:
                    t_e = clamp((dy + R_MASK) / (2 * R_MASK), 0.0, 1.0)
                    er, eg, eb = lerp3(EYELID_A, EYELID_B, t_e)
                    # 靠镜腔一侧压一条内阴影（eyelid 的 box-shadow）
                    edge_dist = (
                        (dy - (-R_MASK + EYELID_H))
                        if band_top
                        else (R_MASK - EYELID_H - dy)
                    )
                    shade = smoothstep(0.010 * K, 0.0, abs(edge_dist)) * 0.14
                    er *= 1 - shade
                    eg *= 1 - shade
                    eb *= 1 - shade
                    cov_m = smoothstep(aa, -aa, dist - R_MASK)
                    er = lerp3((r, g, b), (er, eg, eb), cov_m)
                    r, g, b = er

            row += bytes((int(r), int(g), int(b), int(alpha * 255)))
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
    sys.exit(render())
