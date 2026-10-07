# AgehaOS 技术架构

> 基线：[PRD.md](PRD.md)（§18 总体架构、§19 前端方向、§49 技术栈）· 系统架构图：[assets/system-architecture.png](assets/system-architecture.png)

## 1. 总体分层

```text
┌─────────────────────────────────────────────┐
│                浏览器（终端）                 │
├─────────────────────────────────────────────┤
│  应用层        应用管理 / 运行时 / Manifest   │
│  桌面环境层    桌面壁纸 / 任务栏 / 窗口管理器  │
│  文件系统层    VFS / 存储管理 / 数据同步       │
│  用户与权限层  用户体系 / RBAC / 安全机制      │
├─────────────────────────────────────────────┤
│  后端服务层（规划）  核心服务 / API 网关 / 事件 │
│  基础设施层（规划）  Docker / DB / 监控 / CI  │
└─────────────────────────────────────────────┘
```

## 2. 代码分层与依赖规则

| 目录                        | 职责                                                   | 允许依赖                                       |
| --------------------------- | ------------------------------------------------------ | ---------------------------------------------- |
| `src/core/`                 | OS Core Runtime（窗口、运行时、VFS、权限、事件、i18n） | 仅纯 TS / 浏览器 API，**禁止依赖 React 与 UI** |
| `src/core/eclosion/`        | 羽化模式纯逻辑：L1 规格表与分域判定、SSE 帧解析、流式 HTML 切分、宿主↔runner postMessage 协议（含 SDK 能力声明推导）、今日世界公开载荷同构校验（AI-GENERATED-APPS-DESIGN §3.1） | 仅纯 TS（`core` 内，无 React） |
| `src/store/`                | Zustand 全局状态，桥接 core 与 UI                      | `core`                                         |
| `src/desktop/`、`src/apps/` | 桌面 UI 与系统应用                                     | `store`、`core`、`components`                  |
| `src/sdk/`                  | 面向第三方 App 的稳定 API（`AgehaOS.*`）               | `core`（只经权限校验的能力封装）               |
| `src/components/`           | 通用 UI 组件                                           | 仅 UI 库                                       |
| `src/services/`             | 平台服务封装（日志、上报、装配单例）                   | `core`、`store`（既有先例：dynamic-desktop / file-sync / notification-bridge / eclosion） |
| `server/`                   | 后端认证服务（Fastify，Milestone 5）                    | 独立 tsconfig，不依赖 `src/`                   |

依赖方向只能自上而下（UI → store → core），不允许反向引用。`core` 保持框架无关，便于未来抽取为独立 package（monorepo 化预留）。

## 3. 已落地的核心模块

### 3.1 事件总线（`src/core/events`，PRD §22）

- `EventBus<M>`：泛型类型化发布/订阅，`on / once / off / emit / listenerCount`。
- `SystemEventMap`：系统级事件契约（`window.*`、`app.*`、`file.*`、`user.*`、`permission.*`），新增系统事件必须先扩展该映射并补测试。
- `systemBus`：进程级单例。
- **故障隔离**：单个 handler 抛错不影响其他 handler（PRD §25 崩溃隔离原则），错误经 `setErrorHandler` 上报。

### 3.2 国际化（`src/core/i18n`，PRD §41）

- 词典 `zh-CN` / `en`，类型层面强制两语言键位对齐（`Dictionary = Record<MessageKey, string>`）。
- `translate(locale, key)` 纯函数 + `useTranslation()` React 绑定。
- **所有 UI 文案必须走 i18n，禁止硬编码字符串**。

### 3.3 启动流程（`src/store/boot-store` + `src/desktop/boot`，PRD §23.1）

- 状态机：`booting → loading → ready`，后续在此挂接 Runtime 初始化、Session 检测、桌面状态恢复。

### 3.4 窗口管理器（`src/core/window` + `src/store/window-store` + `src/desktop/window`，PRD §7）

- `WindowManager`（`core`，框架无关）：窗口生命周期 `normal / minimized / maximized`、焦点互斥、z 序递增栈、层叠默认定位、几何约束（移动保持 ≥80px 可见边、缩放遵守 `minWidth/minHeight` 并受视口上限约束）。
- 状态语义：`focus()` 只作用于可见窗口（不解除最小化，任务栏组合 `restore()+focus()`）；`restoreBounds` 记录最大化前几何，最小化的窗口恢复时回到最大化态。
- `WindowInstance` 在 PRD §7.3 基础上扩展了 `minWidth/minHeight/restoreBounds`（工程必需字段）。
- 所有对外读取（`get/list/visibleList`）返回深拷贝快照，外部无法直接改动内部状态。
- 事件：`window.created / focused / closed / minimized / maximized / restored` 经 `systemBus` 广播；移动/缩放等高频操作不发事件，消费方读 store。
- Zustand `window-store`：引擎单例 + `commit()` 全量同步窗口列表；`resetWindowStore()` 供测试隔离。
- UI（`desktop/window/`）：`WindowFrame` 标题栏拖拽（Pointer Events + pointer capture）、右下角缩放、双击标题栏最大化、最小化仅隐藏（`hidden`）不卸载以保留应用状态；`WindowLayer` 订阅 store 渲染。

### 3.5 桌面 Shell（`src/desktop`，PRD §6/§23.3）

- `Desktop` = 壁纸渐变层 + `WindowLayer`（底部留出任务栏 48px）+ `Taskbar`。
- `Taskbar`：开始菜单（`AppLauncher`，列出注册表内应用）、运行窗口按钮（点击在 聚焦/最小化/还原 间切换）、时钟（`Intl.DateTimeFormat` 随 i18n locale）。
- 桌面图标依赖真实文件系统，随 VFS 里程碑（M3）实现。

### 3.6 应用清单与注册表（`src/core/runtime` + `src/store/app-store`，PRD §9/§24）

- `parseManifest(input)`：不可信 Manifest 的全量校验，一次性收集所有问题（`{ path, message }[]`）。规则：`id` 反域名格式（`com.ageha.notes`）、`version` semver、`entry` 绝对路径、`permissions` 必须属于 §10.1 白名单（PRD §9 示例中的裸 `filesystem` 按 §10.1 拒绝，拆分为 `filesystem.read/write`）、`window` 仅接受 `width/height/resizable`。解析成功后深冻结，防止运行时篡改。
- `AppRegistry`：注册（去重，成功发 `app.installed`）/ 注销 / 查询；Zustand `app-store` 以单例注册表驱动，`installApp = parse + register + commit`。
- 内置应用：`src/apps/builtin-manifests.ts`（纯数据 Manifest，随启动注册）+ `src/apps/builtin.tsx`（`APP_UI_META`：图标 / 本地化标题键 / 组件映射）。Manifest 的 `name` 是规范名，UI 显示名走 i18n（PRD §41）。
- 启动流程 `launchApp`（`src/apps/launch.ts`，PRD §24.2）：Registry 查询 → **权限门禁**（任一请求的 capability 未授权即拒绝，并发 `permission.denied` 审计事件，§30.5）→ 本地化标题 → 按 Manifest 窗口默认值开窗。
- 生命周期跟踪器 `createAppLifecycleTracker`：订阅 `window.created/closed`，按 0→1 / 1→0 转换派生 `app.started / app.stopped`；`systemAppLifecycle` 在 `main.tsx` 显式 `start()`。
- 崩溃隔离：`components/AppErrorBoundary` 包裹窗口内容，抛错即发 `app.crashed` 并显示恢复 UI（重新加载 = 重挂载），单应用崩溃不影响桌面（PRD §25/§45.3）。

### 3.7 权限系统（`src/core/permissions`，PRD §10/§13.2）

- `PermissionManager`：按 `{appId → Permission}` 记录显式授权。**Default Deny**——应用拥有的只有被授予的，绝非 Manifest 声明的（§10.3）。
- API：`grant / grantAll / revoke / has / grantedPermissions / forgetApp / clear`；`grant` 与 `revoke` 分别发 `permission.granted / permission.denied`。
- 持久化：localStorage（键 `agehaos.permissions.v1`），构造时恢复；损坏的 JSON、非法权限名、写入失败（隐私模式/配额）均静默降级为内存态。存储可注入，测试用假存储。
- 与注册表的协作：内置系统应用（§8.1 受信）在 `registerBuiltinApps` 时静默授权；第三方安装走 `PermissionConsentDialog`（勾选式逐项授权，全不勾则禁止安装）后由调用方执行 `installApp + grantAll`——对话框已就绪，等 App Store（v0.2）接入；`uninstallApp` 会同时 `forgetApp` 清理授权。
- RBAC（§13.2 的角色一侧）依赖用户系统，随第 12 步（Login/User）补齐；`launchApp` 的门禁即 App Capability 的第一个执行点，未来 SDK API 层复用同一 `has()` 检查。

### 3.8 虚拟文件系统（`src/core/filesystem` + `src/services/vfs`，PRD §11）

