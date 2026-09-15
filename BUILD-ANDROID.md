# 安卓 APK 构建说明

把 `stickers-maker` 的 Web 前端打包成可安装的 Android APK。

## 为什么不是 Electron

Electron 只有桌面运行时：它的产物是 Chromium + Node 的 Linux/macOS/Windows
可执行文件，没有 Android 版本，装不进 APK。

安卓端能做到同等效果的方案是 **Capacitor**：把同一份 Vite 产物放进系统 WebView，
再用原生插件补齐 WebView 缺少的能力（文件保存、分享、返回键）。
仓库里的 `android/` 就是这个壳。

| 桌面 Electron 做的事 | 这里的对应实现 |
| --- | --- |
| 打包 `index.html` + 静态资源 | `cap sync` 把 `dist/` 拷进 `android/app/src/main/assets/public` |
| 应用图标 / 启动图 | `android/app/src/main/res/mipmap-*`、`drawable*/splash.png` |
| 系统「另存为」 | `@capacitor/filesystem` + `@capacitor/share`（系统保存/分享面板） |
| 窗口/返回行为 | `AndroidManifest` + `@capacitor/app` 的 `backButton` 监听 |

## 产物

- **云端（推荐）**：`.github/workflows/build-apk.yml`
  - 触发：手动 `Actions → Build APK → Run workflow`，或推送到 `main`
  - 产物：**两个独立 artifact**（Actions 页面各一条，可分别下载）
    - `sekai-stickers-debug-<sha>` → `sekai-stickers-debug-<sha>.apk`
    - `sekai-stickers-release-<sha>` → `sekai-stickers-release-<sha>.apk`
  - workflow 内置校验：两个包必须同一签名，否则直接失败
  - 一次构建约 3 分钟（含 npm ci、Vite 构建、Gradle 打包两个变体）
- **本机**：需要 Android SDK（`ANDROID_HOME`）+ JDK 21

  ```bash
  npm ci --legacy-peer-deps
  npm run cap:sync          # vite build --mode android && cap sync android
  cd android && ./gradlew assembleDebug assembleRelease
  # 输出：android/app/build/outputs/apk/{debug/app-debug.apk,release/app-release.apk}
  ```

  一条命令等价写法：`npm run android:apk`

## 签名（固定 keystore，debug 与 release 共用）

签名不再随构建机变化，两个包可以互相覆盖安装/升级：

| 项 | 值 |
| --- | --- |
| keystore | PKCS12，别名 `sekai`，有效期 30 年 |
| 证书 | `CN=SEKAI Stickers, OU=25-ji-code-de, O=sekai-stickers-apk, L=Tokyo, C=JP` |
| 证书指纹 SHA-256 | `3CD5B57220AC1633848E4655BA702A124EBD07D86E89A1367738E8067FCF3799` |
| 签名方案 | v1 + v2 + v3 |

keystore **不入库**，通过仓库 Secrets 注入（Settings → Secrets and variables → Actions）：

| Secret | 含义 |
| --- | --- |
| `SEKAI_KEYSTORE_BASE64` | keystore 文件的 base64（`base64 -w0 sekai-release.jks`） |
| `SEKAI_KEYSTORE_PASSWORD` | keystore 口令 |
| `SEKAI_KEY_ALIAS` | key 别名（`sekai`） |
| `SEKAI_KEY_PASSWORD` | key 口令（PKCS12 下与 keystore 口令相同） |
| `SEKAI_KEYSTORE_FILENAME` | 落盘文件名，默认 `sekai-release.jks`（可选） |

本机开发想用同一套签名，就在 `android/keystore.properties` 里写：

```properties
storeFile=/absolute/path/sekai-release.jks
storePassword=***
keyAlias=sekai
keyPassword=***
```

> ⚠️ **这套 keystore 必须备份**（离线保存）。丢了就再也签不出能覆盖升级的包，
> 只能换包名重新发布。两个 APK 的 `applicationId` 相同，**不能同时安装**。

## 关键参数

