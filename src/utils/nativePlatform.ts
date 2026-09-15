// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 The 25-ji-code-de Team

/**
 * Android (Capacitor) 平台能力封装。
 *
 * APK 里导出图片的通道（按优先级）：
 *   1. 原生插件 `SaveToGallery`（`android/.../SaveToGalleryPlugin.java`）
 *      → 直接写进系统相册 `Pictures/SEKAI贴纸/`，并在原生侧**回读 MediaStore 校验**；
 *      Android 10+ 写自己的媒体属于分区存储，**不需要任何运行时权限**；
 *      Android 9 及以下由插件走 Capacitor 权限流程弹 WRITE_EXTERNAL_STORAGE 授权框。
 *   2. 插件不可用 / 失败 → 系统分享面板（写应用缓存再分享，用户仍可手动保存）。
 *
 * 浏览器环境（web 部署 / 开发）完全不受影响：
 * `isAndroidApp()` 为 false 时所有函数都是 no-op。
 */
import type { SaveToGalleryProbeResult } from './saveToGallery'

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

export type AndroidSaveOutcome =
  /** 已写进系统相册（含回读校验结果） */
  | { status: 'saved'; location: string; uri: string; verified: boolean; via: string }
  /** 回退到系统分享面板 */
  | { status: 'shared'; location?: undefined; uri?: undefined; verified?: false; via?: string }
  /** 两条路都失败 */
  | {
      status: 'failed'
      error: string
      location?: undefined
      uri?: undefined
      verified?: false
      via?: string
    }

/** 最近一次安卓端保存结果，供「保存成功」提示里的「查看」按钮使用。 */
export let lastAndroidSaveResult:
  | { uri: string; message: string; canOpen: boolean }
  | undefined

/** 启动时做一次环境自检的结果（首次调用前为 undefined）。 */
export let androidGalleryProbe: SaveToGalleryProbeResult | undefined

/**
 * 启动自检：确认本设备到底需不需要存储权限、插件是否就绪。
 * API 29+ 一定是「零权限」路径——这也是为什么系统管家里看不到任何存储权限条目。
 */
export async function initAndroidPlatform(): Promise<SaveToGalleryProbeResult | undefined> {
  if (!isAndroidApp()) return undefined
  try {
    const { SaveToGallery } = await import('./saveToGallery')
    const probe = await SaveToGallery.probe()
    androidGalleryProbe = probe
    return probe
  } catch {
    return undefined
  }
}

/**
 * APK 里保存图片。返回结构化结果，调用方据此给出准确提示
 * （不再出现「提示保存成功但相册里其实没有」的情况）。
 */
export async function saveImageViaAndroid(
  dataUrl: string,
  filename: string,
): Promise<AndroidSaveOutcome> {
  lastAndroidSaveResult = undefined
  const base64 = stripDataUrlPrefix(dataUrl)

  // 1) 原生相册通道
  try {
    const { SaveToGallery } = await import('./saveToGallery')
    const result = await SaveToGallery.saveImage({ base64, filename })
    if (result && result.ok !== false && result.uri) {
      const location = result.location ?? `Pictures/SEKAI贴纸/${filename}`
      lastAndroidSaveResult = {
        uri: result.uri,
        message: `已保存到相册：${location}`,
        canOpen: true,
      }
      return {
        status: 'saved',
        location,
        uri: result.uri,
        verified: result.verified === true,
        via: result.via ?? 'MediaStore',
      }
    }
    // 原生侧显式失败：把真实原因带出去，而不是静默换通道
    const reason = result?.error ?? '原生保存未返回结果'
    return await shareViaAndroid(base64, filename, reason)
  } catch (e) {
    const reason = e instanceof Error ? e.message : String(e)
    return await shareViaAndroid(base64, filename, reason)
  }
}

/** 回退：写应用缓存 + 系统分享面板（用户仍可手动存到相册/文件）。 */
async function shareViaAndroid(
  base64: string,
  filename: string,
  upstreamError: string,
): Promise<AndroidSaveOutcome> {
  try {
    const [{ Filesystem, Directory }, { Share }] = await Promise.all([
      import('@capacitor/filesystem'),
      import('@capacitor/share'),
    ])
    const { uri } = await Filesystem.writeFile({
      path: filename,
      data: base64,
      directory: Directory.Cache,
    })
    // 注：ShareOptions 没有 mimeType 字段，Android 侧按文件名后缀推断，
    // 因此扩展名必须保留（png / jpg / webp）。
    await Share.share({
      title: filename,
      url: uri,
      dialogTitle: '保存或分享贴纸',
    })
    return { status: 'shared', via: `share（相册通道失败：${upstreamError}）` }
  } catch (e) {
    const shareError = e instanceof Error ? e.message : String(e)
    return {
      status: 'failed',
      error: `相册保存失败（${upstreamError}）；分享面板也失败（${shareError}）`,
    }
  }
}

/** 用系统看图应用打开刚保存的图片，用来确认它真的在相册里。 */
export async function openSavedImageInAndroid(uri: string): Promise<boolean> {
  if (!isAndroidApp()) return false
  try {
    const { SaveToGallery } = await import('./saveToGallery')
    const res = await SaveToGallery.openImage({ uri })
    return res?.opened === true
  } catch {
    return false
  }
}
