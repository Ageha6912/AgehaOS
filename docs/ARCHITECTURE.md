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
| `src/store/`                | Zustand 全局状态，桥接 core 与 UI                      | `core`                                         |
| `src/desktop/`、`src/apps/` | 桌面 UI 与系统应用                                     | `store`、`core`、`components`                  |
| `src/sdk/`                  | 面向第三方 App 的稳定 API（`AgehaOS.*`）               | `core`（只经权限校验的能力封装）               |
| `src/components/`           | 通用 UI 组件                                           | 仅 UI 库                                       |
| `src/services/`             | 平台服务封装（日志、上报等）                           | `core`                                         |
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
- **数据模型**：`VfsNode { id, parentId, name, type, content, size, trashed, createdAt, updatedAt }`。v0.1 文件内容为 UTF-8 文本（`size` 为字节长度），二进制大文件走 OPFS 适配器（待补，§47.3）。
- **默认目录树**（§11.1）：首次启动播种 `/Desktop、Documents、Downloads、Pictures、Videos、Music、Apps、Trash、System`，之后从存储恢复。
- **操作**：`list / listTrash / get / createDirectory / writeFile（创建或更新）/ readFile / rename / move / copy（目录深拷贝）/ remove（进回收站）/ restore / purge / emptyTrash / search（大小写不敏感子串）/ pathOfId`。所有操作异步、经 boot promise 串行化，路径错误抛 `VfsError { code }`（UI 层转友好文案，§39）。
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
- **Type C SDK**（PRD §8.1）：`src/core/apps/sdk-bridge.ts` 纯 TS 桥——请求白名单 schema（`agehaos:sdk` 信封 + reqId/api/action/params 严格形状）、逐请求 Default Deny 门禁（`SDK_API_PERMISSIONS`：storage→`storage`、window→`window`、theme 免许可只读）、按 appId 命名空间隔离的 KV 存储（`agehaos.sdk.storage.<appId>`，键 1–64 字符、单值 ≤32KB、每应用 ≤64 键 / ≤256KB，坏命名空间回落空）。客户端库 `public/sdk/ageha-sdk.js`（Promise 封装 + 5s 超时，暴露 `AgehaOS.storage/window/theme`）。示例应用「便签」（商店可装，permissions: storage+window）演示三个 API。Window API 底座为 `WindowManager.setTitle`（标题 ≤120 字符）。
- 缓办：远端应用目录（来源校验/签名/版本管理）、SDK 的 File/Notification/User API（分别依赖 VFS 按应用授权、通知中心、后端用户面）、应用内 set-title 之外的 postMessage 扩展协议。

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
