// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 The 25-ji-code-de Team

/**
 * 由仓库里已有的品牌图生成安卓图标 / 启动图。
 *
 *   node scripts/generate-android-icons.mjs
 *
 * 输出（全部是生成物，可直接覆盖，不要手改）：
 *   android/app/src/main/res/mipmap-<density>/ic_launcher.png
 *   android/app/src/main/res/mipmap-<density>/ic_launcher_round.png
 *   android/app/src/main/res/mipmap-<density>/ic_launcher_foreground.png
 *   android/app/src/main/res/mipmap-xxxhdpi/playstore_icon.png
 *   android/app/src/main/res/drawable-nodpi/splash_art.png（启动图主视觉）
 *
 * 依赖 python3 + Pillow（CI 里的 ubuntu runner 自带）。
 */

import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const RES = path.join(ROOT, "android/app/src/main/res");

const script = `
from PIL import Image, ImageDraw, ImageOps
import os

ROOT = ${JSON.stringify(ROOT)}
RES = ${JSON.stringify(RES)}

# 品牌色（取自 toy-icon.png 的粉色射线背景与站点主题色 theme_color #e4c2c8）
BRAND = (0xFA, 0x6B, 0xA3)      # 图标背景
SPLASH_BG = (0xE4, 0xC2, 0xC8)  # 启动图背景，与 PWA theme_color 一致

src = Image.open(os.path.join(ROOT, 'toy-icon.png')).convert('RGBA')

DENSITIES = {
    'mdpi': 1.0,
    'hdpi': 1.5,
    'xhdpi': 2.0,
    'xxhdpi': 3.0,
    'xxxhdpi': 4.0,
}

def fit_contain(img, size, pad_ratio=0.0):
    """等比缩放到不超过 size，可选留白，返回居中绘制好的 RGBA 图。"""
    target = int(size * (1.0 - 2 * pad_ratio))
    scale = min(target / img.width, target / img.height)
    new = img.resize((max(1, round(img.width * scale)), max(1, round(img.height * scale))), Image.LANCZOS)
    canvas = Image.new('RGBA', (size, size), (0, 0, 0, 0))
    canvas.alpha_composite(new, ((size - new.width) // 2, (size - new.height) // 2))
    return canvas

# 图标统一使用「贴纸主视觉」——即从品牌图裁出的方形图案（与启动图同一套裁剪）。
# 直接缩整张图的话，顶部大标题在 48px 的图标里会糊成一团蓝色斑块，什么也看不清。
w0, h0 = src.size
ART_CROP = (0.30, 0.30, 0.78, 0.78)  # left, top, right, bottom（比例）
art_src = src.crop(
    (
        int(w0 * ART_CROP[0]),
        int(h0 * ART_CROP[1]),
        int(w0 * ART_CROP[2]),
        int(h0 * ART_CROP[3]),
    )
)

# 自适应图标前景：108dp 画布，图形限制在中心 66dp 安全区内
def foreground(dp):
    return fit_contain(art_src, dp, pad_ratio=0.20)

# 传统（Android 7 及以下 / 部分桌面）图标：品牌色底 + 贴纸图案
def legacy(dp):
    base = Image.new('RGBA', (dp, dp), BRAND + (255,))
    art = fit_contain(art_src, dp, pad_ratio=0.06)
    base.alpha_composite(art)
    return base

def round_icon(dp):
    icon = legacy(dp)
    mask = Image.new('L', (dp * 4, dp * 4), 0)
    ImageDraw.Draw(mask).ellipse((0, 0, dp * 4 - 1, dp * 4 - 1), fill=255)
    mask = mask.resize((dp, dp), Image.LANCZOS)
    out = Image.new('RGBA', (dp, dp), (0, 0, 0, 0))
    out.paste(icon, (0, 0), mask)
    return out

for name, scale in DENSITIES.items():
    d = os.path.join(RES, 'mipmap-' + name)
    os.makedirs(d, exist_ok=True)
    dp48 = round(48 * scale)   # 传统图标 48dp
    dp108 = round(108 * scale) # 自适应图标 108dp
    legacy(dp48).save(os.path.join(d, 'ic_launcher.png'))
    round_icon(dp48).save(os.path.join(d, 'ic_launcher_round.png'))
    foreground(dp108).save(os.path.join(d, 'ic_launcher_foreground.png'))
    print('mipmap-%-8s legacy=%dpx adaptive=%dpx' % (name, dp48, dp108))

# Play 商店用 512x512 图标
playstore = Image.new('RGBA', (512, 512), BRAND + (255,))
playstore.alpha_composite(fit_contain(art_src, 512, pad_ratio=0.06))
playstore.convert('RGB').save(os.path.join(RES, 'mipmap-xxxhdpi/playstore_icon.png'))

# 启动图主视觉：从品牌图裁出「贴纸主体」（避开顶部文字带），保持方形不变形。
# 注意：Capacitor 不调用 installSplashScreen()，Theme.SplashScreen 的
# windowSplashScreenAnimatedIcon 不会生效；实际显示的是 windowBackground。
# 所以这里只生成一张居中显示的图片资源，背景交给层列表 drawable/splash.xml 的纯色。
splash_art = art_src.resize((512, 512), Image.LANCZOS)
nodpi = os.path.join(RES, 'drawable-nodpi')
os.makedirs(nodpi, exist_ok=True)
splash_art.save(os.path.join(nodpi, 'splash_art.png'))
print('drawable-nodpi/splash_art.png 512x512（贴纸主视觉）')

# 启动背景：径向渐变（中心亮粉 → 边缘品牌浅粉），与图内射线气质一致且无硬边界。
GRAD_SIZE = 512
grad = Image.new('RGB', (GRAD_SIZE, GRAD_SIZE), SPLASH_BG)
gd = ImageDraw.Draw(grad)
maxr = (2 ** 0.5) * GRAD_SIZE / 2
steps = 180
for i in range(steps, 0, -1):
    t = i / steps
    r = maxr * t
    col = tuple(round(BRAND[j] + (SPLASH_BG[j] - BRAND[j]) * t) for j in range(3))
    gd.ellipse(
        (GRAD_SIZE / 2 - r, GRAD_SIZE / 2 - r, GRAD_SIZE / 2 + r, GRAD_SIZE / 2 + r),
        fill=col,
    )
grad.save(os.path.join(nodpi, 'splash_gradient.png'))
print('drawable-nodpi/splash_gradient.png %dpx（径向渐变背景）' % GRAD_SIZE)

# 清掉旧方案留下的整屏方图（会导致不同屏幕比例下被裁切/过小）
STALE_SPLASH_DIRS = [
    'drawable',
    'drawable-port-mdpi', 'drawable-port-hdpi', 'drawable-port-xhdpi',
    'drawable-port-xxhdpi', 'drawable-port-xxxhdpi',
    'drawable-land-mdpi', 'drawable-land-hdpi', 'drawable-land-xhdpi',
    'drawable-land-xxhdpi', 'drawable-land-xxxhdpi',
]
removed = 0
for folder in STALE_SPLASH_DIRS:
    stale = os.path.join(RES, folder, 'splash.png')
    if os.path.exists(stale):
        os.remove(stale)
        removed += 1
print('清理旧 splash.png: %d 个' % removed)
`;

execFileSync("python3", ["-c", script], { stdio: "inherit" });
