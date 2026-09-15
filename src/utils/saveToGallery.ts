// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 The 25-ji-code-de Team

/**
 * 自定义原生插件 SaveToGallery 的 Web 侧定义。
 * 原生实现：android/app/src/main/java/de/sekai/stickers/SaveToGalleryPlugin.java
 */
import { registerPlugin } from '@capacitor/core'

export interface SaveToGalleryResult {
  /** 原生侧显式失败时为 false；成功时不带该字段 */
  ok?: boolean
  code?: string
  error?: string
  /** 写入后的 content:// 或 file:// URI */
  uri?: string
  /** 可展示的落盘位置，如 Pictures/SEKAI贴纸/xxx.png */
  location?: string
  filename?: string
  /** 回读 MediaStore 校验是否通过 */
  verified?: boolean
  /** 实际走的写入通道：MediaStore / legacyExternalStorage */
  via?: string
  /** 写入字节数 */
  bytes?: number
  sdkInt?: number
  /** 应用专属兜底副本的绝对路径（不在相册，仅用于确认图片确实生成） */
  appCopyPath?: string
}

export interface SaveToGalleryProbeResult {
  sdkInt: number
  /** API 28 及以下为 true：需要 WRITE_EXTERNAL_STORAGE */
  needsStoragePermission: boolean
  /** granted / denied / prompt / prompt-with-rationale */
  permissionState: string
  /** 相册目标目录 */
  albumDir: string
  /** true = 本设备零权限即可写入相册 */
  canWriteSilently: boolean
}

interface SaveToGalleryPluginApi {
  saveImage(options: { base64: string; filename: string }): Promise<SaveToGalleryResult>
  probe(): Promise<SaveToGalleryProbeResult>
  openImage(options: { uri: string }): Promise<{ opened: boolean }>
}

export const SaveToGallery = registerPlugin<SaveToGalleryPluginApi>('SaveToGallery')
