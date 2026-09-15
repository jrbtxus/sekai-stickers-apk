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
>
> 🔐 私钥相关的完整说明（存放位置、访问控制、威胁模型、轮换 runbook、离线恢复）
> 不随仓库分发，保存在维护者本机（`sekai-signing-security.md`）。
> 需要时向维护者索取；⚠️ 该文档含恢复材料，**不要复制进仓库或公开渠道**。

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
   | Android 10+（API 29 及以上，含 14/15/16） | `MediaStore` 写入 `Pictures/SEKAI贴纸/`，标记 `IS_PENDING` 保证原子落盘，写完**回读 SIZE 校验** | **不需要**运行时权限，不弹框 |
   | Android 9 及以下（API 24–28） | 先弹 `WRITE_EXTERNAL_STORAGE` 授权框 → 写公共 `Pictures/SEKAI贴纸/` → `MediaScannerConnection` 立即入相册 | 需要，由 Capacitor 权限流程申请 |
   | 原生通道失败 / 权限被拒 | 回退系统「保存/分享」面板（写应用缓存），提示里会带上失败原因 | — |

   **关于「系统管家里找不到存储权限」**：这是**正常现象**，不是配置漏了。
   Android 10 起写自己的媒体到 `Pictures` 属于分区存储允许的操作，不需要任何运行时权限；
   清单里那条 `WRITE_EXTERNAL_STORAGE` 带 `android:maxSdkVersion="28"`，
   在 Android 10+ 的设备上**根本不会被安装**，所以设置/系统管家里没有可授予的条目。

   **启动检查**：App 启动时会调用插件的 `probe()`，拿到 `sdkInt`、
   `needsStoragePermission`、`permissionState`、目标目录（`Pictures/SEKAI贴纸`），
   用来确认本机走的是「零权限」路径还是「需要授权」路径。

   **保存后校验与查看**：写入后原生侧按 URI 回读 `MediaStore` 的 `SIZE`，
   与实际字节数不符会**显式报错**（不再出现「提示保存成功但相册里没有」）。
   成功时提示会显示真实路径，并提供「查看」按钮，调用系统看图应用打开刚保存的那张图。
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

这不是壳里的代码 bug，而是**这个应用没在平台上登记过**，外加授权页被 Capacitor 推出了
WebView。按触发顺序有三个断点：

1. **`client_id` 是空串** —— 最先炸的一步。`src/services/auth.service.ts:18` 读
   `import.meta.env.VITE_OAUTH_CLIENT_ID`，仓库里只有上游那份占位符 `.env.example`
   （`.env*` 被 gitignore），workflow 默认也不注入，所以产物里是 `clientId:""`，
   SDK 构造函数直接抛 `clientId is required`。真实值属于**部署配置**：谁部署，谁注入，
   仓库里从来就没有。
2. **授权页被丢给了系统浏览器**。Capacitor 的 `Bridge.launchIntent()`
   （`@capacitor/android` 的 `com/getcapacitor/Bridge.java:393-431`）会把**任何非本应用
   origin、又不在 `server.allowNavigation` 白名单里的导航**用 `ACTION_VIEW` 交给系统
   浏览器。而 PKCE 的 `code_verifier` 按 SDK 约定存在 WebView 的 sessionStorage 里 ——
   两边不是一个地方，回调回来了也换不到 token。
3. **回调地址没登记**。WebView 里 origin 是 `https://localhost`（`server.androidScheme:
   "https"` + Capacitor 默认 hostname），所以默认回调就是 `https://localhost/callback`；
   它没在应用上登记过，authorize 直接 400。

**修法：回调形式和网页版保持一致，不引自定义 scheme**

网页版用的就是 `${window.location.origin}/callback`，在 APK 里这个 origin 是
`https://localhost`。所以不用 intent-filter、不用 `appUrlOpen`、也不用改
`auth.service.ts`（`auth.service.ts:19` 的默认值本来就是这个式子），只要两件事：

**平台侧 —— 人工做，代码里补不出来**

- 在 <https://id.nightcord.de5.net/apps> 自助建应用：公共客户端、认证方式 `none`
  （只有 `client_id`，靠 PKCE，不用 secret），回调地址填 **`https://localhost/callback`**。
  SEKAI Pass 对 `https` 是无条件放行的（`sekai-pass/src/lib/applications.ts:76-97`，
  loopback `http` 也放行），而 authorize 时是**精确字符串比对**
  （`src/index.ts:331-338`），登记的字符串必须和 APK 实际用的一字不差。
  一个应用最多挂 10 条回调，可以顺带把网页版域名和本地开发的
  `http://localhost:9000/callback` 一起挂上。