- **架构**：`Vfs`（内存文件树 + 校验 + 事件）→ `VfsStorageAdapter` → `IdbAdapter`（IndexedDB，默认）/ `MemoryAdapter`（能力检测降级，§31）。全量快照保存，v0.1 规模下足够；分片写入随云同步（§43）引入。
- **数据模型**：`VfsNode { id, parentId, name, type, content, bytes?, size, trashed, createdAt, updatedAt }`。文件载荷双字段互斥（ADR 23）：文本走 `content`（UTF-8），二进制走 `bytes`（`Uint8Array`，≤8MB，`content` 恒 ''），`size` 恒为字节长度；读写经 `writeFile/readFile`（文本，二进制抛 `is-binary`）与 `writeFileBytes/readFileBytes`（统一字节视图，返回隔离副本）。~~二进制大文件走 OPFS 适配器（待补）~~ **已按 ADR 23 改判为 IndexedDB 双字段直存**（结构化克隆原生支持 TypedArray，全量快照规模下无需第二存储域）。
- **默认目录树**（§11.1）：首次启动播种 `/Desktop、Documents、Downloads、Pictures、Videos、Music、Apps、Trash、System`，之后从存储恢复。
- **操作**：`list / listTrash / get / createDirectory / writeFile（创建或更新，文本）/ readFile / writeFileBytes / readFileBytes / rename / move / copy（目录深拷贝，二进制为独立缓冲）/ remove（进回收站）/ restore / purge / emptyTrash / search（大小写不敏感子串，仅按名匹配）/ pathOfId`。所有操作异步、经 boot promise 串行化，路径错误抛 `VfsError { code }`（UI 层转友好文案，§39）。
- **保护规则**：根目录与全部根级系统目录禁止删除/改名/移动（`root-protected`）；目录不能移入自身子树（`cycle`）；同级重名拒绝（`already-exists`）；回收站恢复时若原名被占用则拒绝，由用户先重命名。
- **事件**：`file.created / updated / deleted` 携带 `{ fileId, path }`；彻底删除（purge/emptyTrash）同样广播 `file.deleted`，让打开中的视图即时移除条目。
- **启动**：`services/vfs.ts` 创建单例，`main.tsx` 中 `systemVfs.ready()` 异步初始化，不阻塞首屏。

### 3.9 File Manager（`src/apps/files`，PRD §23.4/§26/§45.4）

- 首个真实系统应用，`FileManagerApp` 绑定 `systemVfs` 单例；`com.ageha.files` 的 UI 元数据指向它（其余应用仍为占位组件）。
- 布局（§23.4）：侧边栏快速访问（根级系统目录 + 回收站虚拟视图）｜面包屑导航 + 工具栏 + 搜索框｜图标网格（单击选中、双击进入目录/打开预览）。
- 操作映射：新建文件夹 → `createDirectory`；新建文本文件 → `writeFile`；重命名 → `rename`；删除 → `remove`（进回收站）；回收站视图提供 `restore / purge`；搜索框按当前目录子树实时 `search`；双击文件打开只读预览（编辑随 Notes 落地）。
- 通用 `PromptDialog`（`components/prompt-dialog.tsx`）：带校验错误位的输入对话框，供新建/重命名复用。
- 三态齐备（§46）：Loading（`entries === null` 派生）、Empty（目录为空/回收站为空）、Error（`VfsError` 经 `vfsErrorMessageKey` 映射为 i18n 文案，横幅或对话框内 `role=alert` 展示）。
- 订阅 `file.*` 事件保持多窗口/跨应用视图同步；React hooks v7 的 `set-state-in-effect` 约束下，刷新经 `setTimeout(0)` 回调触发。

### 3.10 设计 Token（`src/index.css`，PRD §27）

- 双主题：原始变量定义在 `:root`（浅色）与 `.dark`（深色），经 `@theme inline` 映射为稳定的工具类 Token——UI 组件不感知主题，切换零成本（PRD §27 Light/Dark/System）。
- 主题由 `store/settings-store` 驱动：切换即在 `<html>` 上增删 `.dark`；「跟随系统」监听 `prefers-color-scheme`；主题/字体大小/语言持久化到 localStorage（键 `agehaos.settings.v1`）。
- 字体大小设置直接调整根 `font-size`（14/16/18px），全站 rem 布局随之缩放。
- Light / Dark / System 之外的个性化（壁纸等）待后续。

### 3.11 Settings（`src/apps/settings`，PRD §14）

- 侧边栏 + 内容区（§23.5）：外观（主题/字体大小）、语言（中/英，写入 i18n store）、权限（各应用已授权能力总览，来自 PermissionManager）、关于。
- 语言切换即时生效且持久化——所有 UI 文案走 i18n 的策略在此闭环。

### 3.12 Notes（`src/apps/notes`，PRD §26/§11.2）

- 基于系统 VFS 的文本编辑器：笔记即 `/Documents` 下的文本文件。
- 新建有防覆盖保护（`writeFile` 是创建或更新语义，新建前显式查重，PRD §39）；编辑产生脏状态（圆点指示 + 保存按钮启用）；保存经 `writeFile` 落盘并广播 `file.updated`。
- 订阅 `file.*` 事件，与 File Manager 保持跨应用同步。

### 3.13 用户系统（`src/core/auth` + `src/store/session-store`，PRD §12/§24.1）

- `AuthService`：注册（用户名 `3–32` 位字母/数字/`-`/`_`，密码 ≥6 位）、登录、登出；密码以「盐值 + SHA-256」存储，绝不明文落盘；对外的 `User` 类型不含任何密码材料。
- Session：`{ token, userId, expiresAt }`，默认 7 天 TTL，存于 localStorage（键 `agehaos.session.v1`）；`getSession()` 惰性校验过期并在过期时清除；TTL 可注入，测试用短 TTL 验证「Session Expire」（§45.5）。
- 事件：登录/登出发 `user.login / user.logout`。
- 启动集成（§24.1）：boot 状态机增加 `login` 阶段——`loading` 结束时按 session-store 状态决定进入 `ready`（有会话）或 `login`（无会话）；会话过期后再次启动时，Login 界面显示一次性过期提示。
- 桌面侧：任务栏 `UserMenu` 显示当前用户并提供退出登录；登出后由 App 响应 session 状态切回 Login。
- 后端化（Milestone 5）：仅替换 AuthService 的存储层与校验实现（REST/JWT），`session-store` 与 UI 不变。

### 3.14 AI 动态桌面 Phase A（`src/core/dynamic` + `src/store/dynamic-desktop-store` + `src/desktop/wallpaper`，v0.2.x）

设计文档：[AI-DYNAMIC-DESKTOP-DESIGN.md](AI-DYNAMIC-DESKTOP-DESIGN.md)（下称 DDS）。Phase A = 纯本地程序化生成，总开关默认关闭，关闭后桌面与 v0.1 行为完全一致。

- **内核**（纯 TS 零 React，`src/core/dynamic/`）：
  - `generative/seed.ts`：同步 SHA-256 + mulberry32；`sessionSeed = SHA-256(userId|日期|会话计数)`，`domainSeed` 再混域名/序号/contextVersion（DDS §6.1，禁裸 `Math.random()`）。
  - `generative/palettes.ts` + `templates.ts`：**v2 山水引擎**——24 组抽象调色板（旧计划重放保留）+ 6 组山水调色板（晨雾/晴岚/青绿/水墨/暮色/星夜，各含天空渐变、日月色、4 层山峦色阶、水/雾色）；`buildLandscapeScene` 由种子组装山水场景（天空→星空→日月→三层峦中点位移山脊线→雾带→水面→飞鸟，颜色烘进图元、渲染层零随机）；决策域 `ACTIVE_STYLES = ['landscape']`（用户裁决：抽象色块图退出采样域，代码保留供旧计划重放）；三元组 `(seed, generatorVersion=2, templateId)` 可重放。
  - **自动换新**：`services/dynamic-desktop.ts` 心跳（30s）按随机度档触发 timer 生成（固定=不自动/微调 15min/平衡 10min/探索 6min/狂野 3min），隐藏页与固定态跳过。
  - `decision/engine.ts`：五级滑杆（§DDS 6.3）→ 三区配比 + ε 上限，与个性化阶段 ε 阶梯（`feedback/epsilon.ts`）取更保守者；Top-3 权重 35% 截断、每 7 次强制探索位、Shannon 熵 <1.5 bits 强制全局采样。
  - `governance/`：WCAG 对比度纯函数、质量门（亮度窗口/正文与 UI 对比度/光敏闪烁/装饰重叠）、硬件三档判据与 §7.3 相对阈值降级判定。
  - `generative/pipeline.ts`：3 次可行域重采样 → F1 种子重放 → F2 内置精选 12 张（过质量门）→ F3 静态渐变；每步发 `desktop.*` 事件。
  - `history.ts`：生成历史仅文本元数据落盘 VFS `/Pictures/wallpapers/history.v1.json`（≤30 条 LRU、≤64KB）；Phase A 位图不落盘。
- **状态**：`dynamic-desktop-store`，显式偏好+画像按 userId 分键 `agehaos.dynamic-desktop.v1.<userId>` 持久化（脏数据逐字段回落默认），提供 `resetDynamicDesktopStore()`。
- **装配**：`systemDynamicDesktop`（`src/services/dynamic-desktop.ts`）在 `main.tsx` 既有装配链之后 `start()`：订阅 `user.login/logout`、触发生成、历史落盘。
- **渲染**：`WallpaperLayer` 双层交叉淡化（600ms，reduced-motion 150ms，过渡中打断直接替换目标）；canvas 不可用时回落 CSS 渐变（能力探测）；`Desktop.tsx` 仅在「开关开且有生成结果」时挂载壁纸层。
- **透明性**：桌面右下「✦ AI 生成」徽标（固定后消失，可隐藏）；Settings「动态桌面」section 提供总开关/滑杆/固定/屏蔽/历史回滚/清除数据与结构化生成理由。

