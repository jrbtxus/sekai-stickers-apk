// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 The 25-ji-code-de Team

/**
 * Android (Capacitor) 平台能力封装。
 *
 * 打包成 APK 后导出图片有两条路：
 *   1. 首选 `SaveToGallery` 原生插件（`android/.../SaveToGalleryPlugin.java`）：
 *      直接写进系统相册 `Pictures/SEKAI贴纸/`。
 *      Android 10+ 写自己的媒体属于分存储，不需要任何运行时权限；
 *      Android 9 及以下由插件走 Capacitor 权限流程弹 WRITE_EXTERNAL_STORAGE 授权框。
 *   2. 插件不可用 / 权限被拒时回退系统分享面板（写应用缓存再分享）。
 *
 * 浏览器环境（web 部署 / 开发）完全不受影响：
 * `isAndroidApp()` 为 false 时所有函数都是 no-op。
 */

const CAPACITOR_GLOBAL = '__capacitorPlatform'

type CapacitorWindow = typeof window & Record<string, unknown>

/** True only inside the packaged Android app (Capacitor bridge present). */
export function isAndroidApp(): boolean {
  if (typeof window === 'undefined') return false
  return (window as CapacitorWindow)[CAPACITOR_GLOBAL] === 'android'
}

/** data:image/png;base64,xxx → 纯 base64。 */
function stripDataUrlPrefix(dataUrl: string): string {
  const comma = dataUrl.indexOf(',')
  return comma === -1 ? dataUrl : dataUrl.slice(comma + 1)
}

/**
 * 最近一次安卓端导出的结果说明，给「下载成功」提示用。
 * 成功写进相册时是「已保存到相册（Pictures/SEKAI贴纸）」，
 * 回退分享面板时是 undefined（沿用默认文案）。
 */
export let lastAndroidSaveHint: string | undefined

/**
 * APK 里保存图片：
 *   1. 先试原生 SaveToGallery 插件 → 直接落进 Pictures/SEKAI贴纸；
 *      （Android 9 及以下这一步会弹存储权限授权框，拒绝则走第 2 步）
 *   2. 失败再回退系统分享面板。
 *
 * 返回 false 表示当前不是 APK 环境 —— 调用方应回退到浏览器下载。
 */
export async function saveImageViaAndroid(
  dataUrl: string,
  filename: string,
): Promise<boolean> {
  if (!isAndroidApp()) return false
  lastAndroidSaveHint = undefined

  try {
    const { SaveToGallery } = await import('./saveToGallery')
    const result = await SaveToGallery.saveImage({
      base64: stripDataUrlPrefix(dataUrl),
      filename,
    })
    lastAndroidSaveHint = `已保存到相册：${result.location}`
    return true
  } catch {
    // 插件缺失或权限被拒 —— 回退分享面板，用户仍可手动「保存到相册」
  }

  try {
    const [{ Filesystem, Directory }, { Share }] = await Promise.all([
      import('@capacitor/filesystem'),
      import('@capacitor/share'),
    ])

    const { uri } = await Filesystem.writeFile({
      path: filename,
      data: stripDataUrlPrefix(dataUrl),
      directory: Directory.Cache,
    })

    // 注：ShareOptions 没有 mimeType 字段，Android 侧按文件名后缀推断，
    // 因此扩展名必须保留（png / jpg / webp）。
    await Share.share({
      title: filename,
      url: uri,
      dialogTitle: '保存或分享贴纸',
    })
    return true
  } catch {
    return true
  }
}
