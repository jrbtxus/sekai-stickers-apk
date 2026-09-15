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
 *   android/app/src/main/res/mipmap-xxxhdpi/ic_launcher-playstore.png
 *   android/app/src/main/res/drawable 与 drawable-port/land-<density>/splash.png
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

# 自适应图标前景：完整 108dp 画布缩放，中心 66dp 安全区内的贴纸图案不被裁切
def foreground(dp):
    return fit_contain(src, dp)

# 传统（Android 7 及以下 / 部分桌面）图标：品牌色底 + 贴纸图案
def legacy(dp):
    base = Image.new('RGBA', (dp, dp), BRAND + (255,))
    art = fit_contain(src, dp, pad_ratio=0.10)
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
playstore.alpha_composite(fit_contain(src, 512, pad_ratio=0.10))
playstore.convert('RGB').save(os.path.join(RES, 'mipmap-xxxhdpi/ic_launcher-playstore.png'))

# 启动图：Capacitor 模板用 drawable / drawable-port-* / drawable-land-*，
# 各种尺寸统一成同一张品牌色方图，交给 Android 的 centerCrop 拉伸。
SPLASH_SIZES = {
    'drawable': 480,
    'drawable-port-mdpi': 320, 'drawable-port-hdpi': 480,
    'drawable-port-xhdpi': 720, 'drawable-port-xxhdpi': 960,
    'drawable-port-xxxhdpi': 1280,
    'drawable-land-mdpi': 480, 'drawable-land-hdpi': 800,
    'drawable-land-xhdpi': 1280, 'drawable-land-xxhdpi': 1600,
    'drawable-land-xxxhdpi': 1920,
}
for folder, px in SPLASH_SIZES.items():
    d = os.path.join(RES, folder)
    os.makedirs(d, exist_ok=True)
    splash = Image.new('RGBA', (px, px), SPLASH_BG + (255,))
    splash.alpha_composite(fit_contain(src, px, pad_ratio=0.28))
    splash.convert('RGB').save(os.path.join(d, 'splash.png'))
print('splash: %d 个尺寸' % len(SPLASH_SIZES))
`;

execFileSync("python3", ["-c", script], { stdio: "inherit" });