### 3.15 应用生态第一步（Type B 沙箱 + App Store + Calculator，v0.2）

- **Type B Web App 宿主**（PRD §8.1、§30.3）：`src/core/apps/web-app.ts` 纯 TS 定义三层隔离——`/apps/sites/` 同源 entry allowlist、`sandbox="allow-scripts"`（**不给** `allow-same-origin`，应用运行于不透明 origin，拿不到父 DOM/cookie/storage）、postMessage 白名单 schema（`event.source` 严格相等 + 未知类型/字段丢弃）。React 容器 `src/components/web-app-frame.tsx`：load 后发 `agehaos:hello` 握手，揭示遮罩；`WindowFrame` 对无内置组件的应用做 allowlist 兜底校验后渲染 `WebAppFrame`，否则 MissingApp。
- **App Store**（PRD §26 P1 骨架）：`src/apps/store/`——目录随构建打包（`catalog.ts`，全部零权限 Type B 样例），安装走既有 `PermissionConsentDialog`（零权限应用可直接确认）→ `installApp`（parseManifest + 注册）→ `permissionManager.grantAll`；已装应用 manifest 持久化于 `agehaos.apps.installed.v1`（`restoreInstalledApps()` 在 boot 逐项重新校验恢复，坏数据跳过），卸载联动 `uninstallApp` + 权限遗忘。
- **Calculator**（PRD §26 P1）：`src/apps/calculator/` 经典即时执行状态机（无 eval），支持键盘输入与连续等号重复运算。
- **示例站点**：`public/apps/sites/clock|sketch/`（外部 JS，无内联脚本，兼容任意 CSP）。
- **Type C SDK**（PRD §8.1）：`src/core/apps/sdk-bridge.ts` 纯 TS 桥——请求白名单 schema（`agehaos:sdk` 信封 + reqId/api/action/params 严格形状）、逐请求 Default Deny 门禁（`SDK_API_PERMISSIONS`：storage→`storage`、window→`window`、theme 免许可只读）、按 appId 命名空间隔离的 KV 存储（`agehaos.sdk.storage.<appId>`，键 1–64 字符、单值 ≤32KB、每应用 ≤64 键 / ≤256KB，坏命名空间回落空）。客户端库 `public/sdk/ageha-sdk.js`（Promise 封装 + 5s 超时，暴露 `AgehaOS.storage/window/theme/files/notification/user/permissions/system`——files/notification 按 ADR 16 落地，user/permissions/system 为免许可只读面，契约见 [APP_SDK.md](APP_SDK.md)）。示例应用「便签」（商店可装，permissions: storage+window）与「云笔记」（filesystem+notification）分别演示存储/窗口面与 files/通知面。Window API 底座为 `WindowManager.setTitle`（标题 ≤120 字符）。
- 缓办：远端应用目录（来源校验/签名/版本管理）、SDK 免许可只读面之外的应用侧扩展（剪贴板/网络等 PRD §17 面）、应用内 set-title 之外的 postMessage 扩展协议。

### 3.16 AI 内容面板（Phase B 本地切片，v0.2）

- **决策引擎**：`src/core/dynamic/content/engine.ts` 纯函数——按时段组装卡片（问候恒有 / 壁纸状态卡随动态桌面开关 / 应用建议按 PHASE_SUGGESTIONS 池过滤已安装可行域 / 小贴士按季节轮换），`validateContentCard` 为本地 schema 过滤（§8.4；Phase C 起同样约束自由文本派生卡）。
- **面板应用**：`com.ageha.dynamic.panel`（DDS §5.5：dynamic.* 前缀 + 零权限注册），`src/apps/dynamic-panel/`——打开时装配一次 + 手动刷新（无自动定时刷新，窗口内容不热替换）；每张卡带「AI 生成 · 本地规则」标识（§6.5 透明机制）；装配发 `ai.content.ready` 与 `ai.decision.performed {domain:'content', source:'local'}`（§3.3）。
- 缓办：布局建议域（§5.1 域②）、LLM 异步增强与三级降级（§5.3，依赖同源后端）、30 分钟后台刷新与聚焦冻结、隐式反馈采集。

### 3.17 桌面编排建议（DDS §5.1 域②，本地规则切片）

- **决策引擎**：`src/core/dynamic/layout/engine.ts` 纯函数——只产出「分组与排序建议」结构：布局档位三选一（single/double/grid，§5.4 离散档位无自由坐标）+ 分组（组名走 `dynamic.layout.group.*` i18n 键白名单、成员为已安装 appId、≤4 组 × ≤8 个）。本地类别启发式（calculator/clock/sticky→工具、sketch→创作、store/panel→资讯，未命中落工具兜底组），档位按目录规模 + 时段确定性推导。输出经 `validateLayoutSuggestion` 自校验（§8.4 过滤管线本地项），不合法一律返回 null。
- **永不随机清单隔离（§5.2 铁律 11）**：`LAYOUT_PROTECTED_APP_IDS`（files/notes/settings）绝不进入建议成员；采纳后的开始菜单把系统应用固定在顶部「系统」组，位置零漂移。
- **采纳链路**：动态面板（开启动态桌面时）出「桌面编排建议」卡 → `desktop.layout.suggested {layoutId}` + `ai.decision.performed {domain:'layout'}` 事件 → 用户点「应用」写入 `dynamic-desktop-store.appliedLayout`（按用户持久化、读档 sanitize）→ `AppLauncher` 以分组渲染 + 档位宽度呈现，「恢复默认布局」一键还原；渲染前 `pruneLayoutSuggestion` 裁剪已卸载成员。AI 不直接移动窗口、不卸载应用（§5.1）。

### 3.18 后端认证服务（`server/`，Milestone 5，PRD §12/§20/§30.4）

- **技术栈**：Node.js 24 + Fastify 5 + `@fastify/cookie` / `@fastify/helmet` / `@fastify/rate-limit` + `pg`。API 契约见 [API.md](API.md)。
- **端点**：`POST /api/auth/register|login|logout`、`GET /api/auth/session`、`GET/ PATCH /api/users/me`、`POST /api/users/me/password`、`POST /api/auth/sessions/revoke-others`、`POST /api/ai/proxy`、`GET /api/health`；错误统一 `{ error: <code> }` 且 code 与前端 `AuthErrorCode` 对齐。用户资料字段 `displayName` / `email` / `avatar`（PRD §12.1 修改昵称/头像；改密码后自动吊销其他会话；头像为客户端缩放 data URL，格式白名单 png/jpeg/webp、≤64KB 字符）。
- **会话**：256-bit opaque token 仅存 `agehaos_session` HttpOnly Cookie（`SameSite=Lax`，生产 `Secure`），服务端 DataStore 持会话表，登录轮换、登出即删、惰性过期 + 登录时顺带清理；令牌零 JS 可见（§30.4 达成）。
- **存储**：`DataStore` 接口三驱动——`memory`（测试）、`file`（本地 dev 默认，JSON 原子写）、`postgres`（`DATABASE_URL`，幂等建表 + 参数化语句；活库集成待环境，见 `server/docker-compose.yml`）。口令 scrypt（N=2¹⁵/r=8/p=1，参数随哈希存储）。
- **安全**：mutating 请求 `Origin` 校验（CSRF，配合代理 `X-Forwarded-Host` + `trustProxy`）、按 IP 路由限流（login 10/min / register 20/min）、JSON Schema 输入校验、helmet 安全头、pino 审计日志（`auth.*`，只记 userId）。
- **前端接线（零 UI/store 面改动）**：`src/core/auth/provider.ts` 把 `systemAuthService` 变为可切换 facade（`AuthProvider` 接口），`RemoteAuthClient`（`backend-client.ts`）以 fetch 调用同源 `/api`，localStorage 只缓存 `{user, expiresAt}` 非敏感元数据；`main.tsx` 按 `VITE_AUTH_BACKEND` 装配并触发 `reconcile()`（会话以服务端为准）；本地 `AuthService` 增加同名 `reconcile()` 保持契约。LoginScreen/SessionStore 逻辑不变。
- **账户 UI**：Settings 新增「账户」区（`AccountSection.tsx`）——头像（`src/core/auth/avatar.ts`：canvas cover-crop 128×128 JPEG + 格式白名单，体积与原图无关）、昵称/邮箱资料保存、修改密码（当前密码校验 + 确认输入）、登出其他设备；任务栏用户菜单显示 `displayName ?? username` 与头像；本地模式同等可用（改密码走本地盐哈希，revoke 为单会话 no-op）。

### 3.19 通知中心（PRD §16，v0.2）

