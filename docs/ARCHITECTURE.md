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
- `Taskbar`：开始菜单（`AppLauncher`，列出内置应用）、运行窗口按钮（点击在 聚焦/最小化/还原 间切换）、时钟（`Intl.DateTimeFormat` 随 i18n locale）。
- 内置应用目录 `src/apps/registry.ts`：`{ appId, titleKey, icon, width, height, Component }`，当前全部指向占位组件；Runtime 里程碑（PRD §9）将由 Manifest 驱动的正式 App Registry 取代。
- 桌面图标依赖真实文件系统，随 VFS 里程碑（M3）实现。

### 3.6 设计 Token（`src/index.css`，PRD §27）

- Tailwind CSS 4 `@theme` 定义 `--color-*`、`--radius-*`、`--shadow-window`，UI 一律消费 Token，不写魔法值。
- Light / Dark / System 三态切换待 Settings 应用接入（计划用 Tailwind 自定义 `dark` variant）。

## 4. 后续模块技术要点

### 4.1 应用运行时（`src/core/runtime`，PRD §8–10、§25）—— 下一步

- App 三类型：System / Web（iframe 沙箱）/ Ageha（SDK）。
- Manifest 解析与校验独立成纯函数模块，替换现有 `src/apps/registry.ts` 的临时目录；生命周期事件走 `systemBus`。
- 权限模型 `RBAC + App Capability`，Default Deny（PRD §30.1）。

### 4.2 虚拟文件系统（`src/core/filesystem`，PRD §11）

- `VFS API → Storage Adapter → IndexedDB / OPFS / File System Access / 远程对象存储`。
- 所有浏览器差异化 API 必须做 Capability Detection（PRD §31）。
- Local First：本地优先 + 同步队列（PRD §42）。

### 4.3 后端（`server/`，Milestone 5，PRD §20）

- Node.js + Fastify/NestJS，PostgreSQL + Redis + S3 兼容存储；数据模型见 PRD §21。
- Token 用 HttpOnly Cookie，禁止入 LocalStorage（PRD §30.4）。

## 5. 已记录的工程决策（ADR 摘要）

1. **单 package 起步，不做 monorepo**：v0.1 以前端为绝对主体（PRD §50），`core` 框架无关保留抽取余地；后端进场时再引入 workspace。
2. **暂不引入 React Router / TanStack Query**：Login 与 Desktop 是状态而非路由；待后端与多页面诉求（PRD Phase 3）出现再引入。
3. **UI 文案从第一行代码起走 i18n**：避免后期迁移成本（PRD §41）。
4. **事件名以 PRD §22 为唯一契约源**：新增事件需先改 `SystemEventMap` 并附测试。
5. **测试策略**（PRD §34）：`core/` 单测全覆盖，UI 组件用 Testing Library，E2E（Playwright）在 Milestone 6 前补齐核心路径 `Login → Desktop → Open App → Create File → Save → Close → Reopen`。
