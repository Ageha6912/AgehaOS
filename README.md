# AgehaOS 🦋

> **Your Web OS, Your Space.** — 让设备连接生活，让应用触手可及。

AgehaOS 是一个运行在现代浏览器中的「操作系统式 Web Desktop」：提供桌面环境、窗口管理器、应用运行时、虚拟文件系统、用户与权限体系等接近传统 OS 的交互模型。

核心理念：**Everything is an App, Everything is a File, Everything is Web.**

- 产品需求文档：[docs/PRD.md](docs/PRD.md)
- 系统架构图：[docs/assets/system-architecture.png](docs/assets/system-architecture.png)
- 技术架构说明：[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)
- 协作约定：[docs/CONTRIBUTING.md](docs/CONTRIBUTING.md)
- 安全说明：[docs/SECURITY.md](docs/SECURITY.md)
- 更新日志：[CHANGELOG.md](CHANGELOG.md)

## 当前状态

**🎉 v0.1.0 已发布**——MVP 功能面、E2E 与安全加固全部完成（PRD §51 第 01–05、07–15 步）：

- ✅ 工程脚手架（Vite + React 19 + TypeScript + Tailwind CSS 4 + Vitest 5 + ESLint + Prettier）
- ✅ 目录骨架（按 PRD §19.1 规划）
- ✅ 核心基础模块：事件总线（PRD §22）、i18n（PRD §41）、Boot 状态机与 Boot Screen（PRD §23.1）
- ✅ 设计 Token（PRD §27）已接入 Tailwind 主题
- ✅ **窗口管理器**（PRD §7）：生命周期、焦点、z 序、拖拽、缩放、最小化/最大化/还原，含 31 项核心单测
- ✅ **桌面 Shell**（PRD §6/§23.3）：Desktop + 窗口层 + 任务栏（运行窗口切换、时钟）+ 开始菜单启动器
- ✅ **App Manifest 与注册表**（PRD §9/§10.1/§24.2）：`parseManifest` 全量校验（id 反域名、semver、权限白名单、窗口配置）、`AppRegistry`（`app.installed`）、内置应用迁移到 Manifest 驱动
- ✅ **App 生命周期与崩溃隔离**（PRD §22/§25）：`app.started/stopped` 由窗口事件推导；`AppErrorBoundary` 崩溃隔离 + 恢复 UI（`app.crashed`）
- ✅ **权限系统**（PRD §10/§13.2/§45.6）：`PermissionManager` Default Deny + localStorage 持久化（`permission.granted/denied` 事件）、内置应用自动授权、卸载清理授权、`launchApp` 权限门禁（拒绝启动并审计 `permission.denied`）、`PermissionConsentDialog` 安装授权对话框（App Store v0.2 接入）
- ✅ **虚拟文件系统 VFS**（PRD §11/§22/§45.4）：`Vfs` 核心（§11.1 默认目录树、CRUD、重命名/移动/复制、回收站删除/恢复/清空、名称搜索、`file.created/updated/deleted` 事件）、`VFS API → Storage Adapter` 架构、IndexedDB 适配器 + 能力检测降级（§31）、启动时自动初始化并跨刷新恢复
- ✅ **File Manager 应用**（PRD §23.4/§26/§45.4）：首个真实系统应用——侧边栏快速访问 + 回收站视图、面包屑导航、新建文件夹/文本文件、重命名、删除→回收站、还原/彻底删除、目录内搜索、只读文件预览；通用 `PromptDialog` 组件；Loading/Empty/Error 三态齐备
- ✅ **Settings 应用**（PRD §14/§27/§41）：主题切换（浅色/深色/跟随系统，设计 Token 双主题化）、字体大小、界面语言切换（中/英）、权限总览（各应用已授权能力）、关于页；设置持久化到 localStorage
- ✅ **Notes 应用**（PRD §26/§11.2）：基于 VFS 的文本编辑器——/Documents 笔记列表、新建（防覆盖保护）、编辑、保存（脏状态指示）
- ✅ **用户系统**（PRD §12/§23.2/§24.1/§45.5）：`AuthService`（注册/登录/登出，盐值 SHA-256 密码哈希，7 天过期 Session，`user.login/logout` 事件）、启动流程接入会话检查（无会话 → Login 界面）、任务栏用户菜单（登出）、会话跨刷新恢复、过期会话清除与提示
- ✅ **E2E 测试**（PRD §34.3）：Playwright 覆盖核心路径 登录→桌面→打开应用→创建文件→保存→关闭→重开，含会话刷新恢复与登出（`npm run test:e2e`，运行于生产构建）
- ✅ **安全加固**（PRD §30/§45.6）：生产构建 CSP、`no-referrer`、无原生 HTML 注入审计、盐值哈希口令（详见 [docs/SECURITY.md](docs/SECURITY.md)）
- ✅ **性能验证**（PRD §29）：E2E 断言刷新后 3 秒内可交互、20 窗口下桌面保持响应
- 🎉 **v0.1.0 已发布**（PRD §51 第 15 步）——见 [CHANGELOG.md](CHANGELOG.md)
- 🆕 **后端认证服务**（Milestone 5，PRD §20/§30.4，契约见 [docs/API.md](docs/API.md)）：`server/` 下 Node.js 24 + Fastify 5——注册/登录/登出/会话端点、256-bit opaque 令牌仅存 HttpOnly Cookie（SameSite=Lax，JS 不可见）、scrypt 口令哈希、CSRF Origin 校验、按 IP 路由限流、helmet 安全头、pino 审计；存储三驱动 memory/file/postgres（`DataStore` 可插拔，file 支持重启持久化，postgres 驱动就绪待活库验证）。前端 `systemAuthService` 升级为可切换 Provider：`VITE_AUTH_BACKEND=1` 即远程模式，UI 零改动，未设置保持本地行为
- ⏳ 下一步：后端补全（PostgreSQL 活库验证、Redis 限流共享、S3 云文件）→ 布局建议域 / LLM 增强（Phase B 后续）→ SDK File/Notification API → v0.2 收口