- **状态**（`src/store/notification-store.ts`）：`push / markRead / markAllRead / remove / clear`，历史上限 30 条 LRU（新者先，通知是易逝信息不入持久层，登出即清）；未读数派生 `unreadCount`。
- **桥接**（`src/services/notification-bridge.ts`，幂等启动）：只挑高价值系统事件——`app.crashed`（critical，正文带应用名）与 `desktop.generation.failed`（normal）；高频事件（file.*/窗口）绝不入通知避免疲劳。后续 Type C SDK 的 `AgehaOS.notification.show` 将走同一 store。
- **呈现**：桌面 toast（`NotificationToasts.tsx`，只显示最新一条，critical 8s / normal 4.5s 自动消失，点击即读）+ 任务栏铃铛（`NotificationCenter.tsx`，未读徽标 + 历史面板：标记已读/全部已读/单条删除/清空）。
- **文案**：通知一律存 i18n 键 + `bodyParams`，渲染经 `formatMessage` 占位插值（`{app}` 等）；`translate`/`formatMessage` 均为纯函数。

### 3.19a 设备管理与配置同步（PRD §35，v0.5 前置切片）

- **会话元数据**：`SessionRecord` 增 `createdAt`/`device`（登录时由 User-Agent 解析的短标签，绝不存整段 UA；旧数据缺省容忍，Postgres 迁移自动补列）。
- **设备管理端点**：`GET /api/auth/sessions`（当前会话排首，`id` = token 的 SHA-256 短哈希，令牌本体不出服务端）+ `DELETE /api/auth/sessions/:id`（单会话撤下）；Settings「账户」区列出登录设备并支持逐条撤下。
- **配置同步**：`GET/PUT /api/sync/data`（按 userId 分键的已认证哑 KV，≤256KB）；前端 `src/services/settings-sync.ts` —— boot 拉取并应用（服务端赢）+ 本地改动 1.5s 防抖上推（本地赢），`applying` 标志阻断回声循环，同步范围 = 主题/字体大小/语言；Settings「账户」区开关（`agehaos.sync.enabled.v1`，默认关，仅远程模式显示）。云级冲突合并/多设备仲裁归 Phase 3 完整交付。
- **注册去重**：远程模式注册即登录（服务端已发 Cookie），session-store 跳过二次 login，不再产生重复会话；本地模式行为不变。
- 客户端坑位记录：空 body + `content-type: application/json` 会被 Fastify 判为损坏 JSON（400）——客户端仅在确有请求体时声明 content-type。

### 3.20 LLM 同源代理与深度增强（DDS §5.3，Phase B 切片）

- **服务端代理**（`server/src/routes/ai.ts`）：`POST /api/ai/proxy` —— 请求 schema 白名单（anonymId/locale/context/prefs/slots，未知字段拒绝）、`anonymId` 只作服务端审计分键**不上游转发**、OpenAI 兼容转发（`AGEHA_AI_API_KEY/BASE_URL/MODEL/TIMEOUT_MS`，默认 2s 超时）、响应 schema 过滤（未知槽位/超长文本/重复丢弃）、20/min/IP 限流；未配置 Key → `503`。测试以真 HTTP fake upstream 覆盖（含密钥不下发、超时 504、非 JSON 502）。
- **客户端降级链**（`src/core/dynamic/llm/client.ts`）：2s AbortController 超时、会话最多尝试 2 次（首试 + 重试 ≤1）、**槽位门控双层**——已知槽位接受词表变体（Phase B）或过 `filterContentText` 三类过滤后的自由文本（Phase C），未知槽位一律丢弃；被过滤/被举报文本进会话 banlist 永不复现 + 会话缓存（`getCachedAiSlots`）。降级链：LLM → 缓存 → 本地模板（装配永不被阻塞）。
- **Phase C 本地切片（§8.4/§8.6）**：`src/core/dynamic/content/filter.ts` 三类过滤——violation（本地违规词库）/ misleading（联系方式引流、裸链接无来源标注）/ discomfort（超长重复字符、喊话式全大写），渲染前同步执行；面板对过滤后的自由文案带「举报」按钮——点击立即撤下回落词典 + 发 `ai.content.blocked {reason:'reported'}` + 会话封禁；样本上传通道待基础设施（不经用户确认不上传任何内容，铁律 4/10 天然满足）。服务端分类器归 Phase C 完整交付。
- **面板接线**：`prefs.llmEnhance`（Settings 动态桌面区开关，默认关，总开关关时禁用）开启后，装配完成异步请求 `tip` 槽位；成功 → 提示卡渲染词表选中的模板变体 + 页脚来源「云端模型」；失败 → 缓存（「缓存重放」）→ 本地轮换（「本地规则」）。`ai.decision.performed {domain:'content', source: llm|cache|local}` 三值可查（DDS §11.2 验收 ③）。
- 缓办：Phase C 自由文本生成 + §8.4 完整过滤管线（违规/误导/不适三类）+ 举报通道；品味画像跨周修订；分类器服务端化。
- 缓办：活 PostgreSQL 集成验证、Redis（多实例限流/会话缓存）、S3 对象存储（云文件面）、OAuth/2FA、`user` 资源其余端点（改昵称/头像/密码，PRD §12.1 P1 前置）。

### 3.21 全局搜索与快捷键（PRD §15/§26，v0.2 基础集）

- **快捷键**（`src/desktop/use-global-shortcuts.ts`，window capture 级）：Ctrl/⌘+K 呼出搜索、Esc 关闭、Alt+W 在可见窗口轮转焦点（Alt+Tab 属操作系统不可用；最小化窗口被跳过）。
- **搜索面板**（`SearchPalette.tsx` + `search-store.ts`）：应用域（展示名/manifest 名/appId 三路 includes，前缀命中靠前，≤5 条，纯函数 `rankApps`）+ 文件域（`systemVfs.search('/')`，≤5 条，异步经 setTimeout(0) 落地规避 set-state-in-effect 规则）。键盘 ↑↓/Enter 导航；Enter 打开应用或落到 Files 应用。
- 缓办：文件结果携参启动（PRD §24.3 应用带文件参数打开）、设置项搜索、命令域、最近项目、AI Search 与全文检索（PRD §15「后续」清单）。

### 3.22 终端应用（PRD §26，v0.2 收口）

- **Shell 引擎**（`src/core/terminal/shell.ts`，纯 TS 零 React）：`TerminalShell` 以 `Vfs` 为文件系统——12 个命令（pwd/ls/cd/cat/echo/mkdir/touch/rm/date/whoami/clear/help），`resolvePath` 纯函数处理相对路径与 `..`；无引号/转义解析（参数按空白切分，v0.2 口径）。`rm` 沿用 VFS 回收站语义（与 Files 一致，输出提示避免「文件去哪了」）。输出行结构化（`text` 字面 / `message` i18n 键 + tone），错误不过异常通道全部转结构化行。
- **UI**（`TerminalApp.tsx`）：等宽终端样式、输出区自动滚底、↑↓ 召回本会话命令历史、点击聚焦输入；clear 命令经 `result.clear` 标记驱动清屏。
- **注册**：`com.ageha.terminal` 内置零权限 manifest（660×440 可调）。
- 缓办：管道与重定向、引号解析、命令补全、环境变量、SDK `AgehaOS.terminal` 面。

### 3.23 羽化模式（`src/core/eclosion` + `src/services/eclosion*` + `src/components/eclosion-app-frame`，AI-GENERATED-APPS-DESIGN，P0–P4 全部落地）

AI 按固定规格现场生成 L1 基础软件（计算器/记事本/时钟），L2 依当日热点、L3 依用户输入现场生成虚构应用；L1 原生实现保留为兜底（L2/L3 没有原生版，失败落错误卡）；总开关默认关，任何 AI 环节失败都不阻塞桌面。