| 项 | 值 | 位置 |
| --- | --- | --- |
| applicationId | `de.sekai.stickers` | `capacitor.config.json`（决定 `namespace` 与包名） |
| 应用名 | `SEKAI贴纸` | `android/app/src/main/res/values/strings.xml` |
| minSdk / targetSdk | 24 / 35 | `android/variables.gradle` |
| 竖屏锁定、键盘避让 | `screenOrientation="portrait"`、`windowSoftInputMode="adjustResize"` | `android/app/src/main/AndroidManifest.xml` |
| 相册目录 | `Pictures/SEKAI贴纸/` | `SaveToGalleryPlugin.ALBUM_DIR` |
| 存储权限 | `WRITE_EXTERNAL_STORAGE`（`maxSdkVersion=28`，仅旧系统需要） | `AndroidManifest.xml` |
| 签名 | 固定 keystore，debug/release 共用 | `android/app/build.gradle` + Secrets |

## 安卓端的必要改动

1. **导出直接进相册**（`src/utils/nativePlatform.ts` + `SaveToGalleryPlugin.java`）
   APK 的 WebView 里 `<a download>` / blob 链接不会真正保存文件。导出流程：

   | 系统 | 行为 | 权限 |
   | --- | --- | --- |
   | Android 10+（API 29） | `MediaStore` 写入 `Pictures/SEKAI贴纸/`，并标记 `IS_PENDING` 保证原子落盘 | **不需要**运行时权限，不弹框（分存储下 App 写自己的媒体即可） |
   | Android 9 及以下（API 24–28） | 先弹 `WRITE_EXTERNAL_STORAGE` 授权框 → 写公共 `Pictures/SEKAI贴纸/` → `MediaScannerConnection` 立即入相册 | 需要，由 Capacitor 权限流程申请 |
   | 权限被拒 / 插件异常 | 回退系统「保存/分享」面板（写应用缓存） | — |

   保存成功后提示「已保存到相册：Pictures/SEKAI贴纸/xxx.png」。
   浏览器构建完全不受影响（`isAndroidApp()` 为 false 时是 no-op）。
2. **返回键**（`src/main.tsx`）
   默认行为是直接退出 App，现在改成「有历史记录就返回上一页」，
   到根页面才退出。
3. **关掉 PWA Service Worker**（`vite.config.js` 的 `--mode android`）
   Capacitor 用本地 server 提供资源，Service Worker 拿不到 `sw.js`（会拿到
   `index.html`），PWA 的自动更新逻辑会反复失败重载，因此 Android 模式用 stub。
4. **不产出 sourcemap**：省掉约 5MB 包体。

## 生成物 vs 源文件

`android/` 目录本身是模板生成的，但已经提交进仓库，可以按普通源码修改。

| 路径 | 说明 |
| --- | --- |
| `android/app/src/main/assets/public/` | **生成物**，`cap sync` 覆盖，已 gitignore |
| `android/app/src/main/assets/capacitor.*.json` | **生成物**，已 gitignore |
| `android/capacitor-cordova-android-plugins/` | **生成物**，已 gitignore |
| `android/app/capacitor.build.gradle` | 插件变化时 `cap sync` 重写 |
| `android/app/src/main/res/mipmap-*`、`drawable*/splash.png` | 由 `scripts/generate-android-icons.mjs` 生成（已提交，避免 CI 依赖 Pillow） |

品牌图（`toy-icon.png`）改了之后重新生成图标：

```bash
node scripts/generate-android-icons.mjs   # 需要 python3 + Pillow
```

## 已知限制

- **登录（SEKAI Pass OAuth）在 APK 里走不通**：回调地址默认是
  `<origin>/callback`，在 APK 里是 `https://localhost/callback`，OAuth 服务端不会
  把 `localhost` 当合法跳转地址。要用起来需要给应用注册自定义 scheme
  （`AndroidManifest` 里已生成 `custom_url_scheme`），并把
  `VITE_OAUTH_REDIRECT_URI` 指过去。
- **debug 与 release 的差别**：两者同一签名、同一 `applicationId`，
  release 只是非 debuggable（体积略小，约 23.3MB vs 24.4MB），
  所以**不能同时装**；debug 包仅用于抓日志/DevTools 调试。
- **keystore 必须备份**：丢了就只能换包名重新发布（详见上面的签名章节）。
- 贴纸素材全部内置于 APK（约 14MB），首屏无需联网；画廊/登录等联网功能仍需要网络。
- 相册里同名文件由 MediaStore 自动加序号（`xxx (1).png`），不会覆盖已有图片。
- Android 9 及以下如果用户勾了「不再询问」并拒绝授权，导出会一直走分享面板回退路径，
  需要在系统设置里手动给应用开存储权限。
