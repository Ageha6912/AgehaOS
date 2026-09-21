# AgehaOS 🦋

> **Your Web OS, Your Space.** — 让设备连接生活，让应用触手可及。

AgehaOS 是一个运行在现代浏览器中的「操作系统式 Web Desktop」：提供桌面环境、窗口管理器、应用运行时、虚拟文件系统、用户与权限体系等接近传统 OS 的交互模型。

核心理念：**Everything is an App, Everything is a File, Everything is Web.**

- 产品需求文档：[docs/PRD.md](docs/PRD.md)
- 系统架构图：[docs/assets/system-architecture.png](docs/assets/system-architecture.png)
- 技术架构说明：[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)
- 协作约定：[docs/CONTRIBUTING.md](docs/CONTRIBUTING.md)

## 当前状态

**Phase 0 / Project Bootstrap + Desktop Core 已完成**（对应 PRD §51 第 01–03 步）：

- ✅ 工程脚手架（Vite + React 19 + TypeScript + Tailwind CSS 4 + Vitest 5 + ESLint + Prettier）
- ✅ 目录骨架（按 PRD §19.1 规划）
- ✅ 核心基础模块：事件总线（PRD §22）、i18n（PRD §41）、Boot 状态机与 Boot Screen（PRD §23.1）
- ✅ 设计 Token（PRD §27）已接入 Tailwind 主题
- ✅ **窗口管理器**（PRD §7）：生命周期、焦点、z 序、拖拽、缩放、最小化/最大化/还原，含 31 项核心单测
- ✅ **桌面 Shell**（PRD §6/§23.3）：Desktop + 窗口层 + 任务栏（运行窗口切换、时钟）+ 开始菜单启动器
- ✅ 内置应用占位注册表（Notes / Files / Settings 占位，真实应用待 Milestone 4）
- ⏳ 下一步：Event Bus 已就绪 → App Registry / Manifest（05）→ App Runtime（06）→ 权限系统（07）→ VFS（08）（见 PRD §51）

## 快速开始

要求 Node.js ≥ 20.19（推荐 24 LTS）。

```bash
npm install       # 安装依赖
npm run dev       # 启动开发服务器
npm run test      # 运行单元测试
npm run lint      # ESLint 检查
npm run typecheck # TypeScript 检查
npm run build     # 生产构建（含 typecheck）
```

## 目录结构

```text
src/
├── core/            # OS Core Runtime（框架无关，禁止依赖 React）
│   ├── events/      # ✅ 事件总线 + 系统事件映射
│   ├── i18n/        # ✅ 国际化（zh-CN / en）
│   ├── window/      # ✅ 窗口管理器（生命周期/焦点/z序/几何约束）
│   ├── runtime/     # 应用运行时（待开发）
│   ├── filesystem/  # 虚拟文件系统 VFS（待开发）
│   └── permissions/ # 权限系统（待开发）
├── desktop/         # 桌面环境 UI
│   ├── boot/        # ✅ Boot Screen
│   ├── window/      # ✅ WindowFrame / WindowLayer（拖拽、缩放、按钮）
│   ├── taskbar/     # ✅ 任务栏（启动器、运行窗口、时钟）
│   ├── launcher/    # 开始菜单增强（搜索/分类，待开发）
│   ├── notification/# 通知中心（待开发）
│   └── wallpaper/   # 壁纸（待开发）
├── apps/            # 系统应用（✅ 占位注册表；files/settings/notes 待实现）
├── sdk/             # AgehaOS App SDK（AgehaOS.window / .files / …）
├── store/           # 全局状态（✅ boot-store / window-store）
├── services/        # 平台服务封装
├── components/      # 通用 UI 组件
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
