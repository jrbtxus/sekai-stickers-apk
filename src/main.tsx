// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 The 25-ji-code-de Team

import React from 'react'
import ReactDOM from 'react-dom/client'
import './index.css'
import App from './App'
import AuthCallback from './components/auth/AuthCallback'
import { initAndroidPlatform, isAndroidApp } from './utils/nativePlatform'

const rootElement = document.getElementById('root')
if (!rootElement) throw new Error('Failed to find the root element')

// Simple routing: check if we're on the OAuth callback path
const isCallbackRoute = window.location.pathname === '/callback'

/**
 * 安卓壳专属初始化：仅 APK（Capacitor 桥存在）时执行，浏览器里是 no-op。
 * 判定方式与 Capacitor core 一致（window.androidBridge），见 nativePlatform.ts。
 */
if (isAndroidApp()) {
  // 启动自检：确认相册保存通道与存储权限模型（API 29+ 零权限；
  // API 28 及以下才需要 WRITE_EXTERNAL_STORAGE，并在首次保存时弹授权框）。
  void initAndroidPlatform()

  void import('@capacitor/app')
    .then(({ App: CapacitorApp }) => {
      void CapacitorApp.addListener('backButton', ({ canGoBack }) => {
        if (canGoBack || window.history.length > 1) {
          window.history.back()
        } else {
          void CapacitorApp.exitApp()
        }
      })
    })
    .catch(() => {
      /* 插件缺失时忽略，保持默认返回行为 */
    })
}

ReactDOM.createRoot(rootElement).render(
  <React.StrictMode>
    {isCallbackRoute ? <AuthCallback /> : <App />}
  </React.StrictMode>,
)