## 快速开始

要求 Node.js ≥ 20.19（推荐 24 LTS）。

```bash
npm install       # 安装依赖
npm run dev       # 启动开发服务器
npm run test      # 运行单元测试
npm run test:e2e  # 构建并运行 Playwright E2E 测试
npm run lint      # ESLint 检查
npm run typecheck # TypeScript 检查
npm run build     # 生产构建（含 typecheck）
```

E2E 首次运行前需安装浏览器：`npx playwright install chromium`。

### 后端（可选，Milestone 5）

```bash
npm run dev:server   # 认证 API（tsx watch）→ http://127.0.0.1:8787
npm run test:server  # 后端测试（vitest，node 环境）
```

开发服务器带 `VITE_AUTH_BACKEND=1 npm run dev` 即切换为远程认证：登录/注册经同源 `/api`（Vite 代理 → :8787）走后端，会话变为 HttpOnly Cookie；不带该变量则维持本地 localStorage 认证。完整环境变量与端点说明见 [docs/API.md](docs/API.md)。

## 目录结构

```text
src/
├── core/            # OS Core Runtime（框架无关，禁止依赖 React）
│   ├── events/      # ✅ 事件总线 + 系统事件映射
│   ├── i18n/        # ✅ 国际化（zh-CN / en）
│   ├── window/      # ✅ 窗口管理器（生命周期/焦点/z序/几何约束）
│   ├── runtime/     # ✅ Manifest 校验 + AppRegistry + 生命周期跟踪
│   ├── filesystem/  # ✅ VFS（文件树/CRUD/回收站/搜索 + IndexedDB 适配器）
│   └── permissions/ # ✅ 权限系统（PermissionManager，Default Deny + 持久化）
├── desktop/         # 桌面环境 UI
│   ├── boot/        # ✅ Boot Screen
│   ├── window/      # ✅ WindowFrame / WindowLayer（拖拽、缩放、按钮）
│   ├── taskbar/     # ✅ 任务栏（启动器、运行窗口、时钟）
│   ├── launcher/    # 开始菜单增强（搜索/分类，待开发）
│   ├── notification/# 通知中心（待开发）
│   └── wallpaper/   # 壁纸（待开发）
├── apps/            # 系统应用（✅ files / notes / settings 均为真实应用）
├── sdk/             # AgehaOS App SDK（AgehaOS.window / .files / …）
├── store/           # 全局状态（✅ boot-store / window-store / app-store）
├── services/        # 平台服务封装
├── components/      # 通用 UI 组件（✅ AppErrorBoundary / PermissionConsentDialog）
└── main.tsx
```

`docs/` 存放产品与技术文档；后端认证服务（Milestone 5）位于 `server/`（独立 tsconfig 与 vitest 配置，契约见 [docs/API.md](docs/API.md)）。

## 技术栈

| 层           | 选型                                                        |
| ------------ | ----------------------------------------------------------- |
| 前端         | React 19 · TypeScript · Vite · Zustand · Tailwind CSS 4     |
| 测试         | Vitest · Testing Library · jsdom · Playwright（E2E）        |
| 工程化       | ESLint（flat config）· Prettier                             |
| 后端         | Node.js 24 · Fastify 5 · pg（PostgreSQL，驱动就绪）· tsx    |

## 测试与质量基线

每次改动必须附带/更新测试，且交付前 `npm run typecheck && npm run lint && npm run test && npm run build` 全部通过（见 [docs/CONTRIBUTING.md](docs/CONTRIBUTING.md) 的 Definition of Done）。
