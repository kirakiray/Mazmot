#!/usr/bin/env python3
"""生成 Mazmot 应用图标与站点 favicon。

按 mz/comps/mascot/mascot.html 默认状态（相机机器人）复刻：
银色双环镜头 + 深蓝镜腔内 12 片蓝色光圈叶片（clip-path 轮廓放射排列）+
黑色瞳孔（带对叶片的投影）+ 镜面高光 + 上下眼睑 + 四颗边缘螺丝。

输出两份：
1. client/assets/icon.png —— 应用图标源（品牌渐变圆角方块打底），
   供 `tauri icon` 派生全平台尺寸；
2. 仓库根 favicon.ico —— 站点首页 favicon（无底色透明版，16/32/48/64
   多尺寸 PNG-in-ICO）。

纯 Python SDF 渲染（无 PIL 依赖），2x 超采样 + 盒式降采样抗锯齿。
"""

import math
import struct
import sys
import zlib
from pathlib import Path

SS = 2  # 2x 超采样抗锯齿
CLIENT_DIR = Path(__file__).resolve().parent.parent
ICON_OUT = CLIENT_DIR / "assets" / "icon.png"
FAVICON_OUT = CLIENT_DIR.parent / "favicon.ico"

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

# clip-path 轮廓：blade 元素内 y（0=外端尖，1=根部）处的左右边界（x 占宽比）
BLADE_LEFT = [(0.0, 0.40), (0.25, 0.25), (0.50, 0.12), (0.75, 0.02), (1.0, 0.0)]
BLADE_RIGHT = [(0.0, 0.60), (0.25, 0.75), (0.50, 0.88), (0.75, 0.98), (1.0, 1.0)]

# CSS 145° 渐变方向（0°=向上，顺时针；屏幕坐标 y 向下）
G145 = (math.sin(math.radians(145)), -math.cos(math.radians(145)))

N_BLADES = 12


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