- **规格与沙箱**（§3.1/§4）：`core/eclosion/spec.ts` 客户端规格表（appId/权限/窗口/titleKey/原生兜底映射；hint 只在服务端，ADR 27）+ 分域判定 `eclosionAppKind`（basic/today/imagine，L2/L3 恒零权限）、L2/L3 默认窗口 `ECLOSION_RUNTIME_DEFAULT_WINDOW`（720×480 可调）、想象域确定性 appId `imagineAppIdForQuery`（§7）；`html-stream.ts` 流式切分（`<script>` 截留宿主侧、仅闭合元素成片），`runner-protocol.ts` postMessage 白名单（恰四类，多余字段丢弃），`sse.ts` SSE 帧解析。运行时页 `public/apps/runtime/eclosion.html` 自带禁网 CSP（`connect-src 'none'`），iframe `sandbox="allow-scripts"` 不透明 origin。
- **AgehaOS SDK 客户端**（§4.1 第 4 条，runner 全链路）：power-on 信封扩 `capabilities`（消息类型仍恰四类）；runner（`eclosion-runner.js`，eclosion.html 内联副本逐字节一致由测试钉死）按能力声明安装**冻结的** `window.AgehaOS`——未授予的命名空间**不存在**而非「存在但被拒」，生成代码可特性检测分支；实现 `files{read,write,list,mkdir,remove}` / `storage{get,set,remove,keys}` / `theme.get` / `window.setTitle` / `notification.show`，经既有 `agehaos:sdk` 白名单信封 postMessage 委托宿主，reqId 关联回执、5s 超时（`sdk-timeout`）、宿主错误码经 `Error.message` 传播；不暴露 post/pending 等内部原语。宿主侧 SDK 权限**恒来自规格表**（`eclosion-app-frame.tsx`：L1 按各自 permissions、spec 查无即 L2/L3 恒空 → 一律拒绝，不读 permissionManager 运行时授予），power-on 随信附 `sdkCapabilitiesForPermissions`（`runner-protocol.ts` 纯函数，恒含免许可只读 theme）推导的能力清单。
- **编排器**（`src/services/eclosion.ts` 单例 `systemEclosion`，`main.tsx` 装配链尾 `start()`）：fetch+ReadableStream 消费 SSE（POST，非 EventSource）、并发生成流上限 2（超出排队）、AbortController 取消（关窗即中止，预取持有不打断）、重试一次的质量回退、额度快照；会话（`EclosionSession`）是不可变快照的可观察对象，宿主经 `useSyncExternalStore` 消费，粗粒度镜像进 `eclosion-store`。生成目标泛化 `EclosionTarget { basic | today | imagine | kept }`——kind=today 按需流式生成（当日内重开走 today 缓存秒开、重新羽化绕缓存且覆盖本地）、kept 只读快照（跨重启秒开、无网络）；`refreshWorld`（登录/开关开触发，当日缓存命中不重发请求只重播就绪事件）/`regenerateWorld`（个人版）；蝶谱写入（每世界日一条、≤60 LRU、不存 HTML）；`keepApp`/`unkeepApp`（今日缓存或想象会话内存 → kept ≤30 LRU +「我的羽化」清单注册与卸载）；`ensureImagineSession`（三道门禁：开关+登录、客户端 `filterContentText`、≥2 字；同会话同规范化 query 复用同一 appId，HTML 只存会话内存）；`reportApp`（上传成功才关窗+会话封禁——内存级 Set，登出清空不持久化）；登录时 `pruneTodayBefore` 次日清理 + kept 恢复注册；空闲预取 L1 三件套顺序预取 + 今日应用恰前 2 个（每 worldDate 一次）。
- **缓存**（`src/services/eclosion-cache.ts`）：独立 IndexedDB 库 `agehaos.eclosion`（不进 VFS 快照），DB_VERSION 2——basic 键 `userId:specId:v<specVersion>` 按用户分区、today/kept/replay 三 store（today 当日缓存、kept「获取」快照、replay 蝶谱）一次迁移建齐；「清除羽化数据」按用户整段删除。
- **世界数据面与主题落地**（P2）：客户端同构校验 `core/eclosion/world.ts`（公开载荷白名单/色相门全值域纵深防御 + `utcDayKey` UTC 日界，与服务端同口径，一致性由 server/test 动态引入本模块钉死）；`services/world-theme.ts`——壁纸 seed = SHA-256(worldDate|headline)，世界 paletteId 按色相在**当前主题 gradient-field 构图池**内选最近成员（ACTIVE_STYLES 只剩 gradient-field，2026-09-27 裁决；世界行 wallpaper.engine 仅记录不驱动渲染），照常过 `evaluateQuality` 质量门、经 `applyOutcome` 写历史；accentHue → `--ag-primary/--ag-focus-ring/--ag-brand-strong` inline Token（只改色相，`--ag-brand/soft` 经 var() 自动跟随；双主题 WCAG ≥3 门不过不落 inline）。`eclosion.world.ready`（载荷维持 `{worldDate}`）由 dynamic-desktop 订阅应用主题（订阅侧放在壁纸/Token 管线所有者处），`themeFollow` 关时不改主题；动态桌面自动换新在当日世界接管期间跳过（护栏），用户手动「换一张」不受限；蝶谱回放 `applyReplayTheme`（seed=hash(那日 worldDate+headline)，只动主题与壁纸、不写 VFS 历史与今日蝶谱）。
- **服务端生成管线**（`server/src/eclosion/` + `server/src/routes/eclosion.ts`，独立 tsconfig 不依赖 `src/`）：L1 规格表与提示词（`spec.ts`/`prompts.ts`，hint 不出服务端——ADR 27；`capabilityLine` 与实际 SDK API 逐项对齐——files 的 `/Apps/<appId>/` 目录钳制与 invalid-path、storage 键规约与「已存值或 null」、特性检测范例、Promise reject 必须 catch、防抖 800ms；零权限规格明示只剩 theme）、OpenAI 兼容 `stream:true` 上游客户端（`upstream.ts`，`AGEHA_ECLOSION_*` 逐项回退 `AGEHA_AI_*`）、流式结构闸（`html-gate.ts`）、额度域（`quota.ts`：个人每日 basic 10 / today 30 / imagine 20 + 全局日 token 预算）。今日世界：`trending.ts`（可插拔 `TrendingSource` + GitHub Trending RSS 默认源，清洗 ≤120 字/≤12 条/去 HTML/控制字符/URL、violation 条目剔除、内存+DataStore 双层缓存 TTL 6h、失败用上次数据、全无 → `degraded` 纯想象降级）、`world.ts`+`world-data.ts`（JSON Lines 逐行严格校验：theme 行 + 6–10 个 app 行、slug/名称撞名/icon Phosphor 白名单/hue/paletteId 抽象调色板白名单/accentHue WCAG 门+调色板默认回落/category 六枚举/内容过滤；invalid 整段重试一次）、`scheduler.ts`（启动检查 + 每 10 分钟查 UTC 日跨日生成、`unref`、onClose 清理；多实例复用 DataStore 单飞锁，坑 73 次序）。端点 `POST /api/eclosion/generate`（kind=basic/today/imagine，SSE）、`GET /api/eclosion/world`、`POST /api/eclosion/world/regenerate`、`GET /api/eclosion/quota`，契约见 [API.md](API.md)；`DataStore` 扩羽化面（每日计数三档 / 全局缓存（L1 结果+世界+热点共用）/ 单飞锁，memory/file/postgres 三驱动同步，锁一律不持久化）。
- **运行时注册与启动器**（P2，2026-10-02 落位裁决：启动器承载，桌面图标区已移除）：`app-store` 新增 `registerRuntimeApp`/`unregisterRuntimeApp`——与 `installApp` 同一 manifest 校验（schema 冻结）但不进 `INSTALLED_KEY`（`runtimeIds` 过滤持久化）；世界就绪时 `syncWorldApps` 增量同步当日清单，跨日/登出整体注销防陈旧。启动器新增「今日」（瓦片按世界行 hue 色相旋转确定性徽章，`AppIcon` 新 `hue` prop；单击开窗即按需生成）与「我的羽化」（kept 快照，跨重启可用，悬停 ✕ 卸载）两动态分类。
- **想象搜索**（P3）：`SearchPalette` 第三域「想象」恒排应用/文件之后（形如「✦ 想象一个『<query>』应用」），键盘三段化，Enter/点击开窗即生成；`normalizeImagineQuery`（trim+空白折叠+小写）两侧同口径、同批字面量测试钉死；服务端侧见 API.md（kind=imagine：分类器先行、固定模板包裹、恒个人版本、每日 20 次）。
- **治理与蝶谱**（P4）：标题栏「举报」→ `ConfirmDialog` 显式同意（createPortal 至 body）→ `reportApp` 走既有匿名样本链路 `POST /api/dynamic/samples` 扩体（`source:'eclosion'` + HTML 前 2KB 摘要）+ `eclosion.app.reported` 事件；admin 复审面「羽化应用」来源筛选与摘要呈现（客户端过滤，服务端面零扩展）。Settings「羽化」区扩「主题跟随今日世界」`ToggleSwitch`（默认开、总开关关时置灰，重开时重拉世界接回主题）与蝶谱时间线（`ScrollFadeList`：日期/headline/配色条/应用名单 +「回到那天的主题」）。世界信号行 + 来源弹层（Shell 3.1 STEP 3 自顶栏迁入右栏 WorldCard——`desktop/widgets/WorldSignals.tsx`，`usePopoverDismiss` 互斥 + createPortal 至 body + bottom 定位；纯想象降级 signalCount=0 与跨日陈旧世界均不渲染信号行）。
- **宿主容器**（`src/components/eclosion-app-frame.tsx`）：主题 Token 子集（`--ag-*` 映射 `--ageha-*`）随握手 seq0 下发；「结茧中…（思考 N 字）」进度、5 秒无 rendered/eclosion:error 重试一次——L1 落原生兜底 + 标题「已回落经典版」，L2/kept 终态失败渲染**错误卡**（重试=重新羽化）绝不落原生兜底、标题不标「已回落经典版」，imagine 应用共用同一张通用羽化错误卡（`eclosion.error.*`）；quota-exceeded 错误卡按档位展示已用/上限与重置时间；标题栏 `EclosionTitleExtras` = ✦ AI 生成徽标（不可隐藏）+ 重新羽化 + 获取（L1 不出现，成功翻转为已获取）+ 举报（成功才关窗）+ 密码框红色警示；SDK 桥复用 `handleSdkRequest`（逐请求 Default Deny、appId 命名空间）。
- **接线**：三件套进 `builtin-manifests.ts`（entry 统一 `/apps/runtime/eclosion.html`、permissions/window 取自规格表），`WindowFrame` 以 `com.ageha.eclosion.` 前缀分支路由（先于 Type B allowlist 判定）；`launch.ts`/`AppLauncher` 展示名走规格 titleKey；启动器按开关 + 每应用「羽化/经典」生成方式过滤；通知桥只接 `eclosion.app.failed`（按 `eclosionAppKind` 分流——L2/L3 无原生兜底走 NoFallback 文案键）与 `eclosion.world.ready`（每 worldDate 至多一条，去重态在 eclosion-store）；Settings「羽化」区（`EclosionSection`）= 总开关 + 三件套生成方式 + 额度（三档）+ 主题跟随 + 蝶谱 + 清除数据。
- **事件**（ADR 4）：`eclosion.world.ready`（`{worldDate}`，世界就绪实际发送）/`eclosion.app.generating`/`ready`/`failed`/`reported`（举报成功实际发送）+ 既有 `ai.decision.performed {domain:'app', source:'llm'|'cache'|'local'}`。
- 缓办：真实 Key 的上游选型与首字/总时长/思考字数对照（坑 72⑤，待手工 spike）、App Store AI 货架（设计 §11 待决）、多实例单飞锁的 Redis `SET NX`（沿用 types.ts 既有决策推迟）、设计 §6.4 桌面图标/双击语义（已被 2026-10-02 启动器单击落位裁决取代，不实施）。

