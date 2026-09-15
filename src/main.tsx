// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 The 25-ji-code-de Team

import React from 'react'
import ReactDOM from 'react-dom/client'
import './index.css'
import App from './App'
import AuthCallback from './components/auth/AuthCallback'

const rootElement = document.getElementById('root')
if (!rootElement) throw new Error('Failed to find the root element')

// Simple routing: check if we're on the OAuth callback path
const isCallbackRoute = window.location.pathname === '/callback'

/**
 * 安卓返回键：默认行为是直接退出 App，这里改成「有历史记录就返回上一页」，
 * 只有到根页面时才退出。仅在 APK（Capacitor）环境生效，浏览器里是 no-op。
 */
if ((window as unknown as Record<string, unknown>).__capacitorPlatform === 'android') {
  // 启动自检：确认相册保存通道与存储权限模型（API 29+ 零权限；
  // API 28 及以下才需要 WRITE_EXTERNAL_STORAGE，并在首次保存时弹授权框）。
  void import('./utils/nativePlatform')
    .then(({ initAndroidPlatform }) => initAndroidPlatform())
    .catch(() => {
      /* 非 APK 环境或插件缺失时忽略 */
    })

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