- 把 `client_id` 交给构建：仓库 Settings → Secrets and variables → Actions →
  **Variables** 里加 `SEKAI_OAUTH_CLIENT_ID`，workflow 会注入成
  `VITE_OAUTH_CLIENT_ID`。它每次 authorize 都明文挂在 URL 上，不是秘密；
  公共客户端也没有 `client_secret`，所以不引入密钥管理负担。

**壳侧 —— 一行配置**

- `capacitor.config.json` 的 `server.allowNavigation` 加上 `id.nightcord.de5.net`：
  授权页留在 WebView 里；登录完成后服务端 302 回 `https://localhost/callback`，
  它的 host/scheme 与本应用 origin 完全一致，Capacitor 不会交给外部浏览器，而是交给
  本地 server；`html5mode` 默认为 true（`WebViewLocalServer.java:425`），无扩展名的
  `/callback` 回落 `index.html`，于是 `src/main.tsx:14` 的路由判定和现成的
  `AuthCallback` 组件原样复用，sessionStorage 里的 `code_verifier` 也还在。

**实测时先盯这两点**

- 授权页要在系统 WebView 里过 Cloudflare 与登录用的 Turnstile（服务端对非浏览器
  客户端会回 cf 挑战）。过不去的话这条路就没法用。
- 第三方登录（GitHub / Google / 微软 / X）会跳出 `id.nightcord.de5.net`，那些 host
  不在白名单里，Capacitor 会把它们交给系统浏览器；而浏览器最后够不到
  `https://localhost/callback`，所以**内置账号密码之外的第三方登录是断的**。
  要么把对应 host 也加进 `allowNavigation`，要么走下面的退路。

**退路：自定义 scheme**

`de.sekai.stickers://callback` 也在 SEKAI Pass 的放行范围内（带点号的自定义 scheme，
`applications.ts:105-108`），而且全程跑在系统浏览器里 —— Cloudflare 和第三方登录都
没有上面的问题。代价是改三处代码：`AndroidManifest.xml` 加 BROWSABLE intent-filter
（`scheme=@string/custom_url_scheme`、`host=callback`）、安卓下把默认 `redirect_uri`
换成这个 scheme、用 `@capacitor/app` 的 `App.getLaunchUrl()`（冷启动）+ `appUrlOpen`
（热启动）接住回调后 `location.replace('/callback?' + query)`；同时去掉
`allowNavigation`，让授权页回到系统浏览器。

### 其他限制

- **debug 与 release 的差别**：两者同一签名、同一 `applicationId`，
  release 只是非 debuggable（体积略小，约 23.3MB vs 24.4MB），
  所以**不能同时装**；debug 包仅用于抓日志/DevTools 调试。
- **keystore 必须备份**：丢了就只能换包名重新发布（详见上面的签名章节）。
- 贴纸素材全部内置于 APK（约 14MB），首屏无需联网；画廊/登录等联网功能仍需要网络。
- 相册里同名文件由 MediaStore 自动加序号（`xxx (1).png`），不会覆盖已有图片。
- Android 9 及以下如果用户勾了「不再询问」并拒绝授权，导出会一直走分享面板回退路径，
  需要在系统设置里手动给应用开存储权限。

## 排障：提示保存成功但相册里找不到

按顺序排查（每一步都能用 App 自身的提示验证）：

1. **看提示里的路径**：成功时会显示 `已保存到相册：Pictures/SEKAI贴纸/<文件名>`。
   若提示是「下载成功！」而不是这条，说明**走的是分享面板回退路径**（原生通道失败了），
   提示里会带失败原因。
2. **点提示里的「查看」**：会用系统看图应用直接打开刚保存的那张图。能打开就说明文件确实存在，
   只是相册 App 的索引/过滤没显示。
3. **用文件管理器直接看**：内置存储 → `Pictures/SEKAI贴纸/`。
   （应用专属目录 `Android/data/de.sekai.stickers/files/Pictures/exports/` 里也留了一份兜底副本，
   仅用于确认图片确实生成，不会出现在相册里。）
4. **相册 App 的过滤规则**：部分 ROM 的相册默认只显示 `DCIM/Camera` 等目录，
   或需要手动「扫描/刷新」；第三方相册（如 Google 相册）还会按文件夹隐藏。
   这种情况换一个文件管理器/相册确认即可，文件本身是存在的。
5. **确认真是原生写入失败**：此时提示会带 `code` 与异常类型（例如
   `SAVE_FAILED: IOException: 回读校验不一致…`），把这句话发出来就能直接定位。