### 3.24 工作空间选择器与亲和排序（`src/store/workspace-store` + `src/desktop/workspace`，Desktop Shell 3.0 STEP 2/3）

工作空间（个人/学习/开发/创作，`WORKSPACE_IDS`）是 Shell 3.0 引入的用户偏好
维度。架构上刻意做成「**一个持久化标量 + 一层纯函数**」，不含任何窗口几何
语义：

- **状态**（`workspace-store.ts`）：单字段 `workspace: WorkspaceId`，设备本地
  localStorage（`agehaos.workspace.v1`）持久化，**不进云同步**（与动作偏好/
  最近使用同口径——设备行为不进云）；损坏/非法值回落 `DEFAULT_WORKSPACE='personal'`，
  写入失败（隐私模式/配额）静默降级为内存态；`reloadWorkspaceStore()` 供测试
  模拟新页面加载（区别于 wipe 语义的 reset）。本阶段只做 selector：**不改窗口
  管理器**（窗口无工作空间归属，§3.4 的几何约束不感知本维度）。
- **纯函数亲和层**（`src/desktop/workspace/affinity.ts`，零 React 零 store）：
  `launcherWorkspaceScore` / `worldWorkspaceScore` 把「当前工作空间 → 亲和分类
  列表」两张映射表翻译成分数，`rankByScore` 做**稳定降序**（同分保持输入原序
  ——最近使用的时序、世界清单的生成序不因排序被打乱）。`LAUNCHER_CATEGORY_MEMBERS`
  （启动器分类成员）自 AppLauncher 上收至此作为单一来源——启动器分类轨与
  Workspace Panel 的最近使用消费同一份映射，禁止第二套。**只影响「排序」不
  影响「存在」**：亲和分不增删任何应用，无硬编码白名单之外的假数据。
- **消费方三处**：启动器分类轨与最近区推荐（`AppLauncher`）、Workspace Panel
  的「最近使用」前 4（`Sidebar.tsx`）、今日世界分类建议（世界行 category）。
- **展开状态机**（`use-workspace-panel.ts`，纯前端交互层）：hover（240ms 离开
  宽限）/ click pin（品牌钮）/ 键盘聚焦三路触发合并为 `expanded`；Esc / 面板
  外按下 / 启动器或通知中心打开（弹层互斥）收起并回焦品牌钮。刻意不用
  `usePopoverDismiss`——面板是常驻 chrome 的展开态而非独占弹层，全局 claim 槽
  会让顶栏菜单与它互相顶替，语义不符。
- **入口意图**（`launcher-intent.ts`）：外部入口（今日世界「查看世界」）需要
  打开启动器并直接落在指定分类，而 launcher-store 按裁决只放开合——沿用
  `app-deep-link.ts` 的模块级一次性意图范式（launch 前写入、打开时取走即清），
  不为深链扩 store 数据结构。

### 3.25 双 Shell 架构（`src/mobile`，Milestone 0 五片，2026-10-07）

> M0 切片与提交：M0-1 设备能力探针 `1f7a2e4` → M0-2 Shell Selection
> `a1ff3c3` → M0-3 Mobile Shell Root `d789ece` → M0-4 Safe Area `0896122`
> → M0-5 PWA Foundation `7bc494e`。视觉契约见 DESIGN.md §35「Mobile
> Design Contract」；裁决理由见 DECISIONS.md A24。

- **单点切换**：Shell 的选择全仓库只有一处——`App.tsx` 的 ready 分支
  （`shell === 'mobile' ? <MobileShell /> : <Desktop />`，`src/App.tsx:30`）。
  `booting/loading` 与 `login` 阶段不分支：开机屏（DESIGN.md §11）与登录屏
  双 Shell 共享同一份，登出回落 Login 的既有语义不变（`src/App.tsx:22`）。
  桌面根与移动根分别挂 `data-shell="desktop|mobile"` 标记，供 E2E 与测试
  断言 Shell 选择结果。
- **判定集中**：`src/core/platform/device-capabilities.ts`（纯 TS 零 React，
  全仓库**唯一**允许做设备类别判断的模块）——UA-CH 低熵位/UA 正则/触点/
  视口几何 → 手机/平板/桌面互斥三档 + 能力位快照（`isTouch/hasHover/
  orientation/standalone`）；分界 = 短边 <768 手机、768≤短边<1024 平板、
  ≥1024 桌面（iPadOS 13+ 桌面级 UA 自报 Macintosh，靠「Macintosh UA +
  maxTouchPoints>0」识别）；一切能力不可用走安全 fallback 绝不抛错；
  UA-CH 高熵位异步口 `detectUaChMobile` 供后续精化。**store 与 UI 层严禁
  散落 innerWidth / UA 正则判断（架构铁律）**，消费方只读探针结果。
  `src/store/device-store.ts` 持有探针快照并派生本会话 Shell——
  `shellForCapabilities`：手机与平板都归 `'mobile'`（2026-10-07 裁决，
  平板网格后续自适应）；`initDeviceStore()`（`main.tsx` 装配链尾）订阅
  resize / orientationchange / 三条 matchMedia change 整份重测，快照与当前
  值全等时跳过 setState（拖拽缩放期间零空通知）。
- **`src/mobile` 目录职责**：`MobileShell.tsx` 移动 Shell 根布局——与桌面
  同一 `WallpaperLayer`（挂未加 padding 的 shell 根，全幅铺满）+ 三段骨架
  （顶部状态栏占位带 `mobile-statusbar-slot` / 内容区 `mobile-content-slot`
  + 预留滚动容器 `mobile-content-scroll` / 底部 Dock 安全区占位带
  `mobile-dock-slot`，M0 只驻品牌占位字，三段均留空由 M1 填充）；
  `src/store/mobile-nav-store.ts` 是 Shell 层纯导航状态机（`{view:'home'} |
  {view:'app', appId}`）——刻意**不调 launchApp、不碰窗口管理器**，应用
  真实启动/权限门禁/生命周期归 M1 AppHost。
- **Manifest `mobile` 块**（`src/core/runtime/manifest.ts`，M0-3）：可选
  `mobile: { supported, orientation: 'portrait'|'landscape'|'any',
  presentation: 'fullscreen' }`——缺席 = Manifest 对移动不表态，Shell 走
  自己的默认策略；在场 = 三字段必填严格类型（声明类型无可选成员，部分块
  即对类型撒谎，整块拒绝），未知子字段照常报错；纳入既有 `parseManifest`
  全量收集管线与深冻结。
- **复用边界（双 Shell 同一 Core）**：
  - **能力复用**：`core`（探针/i18n/manifest/事件/VFS/权限）、`store`
    （app-store/device-store/usage-store 等全部）、`services` 装配单例、
    `launchApp`（`src/apps/launch.ts`——权限门禁语义不变）、`AppIcon`
    （`src/apps/app-icon.tsx` 徽章体系）、usage-store（最近使用）。移动侧
    不建第二套应用注册/权限/启动逻辑。
  - **容器不复用**：`WindowFrame`/`Taskbar`/`Sidebar` 等桌面容器是桌面
    几何与指针交互的产物，移动 Shell 一律不 import；移动的状态栏/Dock/
    应用宿主在 `src/mobile` 自建（M1）。
- **PWA 基础**（M0-5）：`public/manifest.webmanifest`（`display:
  standalone` + 品牌图标 192/512）+ `index.html` 的
  `apple-mobile-web-app-capable` / `apple-mobile-web-app-status-bar-style:
  black-translucent`（iOS 无 manifest display 支持；black-translucent 配合
  safe-area 占位带内容延伸进状态栏底下）/ `theme-color`；契约测试
  `src/pwa/manifest.test.ts` + `e2e/pwa.spec.ts`。
- **safe-area 基础设施**（M0-3/M0-4，契约细节见 DESIGN.md §35.2）：
  `--safe-top/right/bottom/left` 只在 `.mobile-shell` 根类声明（`src/
  index.css` 移动段），视口需 `viewport-fit=cover`（index.html）env 才有
  非零值；E2E 用 CDP `Emulation.setSafeAreaInsetsOverride` 注入真实 inset
  做几何探针（env 语义 jsdom 算不了，单测只钉结构契约）。
