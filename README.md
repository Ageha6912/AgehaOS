# AgehaOS 🦋

> **Your Web OS, Your Space.** — 让设备连接生活，让应用触手可及。

AgehaOS 是一个运行在现代浏览器中的「操作系统式 Web Desktop」：提供桌面环境、窗口管理器、应用运行时、虚拟文件系统、用户与权限体系等接近传统 OS 的交互模型。

核心理念：**Everything is an App, Everything is a File, Everything is Web.**

- 产品需求文档：[docs/PRD.md](docs/PRD.md)
- 系统架构图：[docs/assets/system-architecture.png](docs/assets/system-architecture.png)
- 技术架构说明：[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)
- 协作约定：[docs/CONTRIBUTING.md](docs/CONTRIBUTING.md)

## 当前状态

**Phase 0 / MVP 功能面 + E2E 已完成**（对应 PRD §51 第 01–05、07–13 步，仅剩加固与发布）：

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
- ⏳ 下一步：性能/安全加固（14）→ v0.1 发布（15）；后端化（Milestone 5）时仅替换 AuthService 存储层

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

`docs/` 存放产品与技术文档；后端服务（Milestone 5）将位于 `server/`。

## 技术栈

| 层           | 选型                                                        |
| ------------ | ----------------------------------------------------------- |
| 前端         | React 19 · TypeScript · Vite · Zustand · Tailwind CSS 4     |
| 测试         | Vitest · Testing Library · jsdom（E2E 后续引入 Playwright） |
| 工程化       | ESLint（flat config）· Prettier                             |
| 后端（规划） | Node.js + Fastify/NestJS · PostgreSQL · Redis · S3 兼容存储 |

## 测试与质量基线

每次改动必须附带/更新测试，且交付前 `npm run typecheck && npm run lint && npm run test && npm run build` 全部通过（见 [docs/CONTRIBUTING.md](docs/CONTRIBUTING.md) 的 Definition of Done）。
