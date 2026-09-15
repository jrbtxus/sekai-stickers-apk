// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 The 25-ji-code-de Team

/**
 * Android (Capacitor) 平台能力封装。
 *
 * 打包成 APK 后，WebView 里的 `<a download>` 不会真正保存文件，
 * 因此导出流程改走「写入应用缓存 + 系统分享/保存面板」：
 * 用户可以在面板里选择「保存到相册 / 文件」，或直接分享到其它 App。
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
 * 把导出的图片交给 Android 系统处理（分享面板 = 保存/分享到相册、其它 App）。
 * 返回 false 表示当前不是 APK 环境、或写入/分享失败 —— 调用方应回退到浏览器下载。
 */
export async function saveImageViaAndroid(
  dataUrl: string,
  filename: string,
): Promise<boolean> {
  if (!isAndroidApp()) return false
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
    return false
  }
}