- 测试与 E2E：`device-capabilities.test.ts`（318 行）/ `device-store.test.ts`
  / `mobile-nav-store.test.ts` / `MobileShell.test.tsx`（DOM 结构契约）/
  `e2e/mobile-shell.spec.ts`（移动 context 两档设备：360×800 手动档 +
  iPhone 15 Pro 描述档，断言 `data-shell="mobile"` 且无桌面 chrome；
  desktop context 回归不变 + 断言桌面根未声明 `--safe-top`）。

## 4. 后续模块技术要点

### 4.1 应用运行时完善（`src/core/runtime`，PRD §8/§25）

- 已就位：Manifest 校验、AppRegistry、生命周期跟踪、崩溃隔离、权限门禁（见 §3.6/§3.7）；Type B iframe 沙箱运行时、App Store 骨架与 Type C SDK 桥（见 §3.15）。
- 待补：App Loader 按 `entry` 拉取应用资源；SDK 的 File/Notification/User API；Suspended 状态。
- SDK API 层（`AgehaOS.*`）每个入口先过 `permissionManager.has()`，再执行能力。

### 4.2 虚拟文件系统完善（后续）

- OPFS / File System Access / 远程对象存储适配器；上传、下载、文件编辑随后续应用落地。
- Local First 同步队列（§42）与冲突策略（MVP：Last Write Wins）。

### 4.3 后端完善（`server/`，Milestone 5 进行中，PRD §20）

- 已落地：认证面（register/login/logout/session）+ HttpOnly Cookie 会话 + DataStore 三驱动（见 §3.18 与 [API.md](API.md)）。
- 待补：PostgreSQL 活库集成验证（驱动与建表语句就绪）；Redis（多实例限流共享、会话缓存）；S3 兼容对象存储（随云文件/Cloud Sync，PRD Phase 3）；用户资源扩展（昵称/头像/密码修改）；OAuth / Passkey（PRD §12.1 P1）。
- 数据模型对齐 PRD §21.1（`ageha_users`：id/username/created_at/updated_at/password_hash；email/avatar 随 P1 用户面补列）。

## 5. 已记录的工程决策（ADR 摘要）