def render_canvas(size, k, with_bg):
    """渲染一帧相机机器人。k = mascot em 值 → 归一化坐标（画布半宽=1.0）的换算系数。

    with_bg=True：品牌渐变圆角方块打底（应用图标）；
    with_bg=False：透明底，仅机器人本体（favicon）。
    返回 PNG 字节。
    """
    n = size * SS
    scale = n / 2.0
    aa = 1.5 / n  # 抗锯齿带宽（归一化单位）
    blade_aa = 2.5 / n
    half = 0.5 * 0.88  # 背景圆角方块半宽（留 12% 边距）
    radius = 0.20

    # 几何（比例取自 mascot.html，随 k 缩放）
    r_outer = 0.3335 * k          # lens-outer 半径
    r_mid = 0.2665 * k            # lens-middle 半径
    r_inner = 0.2165 * k          # lens-inner 半径（深色镜腔）
    r_mask = 0.25 * k             # eyelid-mask 半径
    eyelid_h = 0.083 * k          # 眼睑厚度（idle 态）
    r_pupil = 0.0665 * k          # lens-center 瞳孔半径
    r_blade_tip = 0.20 * k        # 光圈叶片外端（blade 高 0.2em）
    w_blade = 0.15 * k            # 光圈叶片宽（0.15em）
    r_screw = 0.06 * k            # 螺丝半径（0.12em）
    d_screw = 0.34 * k            # 螺丝到中心距离（body 1em 内 0.5±0.16）
    screws = [(0, -d_screw), (d_screw, 0), (0, d_screw), (-d_screw, 0)]  # 上右下左

    rows = []
    for y in range(n):
        py = (y + 0.5) / scale - 1.0
        row = bytearray()
        for x in range(n):
            px = (x + 0.5) / scale - 1.0

            # ---- 背景：品牌渐变圆角方块（favicon 模式跳过）----
            if with_bg:
                d_bg = sd_rounded_rect(px, py, 0.0, 0.0, half, radius)
                alpha = smoothstep(aa, -aa, d_bg)
                t_bg = clamp(((px + 1) + (py + 1)) / 4.0, 0.0, 1.0)  # 135° 渐变
                r, g, b = lerp3(BG_TOP, BG_BOTTOM, t_bg)
            else:
                alpha = 0.0
                t_bg = 0.0
                r = g = b = 0.0

            dx, dy = px, py
            dist = math.hypot(dx, dy)

            # ---- 四颗边缘螺丝（银色小球，上半亮下半暗）----
            for sx, sy in screws:
                ddx, ddy = px - sx, py - sy
                d = math.hypot(ddx, ddy)
                if d < r_screw + aa:
                    t_s = clamp(0.5 + (ddx + ddy) / (2.2 * r_screw), 0.0, 1.0)
                    sr, sg, sb = lerp3(SCREW_A, SCREW_B, t_s)
                    rim = smoothstep(r_screw * 0.55, r_screw, d) * 0.18
                    sr *= 1 - rim
                    sg *= 1 - rim
                    sb *= 1 - rim
                    cov = smoothstep(aa, -aa, d - r_screw)
                    r += (sr - r) * cov
                    g += (sg - g) * cov
                    b += (sb - b) * cov
                    alpha = max(alpha, cov)

            # ---- lens-outer：银色外环（CSS 145° 渐变）----
            if dist < r_outer + aa:
                t_o = clamp((G145[0] * dx + G145[1] * dy + r_outer) / (2 * r_outer), 0.0, 1.0)
                orr, og, ob = lerp3(OUTER_A, OUTER_B, t_o)
                cov = smoothstep(aa, -aa, dist - r_outer)
                r += (orr - r) * cov
                g += (og - g) * cov
                b += (ob - b) * cov
                alpha = max(alpha, cov)

            # ---- lens-middle：亮银内环（含内侧 inset 阴影）----
            if dist < r_mid + aa:
                t_m = clamp((G145[0] * dx + G145[1] * dy + r_mid) / (2 * r_mid), 0.0, 1.0)
                mr, mg, mb = lerp3(MID_A, MID_B, t_m)
                inset = smoothstep(r_mid - 0.35 * (r_mid - r_inner), r_mid, dist) * 0.10
                mr *= 1 - inset
                mg *= 1 - inset
                mb *= 1 - inset
                cov = smoothstep(aa, -aa, dist - r_mid)
                r += (mr - r) * cov
                g += (mg - g) * cov
                b += (mb - b) * cov

            # ---- lens-inner：深蓝镜腔 ----
            if dist < r_inner + aa:
                cov_inner = smoothstep(aa, -aa, dist - r_inner)
                t_l = clamp((dy + r_inner) / (2 * r_inner), 0.0, 1.0)  # 180° 渐变
                lr, lg, lb = lerp3(LENS_A, LENS_B, t_l)
                # 镜腔外缘 inset 阴影（lens-outer 的内阴影观感）
                rim_dark = smoothstep(r_inner - 0.014 * k / 0.95, r_inner, dist) * 0.35
                lr *= 1 - rim_dark
                lg *= 1 - rim_dark
                lb *= 1 - rim_dark

                # ---- 12 片蓝色光圈叶片（clip-path 轮廓精确复刻）----
                if dist > r_pupil * 0.6 and dist < r_blade_tip + blade_aa:
                    theta = math.atan2(dy, dx)
                    sector = 2 * math.pi / N_BLADES
                    k_bl = round(theta / sector)
                    # 转到叶片局部坐标（轴向 a=距中心距离，横向 o）
                    phi = theta - k_bl * sector
                    a_axial = dist * math.cos(phi)
                    o_lat = dist * math.sin(phi)
                    if 0 < a_axial <= r_blade_tip:
                        y_bl = 1.0 - a_axial / r_blade_tip  # 0=外端 1=根部
                        x_bl = 0.5 + o_lat / w_blade
                        lo = piecewise(BLADE_LEFT, y_bl)
                        hi = piecewise(BLADE_RIGHT, y_bl)
                        if lo < x_bl < hi:
                            # 叶片色：根部亮蓝 → 外端混 20% 黑
                            br, bg_, bb = lerp3(EYE, (0, 0, 0), 0.20 * y_bl)
                            # 瞳孔投影：靠瞳孔处压暗（lens-center 的黑 box-shadow）
                            shade = smoothstep(r_pupil * 1.45, r_pupil, dist) * 0.4
                            br *= 1 - shade
                            bg_ *= 1 - shade
                            bb *= 1 - shade
                            edge = min(x_bl - lo, hi - x_bl) * w_blade
                            cov_bl = smoothstep(0.0, blade_aa, edge)
                            lr += (br - lr) * cov_bl
                            lg += (bg_ - lg) * cov_bl
                            lb += (bb - lb) * cov_bl

                # ---- 瞳孔（lens-center，软边黑）----
                if dist < r_pupil + aa * 2:
                    cov_p = smoothstep(r_pupil, r_pupil - aa * 2, dist)
                    lr += (0 - lr) * cov_p
                    lg += (0 - lg) * cov_p
                    lb += (8 - lb) * cov_p

                # ---- 镜面高光（lens-reflection：-20° 斜向白痕，左上）----
                gx = dx - (-0.071 * k / 0.95)
                gy = dy - (-0.046 * k / 0.95)
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
            if dist < r_mask + aa:
                band_top = dy < -r_mask + eyelid_h
                band_bot = dy > r_mask - eyelid_h
                if band_top or band_bot:
                    t_e = clamp((dy + r_mask) / (2 * r_mask), 0.0, 1.0)
                    er, eg, eb = lerp3(EYELID_A, EYELID_B, t_e)
                    # 靠镜腔一侧压一条内阴影（eyelid 的 box-shadow）
                    edge_dist = (
                        (dy - (-r_mask + eyelid_h))
                        if band_top
                        else (r_mask - eyelid_h - dy)
                    )
                    shade = smoothstep(0.010 * k / 0.95, 0.0, abs(edge_dist)) * 0.14
                    er *= 1 - shade
                    eg *= 1 - shade
                    eb *= 1 - shade
                    cov_m = smoothstep(aa, -aa, dist - r_mask)
                    er, eg, eb = lerp3((r, g, b), (er, eg, eb), cov_m)
                    r, g, b = er, eg, eb

            row += bytes((int(clamp(r, 0, 255)), int(clamp(g, 0, 255)), int(clamp(b, 0, 255)), int(alpha * 255)))
        rows.append(bytes(row))

    # SS 盒式降采样 → size
    f = SS
    out_rows = []
    for y in range(size):
        line = bytearray()
        for x in range(size):
            for c in range(4):
                acc = 0
                for oy in range(f):
                    src = rows[y * f + oy]
                    for ox in range(f):
                        acc += src[4 * (x * f + ox) + c]
                line.append(acc // (f * f))
        out_rows.append(bytes(line))

    return png_bytes(size, size, b"".join(out_rows))


def png_bytes(w: int, h: int, raw: bytes) -> bytes:
    def chunk(tag: bytes, data: bytes) -> bytes:
        return (
            struct.pack(">I", len(data))
            + tag
            + data
            + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF)
        )

    ihdr = struct.pack(">IIBBBBB", w, h, 8, 6, 0, 0, 0)  # 8bit RGBA
    scan = b"".join(b"\x00" + raw[y * w * 4 : (y + 1) * w * 4] for y in range(h))
    return (
        b"\x89PNG\r\n\x1a\n"
        + chunk(b"IHDR", ihdr)
        + chunk(b"IDAT", zlib.compress(scan, 9))
        + chunk(b"IEND", b"")
    )


def write_ico(path: Path, images):
    """images: [(size, png_bytes)] → PNG-in-ICO 多尺寸图标"""
    header = struct.pack("<HHH", 0, 1, len(images))
    entries = b""
    offset = 6 + 16 * len(images)
    datas = b""
    for size, data in images:
        entries += struct.pack("<BBBBHHII", size % 256, size % 256, 0, 0, 1, 32, len(data), offset)
        datas += data
        offset += len(data)
    path.write_bytes(header + entries + datas)


def main():
    # 应用图标：品牌渐变打底，k=0.95（机器人含螺丝占画布 ~72%）
    icon = render_canvas(1024, 0.95, with_bg=True)
    ICON_OUT.parent.mkdir(parents=True, exist_ok=True)
    ICON_OUT.write_bytes(icon)
    print(f"icon written: {ICON_OUT}")

    # 站点 favicon：无底色透明版，机器人撑满画布（k=2.4），多尺寸 ICO
    images = [(s, render_canvas(s, 2.4, with_bg=False)) for s in (16, 32, 48, 64)]
    write_ico(FAVICON_OUT, images)
    print(f"favicon written: {FAVICON_OUT} (16/32/48/64)")


if __name__ == "__main__":
    sys.exit(main())
