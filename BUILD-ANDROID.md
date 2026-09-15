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

### 登录（SEKAI Pass OAuth）在 APK 里走不通

这不是壳里的代码 bug，而是**这个应用没在平台上登记过**。按触发顺序有四个断点：

1. **`client_id` 是空串** —— 最先炸的一步。`src/services/auth.service.ts:18` 读
   `import.meta.env.VITE_OAUTH_CLIENT_ID`，仓库里只有上游那份占位符 `.env.example`
   （`.env*` 被 gitignore），workflow 也不注入，所以产物里是 `clientId:""`，
   SDK 构造函数直接抛 `clientId is required`。真实值属于**部署配置**：谁部署网页版，
   谁在部署平台的环境变量里注入它，仓库里从来就没有。
2. **回调地址是 `https://localhost/callback`**。`capacitor.config.json` 里
   `server.androidScheme: "https"`，Capacitor 默认 hostname 是 `localhost`，
   所以 WebView 里 `window.location.origin` = `https://localhost`，
   `auth.service.ts:19` 的默认值就落成它。
3. **授权页其实开在系统浏览器里**。Capacitor 的 `Bridge.launchIntent()`
   （`@capacitor/android` 的 `com/getcapacitor/Bridge.java:393-431`）会把**任何非本
   应用 origin 的导航**用 `ACTION_VIEW` 丢给系统浏览器。于是回调落在 Chrome 里：
   它真去连本机 443；而 PKCE 的 `code_verifier` 按 SDK 约定存在 WebView 的
   sessionStorage 里，Chrome 那边没有，就算回调回来了也换不到 token。
4. **壳里没有深链入口**。`AndroidManifest.xml` 只有 MAIN/LAUNCHER；
   `strings.xml` 里那个 `custom_url_scheme=de.sekai.stickers` 是 Capacitor 模板
   生成的死字符串，没有任何 intent-filter 或 `appUrlOpen` 监听在用它。

> 两个常见的「绕过去」都不成立：
> - `https://localhost/callback` 在 SEKAI Pass 那边**能过格式校验**
>   （`sekai-pass/src/lib/applications.ts:76-111` 对 https 无条件放行；该服务端开源在
>   `25-ji-code-de/sekai-pass`），拦住它的是「没登记」+「外部浏览器打不开」，
>   让服务端把 localhost 加白也没用。
> - 把壳的 origin 改成真实域名（`server.hostname`）也绕不过去：回调是外部浏览器去
>   访问那个域名的**真实站点**，不是壳里的本地资源，PKCE verifier 同样对不上。

要让 APK 能登录，两边各做一半（**服务端代码不用改**）：

**平台侧 —— 只能人工做，代码里补不出来**

- 登录 <https://id.nightcord.de5.net>，仪表板页脚点「开放平台」，或直接开 `/apps`，
  自助创建应用：公共客户端、认证方式选 `none`（只有 `client_id`，靠 PKCE，不用 secret），
  回调地址填 `de.sekai.stickers://callback`。SEKAI Pass 明确放行「带点号的自定义
  scheme」（`applications.ts:105-108`），它要的正是原生 App 这种回调。
  一个应用最多挂 10 条回调地址，所以也能直接给网页版那个应用加一条、共用同一个
  `client_id`（前提是你有那个应用的所有权）。
- 把拿到的 `client_id` 注入构建（仓库变量 / 部署平台环境变量）。
  `client_id` 每次 authorize 都明文挂在 URL 上，本身不是秘密；公共客户端也没有
  `client_secret`，所以走这条路不引入任何密钥管理负担。
- 回调地址是**精确字符串比对**（`sekai-pass/src/index.ts:331-338`），
  注册什么就得用什么，`de.sekai.stickers://callback` 和
  `de.sekai.stickers:/callback` 是两条不同的记录。

**壳侧 —— 本仓要改的四件事**

1. `AndroidManifest.xml` 给 MainActivity 加 BROWSABLE intent-filter：
   `scheme=@string/custom_url_scheme`、`host=callback`（`singleTask` 已就位，
   深链会走 `onNewIntent`）；
2. 安卓构建把默认 `redirect_uri` 换成 `de.sekai.stickers://callback`
   （仍允许 `VITE_OAUTH_REDIRECT_URI` 覆盖）；
3. 用 `@capacitor/app` 的 `App.getLaunchUrl()`（冷启动）+ `appUrlOpen`（热启动）
   接住回调，再 `location.replace('/callback?' + query)` —— Capacitor 的 html5mode
   默认为 true（`@capacitor/android` 的 `WebViewLocalServer.java:425`），无扩展名的
   路径会回落 `index.html`，于是 `src/main.tsx:14` 的路由判定和现成的
   `AuthCallback` 组件原样复用，不用另写一套回调 UI；
4. 安卓下把 `code_verifier` / `state` 镜像进 localStorage（SDK 支持注入 storage），
   避免用户切到浏览器登录期间进程被杀、回来时 PKCE 对不上而白做一次。

### 其他限制

- **debug 与 release 的差别**：两者同一签名、同一 `applicationId`，
  release 只是非 debuggable（体积略小，约 23.3MB vs 24.4MB），
  所以**不能同时装**；debug 包仅用于抓日志/DevTools 调试。
- **keystore 必须备份**：丢了就只能换包名重新发布（详见上面的签名章节）。
- 贴纸素材全部内置于 APK（约 14MB），首屏无需联网；画廊/登录等联网功能仍需要网络。
- 相册里同名文件由 MediaStore 自动加序号（`xxx (1).png`），不会覆盖已有图片。
- Android 9 及以下如果用户勾了「不再询问」并拒绝授权，导出会一直走分享面板回退路径，
  需要在系统设置里手动给应用开存储权限。