1. **单 package 起步，不做 monorepo**：v0.1 以前端为绝对主体（PRD §50），`core` 框架无关保留抽取余地；后端进场时再引入 workspace。
2. **暂不引入 React Router / TanStack Query**：Login 与 Desktop 是状态而非路由；待后端与多页面诉求（PRD Phase 3）出现再引入。
3. **UI 文案从第一行代码起走 i18n**：避免后期迁移成本（PRD §41）。
4. **事件名以 PRD §22 为唯一契约源**：新增事件需先改 `SystemEventMap` 并附测试。
5. **测试策略**（PRD §34）：`core/` 单测全覆盖，UI 组件用 Testing Library，E2E 用 Playwright 运行于生产构建（`vite preview`），已覆盖核心路径 `Login → Desktop → Open App → Create File → Save → Close → Reopen` 及会话恢复、登出、错误凭据（`e2e/core-path.spec.ts`）。
6. **权限名以 §10.1 为准**：PRD §9 示例中的裸 `filesystem` 不在白名单，校验层直接拒绝（有测试固化此决定）。
7. **`src/apps/` 下的纯数据文件**（如 `builtin-manifests.ts`）允许被 store 引用；含组件的文件禁止反向依赖。
8. **动态桌面质量门的亮度口径（Phase A 裁决）**：DDS §4.4 的绝对窗口 [0.2, 0.85] 会把 v0.1 默认深色渐变一并判死，Phase A 以「感知亮度（RGB 均值/255）+ 按主题相对窗口（dark [0.08,0.85] / light [0.55,0.93]）」实现同一质量意图；正文对比度按「深/浅墨色至少一种达 WCAG AA（含 40% 遮罩）」判定。偏差已在代码注释与 DDS §12.2 精神下留痕。
9. **调色板可行域按主题过滤**：深色主题只采深色家族、浅色只采浅色（DDS §2.1 主题权重 0.25 的硬性部分）；风格可行域同时要求该主题下至少有一个兼容调色板，避免采样进不可行空间。装饰重叠门只约束矩形装饰（几何/网格），流体色块、粒子与山水剪影的重叠属设计意图。
10. **动态桌面 Phase A 缓办项**（记录于 DDS §12.3，随后续阶段落）：boot 合成基准 FPS 探测（`detectTier` 已支持 `measuredFps` 入参，运行期探测未接线）、定时换新调度器（滑杆频率映射已实现，仅 login/手动触发已接线）、桌面右键菜单入口、`desktop.feedback` 的全量隐式信号采集（Phase A 仅接线「换一张」负反馈与 ε 阶梯推导）。
11. **认证走 provider facade 而非改 AuthService**：`systemAuthService` 变为可切换 `AuthProvider` facade（默认本地实现，行为与 v0.1 完全一致），远程模式由 `RemoteAuthClient` 实现同一契约——UI 与 store 只多一个 boot 期 `reconcile()` 动作；会话令牌从此不出服务端（HttpOnly Cookie）。
12. **后端存储默认 file 而非强制 Postgres**：本机开发环境无 Docker/PG，`DataStore` 接口下以 file 驱动保证「注册→重启→登录」真实可用；postgres 驱动（幂等建表 + 参数化 SQL）就绪并以 fake Pool 测 SQL 形状，活库集成验证列为显式缓办（`server/docker-compose.yml` 一键补环境）。
13. **scrypt 成本参数显式放宽 maxmem**：N=2¹⁵/r=8 所需 128·N·r 恰为 32 MiB，触发 Node 默认 maxmem 上限直接抛错；显式 `maxmem: 64 MiB` 并把参数写进哈希串以便未来平滑升级。
14. **照片壁纸走打包资产 + 自由许可署名（Phase A.6 裁决）**：用户裁决壁纸采用真实风景照片后，未引入运行时图库 API（网络依赖与授权边界），而是将 16 张经人工目检的 Wikimedia Commons 自由许可照片（CC0/CC BY/CC BY-SA）打包进 `public/wallpapers/landscapes/`，目录元数据（作者/许可证/来源）随 `src/core/dynamic/photos/catalog.ts` 进 core 并被测试固化，`CREDITS.md` 随目录分发以履行 CC BY(-SA) 署名条款；照片计划以 `photoId` 寻址、`<img>` 渲染，「AI 生成」徽标对照片隐藏（对人类作品作 AI 生成声明不成立）。
15. **云文件同步先走整快照 LWW 而非文件级合并（PRD §35 Phase 3 切片裁决）**：文本 VFS 以整树快照存 `files` 同步域，登录拉取（服务端 `savedAt` 新于本机标记才应用）+ `file.*` 事件防抖上推——「更晚的写者赢」语义完整且本地可全量验证，文件粒度合并/冲突副本留待 Phase 3 完整交付；同步 KV 因此按（userId, domain）分键（无键路由保留为 `settings` 别名，file/postgres 驱动自动迁移旧数据）。受保护的根级系统目录不可整删：应用快照时保留外壳、清空内容；回收站不参与同步（设备本地语义）。开关状态在浏览器本地——`setSyncEnabled` 以窗口事件广播，file-sync 据此做会话内即时拉取，避免 settings-sync → file-sync 反向依赖。
16. **SDK 文件能力按应用目录授权而非整盘放行（PRD §17 + §10.3 裁决）**：PRD §10.1 的 `filesystem.read/write` 授予后，SDK 应用可访问的范围仍钳制在 `/Apps/<appId>/`——权限即「访问自己的主目录」，而不是整盘读写；这同时满足 §10.3「不能任意读取其他 App 数据/直接修改系统文件」。桥按（api, action）解析权限（读/列 vs 写/建/删），`handleSdkRequest` 异步化；通知走字面文本（SDK 应用内容不进系统 i18n 词典，但经控制字符清洗与限长），store 以「字面文本优先、词典键兜底」双轨渲染。
17. **文件级三方合并取代整快照 LWW（PRD §35 Phase 3 第二切片裁决）**：同步快照升到 v2（逐文件内容哈希 cyrb53+长度），本地基线（per-user 标记）记录上次同步的逐文件哈希；每次同步 GET 服务端树 → `core/sync/file-merge.ts` 纯函数三方合并 → 应用下载/删除/冲突副本 → PUT 合并树 → 推进基线。冲突不丢数据：编辑/编辑相撞时本地保留原地、服务端版本另存 `<name>.conflict-<savedAt><ext>`；编辑与删除相撞时编辑赢。v1 blob 兼容：旧标记/首次仍走「服务端赢整体应用」，随后即转 v2 基线（基线未知时以服务端为基线，避免虚假冲突）。空目录的删除不参与同步；二进制与对象存储仍属 Phase 3 完整交付。
18. **远端应用目录以 Ed25519 签名目录为信任根（PRD §47 前置切片裁决）**：服务端对目录载荷的规范化 JSON（稳定键序，两端实现由相同测试字面量钉住）做 Ed25519 签名，私钥持久化在服务端数据目录（0600），响应携带 raw 公钥 + keyId + 签名；客户端 WebCrypto 验签，整包拒绝（不部分采纳）。信任锚：生产必须把发布方公钥钉扎进客户端构建（`VITE_STORE_CATALOG_PUBLIC_KEY`），未钉扎的本地开发接受服务端下发键——「服务器被攻破也无法伪造历史目录」仅在钉扎后成立。远程条目仍受同源 `/apps/sites/` allowlist 与 parseManifest 校验约束（签名解决完整性与来源，不放行任意外链）；验签失败的目录整包忽略并在商店给出提示。
19. **应用套件设计方向换血为「蓝白渐变·精密仪表」并以 docs/DESIGN.md 为唯一权威（2026-09 grilling 裁决）**：taste-skill 自由方向（未延续 warm-stone/teal），浅色基线 + 深色适配、全局 Token 跟随（外壳经语义 Token 自动换装）、CSS-only 动效、试点（Files）先行经用户拍板后连续铺开。试点中途用户裁决配色改为蓝白渐变。关键落点：渐变只属于大面（`.surface-panel`/`.surface-canvas`，实色兜底），控件一律实色；等宽数据层（路径/计数/时间戳）是方向的签名元素；emoji 退出系统 UI（品牌 🦋 例外）；新用户默认主题翻转为浅色（存量偏好不动）；开关统一为共享 ToggleSwitch（保持 role=switch/aria-checked/testid 契约）；桌面回落画布与登录屏的 v0.1 暖色硬编码渐变退场。质量门 INK 常量随 Token 同步（壁纸对比度口径不变，取值换冷墨）。
20. **管理员角色以环境变量引导、以「目录发布」为首个能力（ADR 20；2026-10-02 评审 P0-1 修订授权路径）**：不设内置 root/超级用户；`AGEHA_ADMIN_USERNAME` 的唯一授权路径 = **服务端启动时对既有同名用户幂等提升**（先注册普通账号，重启服务后生效）。原「注册时同名即管理员」已移除——该路径允许任意访客抢注引导用户名直接获得远程目录发布权与内容复审权。首个 admin 能力是远程目录发布（`GET/PUT /api/store/admin/catalog`，§47 应用审核前置）：发布走服务端白名单深度校验（entry 钳制 `/apps/sites/<name>/index.html`、权限 ⊆ MVP 名单、字段恰 8 项），公共目录经既有 Ed25519 签名链分发——管理员身份只决定「谁能发布」，目录可信度仍由签名与校验保证。本地认证模式不存在 admin（role 只随远程用户载荷下发）；客户端对 admin 显示设置「远程目录」面板与账户徽标，商店合并时内置清单优先于同 id 的远程条目。
21. **多实例部署以 Redis 共享限流计数（ADR 21 附注）**：`@fastify/rate-limit` 的内存存储按实例独立计数，N 实例部署把限流容量悄悄放大 N 倍——多实例必须在全部实例上设 `AGEHA_REDIS_URL` 启用共享存储（`server/src/rate-limit-redis.ts`，INCR+EXPIRE 固定窗口）。Redis 不可达时 fail-open 放行（限流是过载保护而非安全边界，可用性优先）；ioredis 动态 import，未启用该 env 时默认路径零依赖。单实例部署无需设置，行为与内存版完全一致。已于生产 VPS 以双实例共享计数实测验证（2026-09-28）。
22. **举报样本匿名上报、服务端分类器先行、违规文本永不落库（样本上传切片裁决，DDS §8.6）**：样本上传的信任与隐私边界定为三条——① **匿名**：`POST /api/dynamic/samples` 不要求登录、不携带任何用户/会话标识（举报者身份不出本地，§8.5 上行最小化），滥用由共享限流（10/min/IP）+ 512 字符上限 + 分类器把关，存储记录亦不含用户外键；② **显式同意**：客户端仅在远程模式于 `ConfirmDialog` 同意框确认后才上传（铁律 4/10），纯本地模式无服务端可传，保持纯本机撤下；③ **分类器服务端化（Phase B 前置落地）**：服务端 `classifier.ts` 与客户端离线兜底词库同口径、独立演化，`violation` 命中直接 422 且不落库（违规内容本体不入任何存储），`misleading`/`discomfort`/`ok` 落 `ageha_content_samples`（容量 500 淘汰最旧），复审清单 `GET /api/dynamic/samples` 与处置 `DELETE /api/dynamic/samples/:id` 均 admin 专属（与 ADR 20 同一 `requireAdmin` 门）；复审 UI（设置「内容复审」分区：只读清单 + 删除处置）已交付，完整应用审核面留待 §47。
23. **VFS 二进制承载走 IndexedDB 双字段直存而非 OPFS 适配器（Phase 3 第一片裁决，2026-09-29）**：DDS Phase C 原计划「OPFS 适配器补齐二进制承载」，落地时改判——`VfsNode` 增设 `bytes?: Uint8Array` 与 `content` 互斥（二进制节点 content 恒 ''，size 恒为字节长度），经既有 IdbAdapter 的**结构化克隆**原生持久化（fake-indexeddb 与真浏览器均实测往返字节精确）。理由：全量快照保存仍是当前持久化模型，8MB 上限（`MAX_FILE_BYTES`）内 TypedArray 克隆成本可接受；OPFS 需引入第二存储域 + 异步句柄管理 + 两域一致性维护，在「分片写入（§43）未落地」前收益为负。API：`writeFileBytes/readFileBytes`（统一字节视图、隔离副本、超限抛 `payload-too-large`），`readFile` 对二进制抛 `is-binary` 响亮失败（错误映射走既有 §39 链路）；文本→二进制→文本覆盖由互斥不变量保证。云同步快照本片**跳过**二进制（设备本地语义，对象存储切片接管后放开）；待分片写入落地且单文件规模超越快照模型时，可再评估 OPFS/分域存储。
24. **UI 全面视觉升级 Phase 1：方向升级「Calm Future」、Token 2.0 扩展、默认主题翻转为深色（2026-09-30 grilling 裁决，ADR 19 方向段由本条修订）**：视觉权威 = 仓库根《AgehaOS UI 全面视觉升级.png》（永不提交），布局骨架以升级提示词 §45 为准（顶栏 + 浮动窗口 + 底部 Dock；图中左侧导航栏/右侧小组件为 Phase 2 候选，本期不建）。七项裁决：图定材质风格、§45 定布局；方向取代「蓝白渐变·精密仪表」写入 DESIGN.md（浅色对称适配保留）；顶栏承载系统状态、Dock 纯应用；窗口控制采用左置交通灯；v1 Token 名保留为别名（新代码用 v2 名）；应用图标保留彩色徽章体系；Dock 自动隐藏保持完全出屏。Token 层：`src/index.css` 扩展 v2 语义层（surface-soft/elevated/popover/modal、text-tertiary/disabled、border-subtle/strong、brand/accent 族、shadow 五档、blur 三档、scrim、radius sm8/md12/lg16/xl20/pill、menubar/dock 几何），玻璃材质按图重调（浅 rgb(255 255 255/72%)、深 rgb(16 23 40/66%)，blur 28px）；默认主题 `light → dark`（存量已保存偏好一律不动；壁纸引擎沿用 gradient-field 10 构图，不新增构图）；桌面图标标签由硬编码白字收编为主题 Token（浅色池壁纸上白字实测 3.3:1 不及格）。质量门 INK 常量无需跟随（text/bg 基准色未动）。每片独立提交，四门禁 + E2E + 双主题截图过 visual-judge 后方可推进。
25. **AI 生成应用运行时 = 不透明 origin + 独立 CSP 禁网 + runner 增量渲染（ADR 25，AI-GENERATED-APPS-DESIGN §4）**：替代 MirageOS 的同源 `document.write` 路线。四层隔离——iframe `sandbox="allow-scripts"`（不给 allow-same-origin/popups/top-navigation/forms/modals）；`eclosion.html` 自带 `connect-src 'none'` CSP（生成代码无法 fetch/XHR/WebSocket/beacon 外传，只能 postMessage 对话宿主）；宿主只接受 `event.source === contentWindow` 严格相等且过白名单 schema（恰四类）的消息；能力 Default Deny（L1 权限写在规格里，不由 AI 决定）。流式渲染走「宿主切分片（script 截留）→ runner `<template>` 增量挂载 → 收尾 `eclosion:power-on` 注入脚本」——页面先成形、再破茧。
26. **L1 基础软件 AI 化，原生实现保留为兜底；L0 永不 AI 化（ADR 26，设计 §2）**：计算器/记事本/时钟按固定规格由服务端调用 LLM 生成，产物持久缓存在独立 IndexedDB（不进 VFS 快照），规格版本升级或「重新羽化」才重新生成；任何失败（断网/未配置 Key/运行报错/5 秒无 rendered，重试一次后）都回落原生实现并在标题栏标注「已回落经典版」。登录/窗口管理器/设置/文件管理等 L0 固定软件永不 AI 生成，E2E 核心路径在羽化关闭的默认配置下运行、不受 AI 可用性影响。
27. **生成接口不接受客户端 hint（ADR 27，设计 §5.3/§9.2）**：L1 规格（含提示词）与 L2 今日世界只存在服务端（`server/src/eclosion/spec.ts`），客户端仅传 `specId`——恶意客户端无法把 `POST /api/eclosion/generate` 当通用 LLM 代理；客户端规格表（`src/core/eclosion/spec.ts`）只有元数据（appId/权限/窗口/标题键/兜底映射），两表一致性由服务端测试读文件比对钉死。唯一携带用户文本的 L3 想象域（P3）须经长度限制 + 过滤 + 固定模板包裹。
