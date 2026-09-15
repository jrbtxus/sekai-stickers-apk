// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 The 25-ji-code-de Team

/**
 * 自定义原生插件 SaveToGallery 的 Web 侧定义。
 * 原生实现：android/app/src/main/java/de/sekai/stickers/SaveToGalleryPlugin.java
 */
import { registerPlugin } from '@capacitor/core'

export interface SaveToGalleryResult {
  /** 写入后的 content:// 或 file:// URI */
  uri: string
  /** 可展示的落盘位置，如 Pictures/SEKAI贴纸/xxx.png */
  location: string
  filename: string
}

interface SaveToGalleryPlugin {
  /**
   * 把 base64 图片写进系统相册。
   * Android 10+ 无需运行时权限；Android 9 及以下会先弹存储权限授权框，
   * 用户拒绝时 Promise reject。
   */
  saveImage(options: { base64: string; filename: string }): Promise<SaveToGalleryResult>
}

export const SaveToGallery = registerPlugin<SaveToGalleryPlugin>('SaveToGallery')
