# AgehaOS PRD

> 产品类型：Web-based Operating System（基于 Web 的操作系统式桌面环境）
>
> 文档状态：Draft / 可进入开发
>
> 目标：为前后端、桌面 UI、应用开发、安全与测试团队提供统一的产品与技术协作基线。

---

## 1. 产品概述

### 1.1 产品名称

**AgehaOS**

AgehaOS 是一个运行在现代浏览器中的“操作系统式 Web Desktop”。它不直接替代 Windows、macOS 或 Linux 内核，而是在浏览器之上提供一套接近桌面操作系统的交互模型，包括：

- 桌面环境（Desktop）
- 窗口管理（Window Manager）
- 应用中心与应用运行时（Application Runtime）
- 文件系统（Virtual File System）
- 用户、身份与权限（Identity & Permission）
- 系统设置（Settings）
- 通知、任务栏、搜索等系统级能力

### 1.2 产品愿景

让用户打开一个 URL，就能进入一个完整、统一、可扩展的 Web 工作环境。

核心理念：

> **Everything is an App, Everything is a File, Everything is Web.**

### 1.3 产品定位

AgehaOS 不以“模拟真实操作系统内核”为目标，而以以下方向为核心：

1. **桌面体验**：提供类似传统操作系统的稳定桌面交互。
2. **Web 原生**：应用天然基于 Web 技术运行。
3. **可扩展**：系统能力通过统一 API 向应用开放。
4. **跨平台**：主要依赖现代浏览器，降低终端系统差异。
5. **可部署**：支持本地开发、自托管和云端部署。

---

# 2. 产品目标

## 2.1 第一阶段产品目标

在 MVP 阶段完成一个可稳定使用的“Web Desktop”，用户可以：

- 登录/进入 AgehaOS
- 看到桌面
- 打开、关闭、最小化、最大化窗口
- 启动系统应用
- 在应用之间切换
- 创建、查看、移动、重命名、删除文件
- 使用系统搜索
- 修改基础系统设置
- 管理账户与基础权限
- 在同一会话中同时运行多个 Web 应用
- 刷新页面后恢复部分用户状态

## 2.2 非目标

MVP 阶段暂不追求：

- 替代真实 OS 内核
- 自研浏览器引擎
- 原生驱动与硬件管理
- 完整的 Linux/Windows 软件兼容层
- 企业级目录服务
- 复杂的多租户组织权限体系
- 超大型多人协作办公能力

---

# 3. 目标用户

## 3.1 核心用户

### A. 开发者

需求：

- 在线使用多个 Web 工具
- 将工具聚合到同一桌面
- 快速创建/测试自定义应用
- 查看文件与项目资源
- 调试 Web App

### B. 学生 / 学习者

需求：

- 在一个桌面中运行学习工具
- 文件整理
- 浏览器、笔记、计算器等工具并行使用
- 使用简单统一的操作界面

### C. Web App 爱好者 / 极客

需求：

- 体验“Web OS”
- 安装/开发第三方应用
- 自定义主题与桌面
- 探索可扩展的 Web Runtime

### D. 企业内部工具用户

后续可拓展：

- 内部门户
- BI 工具
- CRM
- AI Agent
- 数据分析工具
- 企业内部应用

---

# 4. 用户场景

## 4.1 单用户桌面

用户登录 AgehaOS 后：

`Login → Desktop → Launch App → Work → Save File → Logout`

## 4.2 多应用工作

用户：

1. 打开文件管理器
2. 打开文本编辑器
3. 打开浏览器应用
4. 在窗口之间切换
5. 将文件拖动到编辑器
6. 保存文件
7. 关闭应用

## 4.3 应用开发

开发者：

`Developer Mode → Register App → Define Manifest → Test Runtime → Install → Launch`

## 4.4 云端工作

用户在不同设备：

`Device A → Save State → Login → Device B → Restore Desktop`

---

# 5. MVP 核心功能范围

## 5.1 功能分级

| 优先级 | 说明               |
| ------ | ------------------ |
| P0     | MVP 必须完成       |
| P1     | MVP 后第一阶段完成 |
| P2     | 后续扩展           |

---

# 6. 桌面环境 Desktop

## 6.1 桌面

桌面主要区域：

- 壁纸
- Desktop Icon
- Taskbar / Dock
- 系统托盘
- 快速搜索
- 通知入口
- 当前时间

### Desktop Icon

支持：

- 单击选中
- 双击打开
- 拖动
- 右键菜单
- 自动排列
- 创建快捷方式

## 6.2 Taskbar

Taskbar 显示：

- Start / App Launcher
- 当前运行 App
- 固定 App
- 系统托盘
- 网络状态
- 音频状态
- 电量（若浏览器允许）
- 时间

### Taskbar 行为

支持：

- 单击启动/切换
- 右键快捷菜单
- 窗口预览（P1）
- App 状态标记

## 6.3 开始菜单 / App Launcher

功能：

- 搜索 App
- 查看全部应用
- 最近使用
- 收藏应用
- 分类

---

# 7. 窗口管理系统 Window Manager

窗口系统是 AgehaOS 的核心能力之一。

## 7.1 Window 生命周期

状态：

`Created → Mounted → Active → Inactive → Minimized → Closed`

异常情况：

`Running → Crashed → Recoverable / Closed`

## 7.2 窗口能力

MVP 支持：

- 打开
- 关闭
- 最小化
- 最大化
- 还原
- 移动
- 调整大小
- 层级切换
- 聚焦
- 拖拽
- 窗口激活

P1：

- Snap Layout
- 多显示器逻辑布局
- 虚拟桌面
- 窗口预览
- 全屏窗口

## 7.3 Window Model

```ts
interface WindowInstance {
  id: string
  appId: string
  title: string
  x: number
  y: number
  width: number
  height: number
  zIndex: number
  state: 'normal' | 'minimized' | 'maximized'
  focused: boolean
  resizable: boolean
  closable: boolean
}
```

---

# 8. 应用系统 Application Runtime

## 8.1 应用类型

AgehaOS 支持三类 App：

### Type A：System App

由系统官方维护。

示例：

- File Manager
- Settings
- Terminal
- Text Editor
- App Store

### Type B：Web App

普通 Web 应用。

运行方式：

- iframe
- Embedded WebView-like container（受浏览器能力限制）
- 独立标签页模式

### Type C：Ageha App

遵循 AgehaOS App SDK 开发的应用。

具备：

- Window API
- File API
- Notification API
- Storage API
- User API
- Theme API

---

# 9. App Manifest

每个 AgehaOS App 必须包含 Manifest。

示例：

```json
{
  "id": "com.ageha.notes",
  "name": "Notes",
  "version": "1.0.0",
  "entry": "/apps/notes/index.html",
  "icon": "/apps/notes/icon.png",
  "permissions": ["storage", "filesystem", "notification"],
  "window": {
    "width": 900,
    "height": 600,
    "resizable": true
  }
}
```

## 9.1 Manifest 字段

| 字段        | 必须 | 说明         |
| ----------- | ---- | ------------ |
| id          | 是   | 唯一应用 ID  |
| name        | 是   | 应用名称     |
| version     | 是   | 应用版本     |
| entry       | 是   | 应用入口     |
| icon        | 否   | 应用图标     |
| permissions | 否   | 所需权限     |
| window      | 否   | 默认窗口配置 |
| author      | 否   | 开发者       |
| description | 否   | 描述         |

---

# 10. 应用权限

权限必须遵循最小权限原则。

## 10.1 MVP 权限

- `filesystem.read`
- `filesystem.write`
- `storage`
- `notification`
- `clipboard`
- `window`
- `network`

## 10.2 权限申请流程

```text
Install App
   ↓
Read Manifest
   ↓
Detect Permissions
   ↓
User Consent
   ↓
Grant / Deny
   ↓
App Runtime
```

## 10.3 安全原则

第三方应用不能：

- 任意读取其他 App 数据
- 任意读取用户 Token
- 直接修改系统文件
- 直接执行任意系统代码
- 绕过权限申请

---

# 11. 文件系统 Virtual File System

## 11.1 目标

向用户提供接近传统 OS 的文件管理体验。

目录示例：

```text
/
├── Desktop
├── Documents
├── Downloads
├── Pictures
├── Videos
├── Music
├── Apps
├── Trash
└── System
```

## 11.2 文件基本操作

MVP：

- 新建文件夹
- 新建文本文件
- 上传文件
- 下载文件
- 删除
- 恢复
- 重命名
- 移动
- 复制
- 粘贴
- 文件预览
- 文件搜索

P1：

- 收藏
- 标签
- 文件版本
- 云同步
- 分享

## 11.3 浏览器存储技术方向

优先级：

1. IndexedDB：元数据与应用状态
2. OPFS：大文件/二进制数据
3. File System Access API：用户显式授权的本地目录
4. 后端对象存储：云端文件同步

推荐架构：

```text
VFS API
   ↓
Storage Adapter
 ├── IndexedDB
 ├── OPFS
 ├── Local File System
 └── Remote Object Storage
```

---

# 12. 用户系统

## 12.1 用户能力

MVP：

- 登录
- 注册
- 登出
- 修改头像
- 修改昵称
- 修改密码
- Session 管理

P1：

- OAuth
- Passkey
- 2FA
- 多设备管理

## 12.2 用户数据

```ts
interface User {
  id: string
  username: string
  email?: string
  avatar?: string
  createdAt: string
  updatedAt: string
}
```

---

# 13. 权限与角色

## 13.1 MVP 角色

### User

普通用户。

### Admin

管理系统应用、用户与配置。

### Developer

允许：

- 创建应用
- 注册本地 App
- 调试 App
- 查看 Runtime 日志

## 13.2 权限模型

推荐采用：

`RBAC + App Capability`

示例：

```text
User
  └── Role
       └── Permissions

App
  └── Manifest
       └── Capabilities
```

---

# 14. 系统设置 Settings

设置分类：

### Personalization

- 壁纸
- 主题
- 深色 / 浅色
- 字体大小
- 动画

### System

- 默认应用
- 时间格式
- 语言
- 时区
- 启动项

### Privacy

- 权限管理
- Cookie / Storage
- App 权限
- 数据清理

### Account

- 用户资料
- 登录设备
- Session
- 安全设置

---

# 15. 系统搜索

统一搜索入口：

`Ctrl + K`

搜索范围：

- App
- 文件
- 设置
- 最近项目
- 命令

后续：

- AI Search
- 全文检索
- App 内容索引

---

# 16. 通知系统

## 16.1 Notification

应用可以调用：

```ts
ageha.notification.show({
  title: 'Download Complete',
  body: 'example.zip has been downloaded.',
})
```

通知属性：

- 标题
- 内容
- 图标
- 时间
- 点击行为
- 优先级

## 16.2 Notification Center

支持：

- 查看历史通知
- 标记已读
- 清空
- 单条删除

---

# 17. 核心系统 API

AgehaOS 应提供统一 SDK：

```ts
AgehaOS.window
AgehaOS.files
AgehaOS.storage
AgehaOS.notification
AgehaOS.user
AgehaOS.permissions
AgehaOS.theme
AgehaOS.system
```

示例：

```ts
await AgehaOS.files.write('/Documents/test.txt', 'Hello AgehaOS')
```

---

# 18. 技术架构

## 18.1 总体架构

```text
┌──────────────────────────────┐
│          Browser             │
├──────────────────────────────┤
│       AgehaOS Desktop        │
│ ┌────────┐ ┌───────────────┐ │
│ │Window  │ │ System UI     │ │
│ │Manager │ │ Taskbar/Menu  │ │
│ └────────┘ └───────────────┘ │
├──────────────────────────────┤
│        OS Core Runtime       │
│ ┌──────┬──────┬──────┬─────┐ │
│ │ VFS  │ App  │ User │ API │ │
│ │      │Runtime│Auth │     │ │
│ └──────┴──────┴──────┴─────┘ │
├──────────────────────────────┤
│       Browser APIs           │
│ IndexedDB / OPFS / Fetch     │
│ Service Worker / Web APIs    │
└──────────────────────────────┘
                 │
                 ▼
┌──────────────────────────────┐
│          Backend             │
│ Auth / DB / Storage / API    │
└──────────────────────────────┘
```

---

# 19. 前端技术方向

推荐：

- TypeScript
- React
- Vite
- Zustand / Redux Toolkit
- Tailwind CSS
- React Query / TanStack Query
- React Router
- Vitest
- Playwright

也允许采用 Vue / Svelte 等方案，但项目应统一技术栈。

## 19.1 推荐目录

```text
src/
├── core/
│   ├── window/
│   ├── runtime/
│   ├── filesystem/
│   ├── permissions/
│   └── events/
├── desktop/
│   ├── taskbar/
│   ├── launcher/
│   ├── notification/
│   └── wallpaper/
├── apps/
│   ├── files/
│   ├── settings/
│   ├── terminal/
│   └── notes/
├── sdk/
├── store/
├── services/
├── components/
└── main.tsx
```

---

# 20. 后端技术方向

后端主要负责：

- 身份认证
- 用户数据
- 云端文件
- App Metadata
- 权限校验
- 配置同步
- 日志

推荐：

### API

- REST API 或 tRPC
- WebSocket（实时能力）

### Database

- PostgreSQL

### Cache

- Redis

### Object Storage

- S3 Compatible Storage

### Auth

- JWT / Session
- OAuth
- Passkey（P1）

---

# 21. 数据模型

## 21.1 User

```text
users
- id
- username
- email
- password_hash
- avatar
- created_at
- updated_at
```

## 21.2 App

```text
apps
- id
- name
- version
- manifest
- owner_id
- status
- created_at
- updated_at
```

## 21.3 File

```text
files
- id
- user_id
- parent_id
- name
- type
- size
- storage_key
- created_at
- updated_at
```

## 21.4 Permission

```text
permissions
- id
- user_id
- app_id
- permission
- granted
- created_at
```

---

# 22. 事件系统

系统核心采用 Event Bus。

示例：

```text
window.created
window.focused
window.closed

app.installed
app.started
app.stopped
app.crashed

file.created
file.updated
file.deleted

user.login
user.logout

permission.requested
permission.granted
permission.denied
```

好处：

- 降低模块耦合
- 支持插件
- 方便日志与调试
- 支持未来自动化

---

# 23. 页面与界面结构

## 23.1 Boot Screen

用途：

- 初始化 Runtime
- 加载用户配置
- 检查 Session
- 恢复桌面状态

状态：

`Booting → Loading → Ready`

## 23.2 Login

元素：

- Logo
- 用户名/邮箱
- 密码
- 登录按钮
- 注册
- OAuth
- 记住登录状态

## 23.3 Desktop

主要区域：

```text
┌──────────────────────────────────────┐
│                                      │
│              Desktop                 │
│                                      │
│       App Window / Windows           │
│                                      │
│                                      │
├──────────────────────────────────────┤
│ Start | Running Apps | Tray | Clock │
└──────────────────────────────────────┘
```

## 23.4 File Manager

布局：

```text
┌────────────┬────────────────────────┐
│ Sidebar    │ Files                  │
│            │                        │
│ Desktop    │ Folder / Folder / File │
│ Documents  │                        │
│ Downloads  │                        │
└────────────┴────────────────────────┘
```

## 23.5 Settings

采用侧边栏 + 内容区。

---

# 24. 关键交互流程

## 24.1 登录

```text
打开 AgehaOS
   ↓
Boot
   ↓
检测 Session
   ↓
存在 Session？
 ┌───────┴───────┐
是               否
↓                ↓
Desktop          Login
                  ↓
                Verify
                  ↓
                Desktop
```

## 24.2 打开应用

```text
点击 App
 ↓
App Registry
 ↓
检查 Permission
 ↓
创建 Window
 ↓
Mount Runtime
 ↓
App Ready
```

## 24.3 打开文件

```text
File Manager
 ↓
Double Click
 ↓
查找 File Association
 ↓
打开 Default App
 ↓
传递 File Handle / File ID
```

## 24.4 安装应用

```text
App Store
 ↓
Install
 ↓
读取 Manifest
 ↓
校验来源
 ↓
显示 Permission
 ↓
用户确认
 ↓
写入 App Registry
 ↓
完成
```

## 24.5 文件保存

```text
App
 ↓
AgehaOS.files.write()
 ↓
Permission Check
 ↓
VFS
 ↓
Storage Adapter
 ↓
Persist
```

---

# 25. App 生命周期

```text
Installed
   ↓
Registered
   ↓
Available
   ↓
Launching
   ↓
Running
   ↓
Suspended
   ↓
Closed
```

异常：

```text
Running
   ↓
Crash
   ↓
Error Boundary
   ↓
Show Recovery UI
```

---

# 26. MVP 默认系统应用

MVP 至少包含以下系统 App：

| App            | 优先级 | 说明         |
| -------------- | -----: | ------------ |
| File Manager   |     P0 | 文件管理     |
| Settings       |     P0 | 系统设置     |
| Notes          |     P0 | 简单文本编辑 |
| Calculator     |     P1 | 基础计算器   |
| Terminal       |     P1 | Web Terminal |
| Browser        |     P1 | Web 浏览能力 |
| App Store      |     P1 | 应用安装     |
| System Monitor |     P2 | 系统运行状态 |

---

# 27. 主题系统

支持：

- Light
- Dark
- System

设计 Token：

```css
--color-bg
--color-surface
--color-text
--color-primary
--color-border
--radius-sm
--radius-md
--shadow-window
```

主题数据应与系统状态解耦，允许未来扩展：

- 用户自定义主题
- 第三方主题
- 动态壁纸

---

# 28. 响应式与设备支持

## 28.1 Desktop

优先支持：

- 1280×720
- 1366×768
- 1920×1080
- 2560×1440

## 28.2 Tablet

P1：

- 1024×768
- 触控操作

## 28.3 Mobile

MVP 不要求完整 Desktop UX。

P2 可提供：

- Mobile Desktop
- App Launcher 优化
- 全屏 App
- 手势窗口管理

---

# 29. 性能要求

## 29.1 启动

目标：

- 首屏可交互 ≤ 3s（中等网络、现代桌面设备）
- 已缓存状态恢复 ≤ 2s

## 29.2 窗口管理

目标：

- 普通窗口拖动保持流畅
- 交互反馈延迟目标 ≤ 100ms
- 支持至少 20 个窗口实例而不发生明显卡顿

## 29.3 内存

在正常使用 5~10 个轻量 App 时：

- 无明显持续性内存增长
- 长时间运行不出现不可恢复卡顿

## 29.4 网络

系统核心桌面应尽可能支持：

- 缓存启动
- 离线读取本地数据
- 网络恢复后同步

---

# 30. 安全需求

## 30.1 App Sandbox

第三方 App 默认处于沙箱。

原则：

```text
Default Deny
     ↓
Explicit Permission
     ↓
Scoped Access
```

## 30.2 XSS

要求：

- React 默认转义
- 禁止危险 HTML 注入
- 富文本内容必须经过清洗
- CSP

## 30.3 iframe 安全

第三方 App 若使用 iframe：

- sandbox
- allowlist
- origin isolation
- postMessage 通信校验

## 30.4 Token

要求：

- HttpOnly Cookie 优先
- 不在 LocalStorage 保存高敏感 Token
- CSRF 防护
- Session 过期

## 30.5 API 安全

- 鉴权
- 授权
- Rate Limit
- Input Validation
- Audit Log

---

# 31. 兼容性需求

最低支持：

### 浏览器

- Chrome / Chromium 最新 2 个大版本
- Edge 最新 2 个大版本
- Firefox 最新 2 个大版本
- Safari 最新 2 个大版本

对于存在兼容性差异的 API：

- File System Access API
- OPFS
- WebGPU
- Clipboard API

必须提供 Capability Detection。

示例：

```ts
if ('showOpenFilePicker' in window) {
  // enable native file integration
} else {
  // fallback
}
```

---

# 32. 可观测性

必须提供：

- 前端错误日志
- Runtime 错误
- App Crash 日志
- API Error
- 性能指标
- 用户操作事件（不得记录敏感内容）

指标：

- App Launch Time
- Window Render Time
- API Latency
- Error Rate
- Crash Rate

---

# 33. 日志系统

分级：

- DEBUG
- INFO
- WARN
- ERROR
- FATAL

开发环境：

- Console
- DevTools

生产环境：

- Remote Logging
- Error Tracking

敏感信息必须脱敏。

---

# 34. 测试策略

## 34.1 Unit Test

覆盖：

- Window Manager
- VFS
- Permission
- App Manifest
- Event Bus
- Store

## 34.2 Integration Test

覆盖：

- 登录
- App 启动
- 文件操作
- 权限申请
- API 通信

## 34.3 E2E Test

核心路径：

```text
Login → Desktop → Open App → Create File → Save → Close → Reopen
```

## 34.4 Security Test

- XSS
- CSRF
- Clickjacking
- Permission Escape
- IDOR
- File Access Bypass
- Malicious App

---

# 35. 版本规划

## Phase 0：技术验证

目标：验证核心技术是否成立。

内容：

- Web Desktop Shell
- Window Manager Prototype
- App Runtime Prototype
- VFS Prototype

产出：

- 可启动 Demo
- 3 个测试 App

---

## Phase 1：MVP v0.1

目标：可用的单用户 Web OS。

功能：

- Login
- Desktop
- Taskbar
- Window Manager
- App Runtime
- File Manager
- Settings
- Notes
- 本地存储
- 基础权限

验收：

> 用户可以完成一次完整的“打开系统 → 工作 → 保存文件 → 关闭应用”流程。

---

## Phase 2：v0.2

目标：增强可用性。

功能：

- App Store
- Calculator
- Terminal
- 通知中心
- 搜索
- 快捷键
- 文件预览
- 应用安装

---

## Phase 3：v0.5

目标：多设备云端体验。

功能：

- Cloud Sync
- 云端文件
- 用户配置同步
- App Metadata
- OAuth
- 设备管理

---

## Phase 4：v1.0

目标：开放 AgehaOS 平台。

功能：

- App SDK
- Developer Portal
- App Registry
- Permission API
- 第三方 App
- 应用审核
- 应用版本管理
- Crash Recovery
- 完整文档

---

# 36. 推荐开发里程碑

## Milestone 1：Desktop Core

- [ ] App Shell
- [ ] Desktop
- [ ] Taskbar
- [ ] Window Manager
- [ ] Event Bus

## Milestone 2：Runtime

- [ ] App Registry
- [ ] Manifest
- [ ] App Loader
- [ ] App Sandbox
- [ ] Permission API

## Milestone 3：VFS

- [ ] Virtual File Tree
- [ ] IndexedDB
- [ ] OPFS
- [ ] File Manager
- [ ] File API

## Milestone 4：System Apps

- [ ] Settings
- [ ] Notes
- [ ] Calculator
- [ ] Terminal

## Milestone 5：Backend

- [ ] Auth
- [ ] User
- [ ] API
- [ ] PostgreSQL
- [ ] Object Storage

## Milestone 6：Security & QA

- [ ] CSP
- [ ] Sandbox
- [ ] Permission Test
- [ ] E2E
- [ ] Performance Test

---

# 37. 开发任务拆分建议

## Frontend

### Desktop Team

负责：

- Desktop
- Taskbar
- Launcher
- Window Manager
- Notification

### Runtime Team

负责：

- App lifecycle
- App Registry
- App SDK
- Permission
- Event Bus

### File Team

负责：

- VFS
- File Manager
- Storage Adapter
- Sync

### System App Team

负责：

- Settings
- Notes
- Calculator
- Terminal

## Backend

负责：

- Auth
- User
- API
- File Metadata
- Cloud Storage
- App Registry

## QA

负责：

- Unit Test
- Integration
- E2E
- Security
- Compatibility
- Performance

---

# 38. API 设计原则

1. API 必须版本化。
2. API 默认最小权限。
3. API 必须可检测能力是否存在。
4. API 必须提供错误码。
5. App API 与系统内部 API 分离。
6. 不允许第三方 App 直接依赖内部实现。

示例：

```ts
ageha.files.read(path)
ageha.files.write(path, data)

ageha.window.create(options)
ageha.window.close(windowId)

ageha.notification.show(options)

ageha.permissions.request(permission)
```

---

# 39. 错误处理

所有用户可见错误应包含：

- 发生了什么
- 当前状态
- 可以执行的操作
- 是否可以重试

示例：

```text
无法保存文件

文件系统暂时不可用。

[重试] [另存为] [关闭]
```

禁止：

```text
Error: ERR_FS_0x2839
```

直接暴露给普通用户。

---

# 40. 可访问性

要求：

- 键盘可操作
- 合理 Tab 顺序
- ARIA
- 足够的文本对比度
- Focus 状态清晰
- 支持减少动画
- 不依赖颜色传达唯一信息

目标：

符合 WCAG 2.1 AA 的主要交互要求。

---

# 41. 国际化

MVP：

- 简体中文
- English

后续：

- Japanese
- Korean
- Spanish

所有 UI 文本不得硬编码。

---

# 42. 数据持久化策略

优先级：

### Local First

```text
UI
 ↓
Local Store
 ↓
IndexedDB / OPFS
 ↓
Sync Queue
 ↓
Backend
```

好处：

- 启动更快
- 离线可工作
- 减少网络依赖

冲突策略：

MVP：

- Last Write Wins

P1：

- Version Conflict
- Merge
- User Decision

---

# 43. 云同步

同步对象：

- 用户设置
- 桌面布局
- 壁纸
- App 安装状态
- 文件 Metadata
- 文件内容

不默认同步：

- 临时缓存
- Session Token
- Runtime 临时状态

---

# 44. 产品指标

MVP 阶段关注：

### 核心指标

- Desktop Ready Time
- App Launch Success Rate
- File Operation Success Rate
- Crash Rate
- Session Restore Success Rate

### 用户体验指标

- 首次进入成功率
- App 启动时间
- 文件操作耗时
- 窗口操作延迟

暂不以 DAU、商业收入作为 MVP 核心技术验收指标。

---

# 45. MVP 验收标准

## 45.1 Desktop

- [ ] 用户进入后能看到完整桌面
- [ ] Taskbar 正常工作
- [ ] App Launcher 可打开
- [ ] 桌面布局可以保存

## 45.2 Window

- [ ] 可打开至少 5 个窗口
- [ ] 可移动
- [ ] 可缩放
- [ ] 可关闭
- [ ] 可最小化
- [ ] 可最大化
- [ ] Window Z-Index 正确
- [ ] Focus 正确

## 45.3 App

- [ ] Manifest 可解析
- [ ] App 可启动
- [ ] App 可关闭
- [ ] App 崩溃不会导致整个 Desktop 崩溃
- [ ] App 权限有效

## 45.4 File System

- [ ] 创建文件夹
- [ ] 创建文件
- [ ] 上传
- [ ] 下载
- [ ] 重命名
- [ ] 删除
- [ ] 恢复
- [ ] 移动
- [ ] 复制
- [ ] 搜索

## 45.5 User

- [ ] 注册
- [ ] 登录
- [ ] Logout
- [ ] Session Restore
- [ ] Session Expire

## 45.6 Security

- [ ] 第三方 App 无法越权访问用户文件
- [ ] App 权限必须显式授权
- [ ] 高敏感 Token 不暴露给 App
- [ ] CSP 生效
- [ ] XSS 基础测试通过

## 45.7 Compatibility

在目标浏览器中：

- [ ] 登录正常
- [ ] Desktop 正常
- [ ] Window 正常
- [ ] 文件操作正常
- [ ] 核心 App 正常

---

# 46. Definition of Done

一个功能只有同时满足以下条件才算完成：

1. 代码已合并
2. 有单元测试或集成测试
3. 有必要的 E2E 测试
4. 有错误处理
5. 有 Loading / Empty / Error 状态
6. 有权限检查
7. 有必要的日志
8. 有 API / 类型定义
9. 有 UI 文案
10. 在目标浏览器验证通过
11. 相关文档已更新

---

# 47. 风险与应对

## 47.1 浏览器能力差异

风险：

不同浏览器对文件系统、后台能力、PWA 的支持不同。

应对：

- Capability Detection
- Adapter Pattern
- Fallback Storage

## 47.2 iframe 安全

风险：

第三方 Web App 可能攻击宿主环境。

应对：

- iframe sandbox
- CSP
- postMessage 校验
- Origin Allowlist

## 47.3 大文件

风险：

浏览器内存与存储限制。

应对：

- Stream API
- OPFS
- Chunk Upload
- Object Storage

## 47.4 窗口性能

风险：

大量窗口导致 DOM 和渲染压力。

应对：

- React.memo
- 虚拟化
- requestAnimationFrame
- Lazy Mount
- Suspense

## 47.5 应用生态

风险：

第三方应用质量不稳定。

应对：

- App Manifest
- Permission Review
- App Signing
- 版本管理
- Crash Isolation

---

# 48. 开发原则

AgehaOS 的核心工程原则：

### 1. Core First

先稳定：

`Window + Runtime + VFS + Permission`

再扩展应用。

### 2. API First

系统能力必须通过稳定 API 暴露。

### 3. Sandbox First

第三方应用默认不可信。

### 4. Local First

优先保证本地体验，再加入云同步。

### 5. Progressive Enhancement

浏览器支持更强能力时增强体验，不支持时保持基础可用。

### 6. Modular

Desktop、Runtime、VFS、Auth、Backend 之间保持清晰边界。

---

# 49. 推荐 MVP 技术栈

## Frontend

```text
React
TypeScript
Vite
Zustand
TanStack Query
Tailwind CSS
React Router
Vitest
Playwright
```

## Backend

```text
Node.js
TypeScript
Fastify / NestJS
PostgreSQL
Redis
S3 Compatible Storage
```

## Infrastructure

```text
Docker
Nginx / Caddy
CI/CD
Object Storage
Error Tracking
Monitoring
```

---

# 50. 第一版最小可运行范围

为了避免项目一开始过大，建议 v0.1 严格控制在：

```text
AgehaOS v0.1
│
├── Login
├── Desktop
│   ├── Wallpaper
│   ├── Desktop Icons
│   └── Taskbar
│
├── Window Manager
│   ├── Open
│   ├── Close
│   ├── Move
│   ├── Resize
│   ├── Minimize
│   └── Maximize
│
├── App Runtime
│   ├── Manifest
│   ├── App Registry
│   └── Permission
│
├── System Apps
│   ├── File Manager
│   ├── Settings
│   └── Notes
│
├── VFS
│   ├── IndexedDB
│   └── OPFS
│
└── Local Session
```

**暂缓：**

- App Store
- 第三方应用市场
- 云端文件同步
- OAuth
- 多用户组织
- AI Agent
- 虚拟机
- 多显示器
- Mobile Desktop

---

# 51. 建议的首个开发顺序

```text
01. Project Bootstrap
        ↓
02. Desktop Shell
        ↓
03. Window Manager
        ↓
04. Event Bus
        ↓
05. App Registry
        ↓
06. App Runtime
        ↓
07. Permission System
        ↓
08. VFS
        ↓
09. File Manager
        ↓
10. Settings
        ↓
11. Notes
        ↓
12. Login / User
        ↓
13. E2E Test
        ↓
14. Performance / Security
        ↓
15. v0.1 Release
```

---

# 52. 最终产品形态

长期目标：

```text
                 AgehaOS
                    │
       ┌────────────┼────────────┐
       │            │            │
    Desktop      Runtime        Cloud
       │            │            │
   Window       App SDK       Storage
   Taskbar      APIs          Sync
   Launcher     Sandbox       Account
       │            │            │
       └────────────┼────────────┘
                    │
                App Ecosystem
```

AgehaOS 最终应成为一个：

> **以浏览器为载体、以桌面环境为入口、以 Web App Runtime 为核心、以文件与权限系统为基础、可扩展并支持云同步的 Web Operating System Platform。**

---

# 53. 文档协作约定

建议仓库结构：

```text
/docs
  ├── PRD.md
  ├── ARCHITECTURE.md
  ├── API.md
  ├── SECURITY.md
  ├── APP_SDK.md
  └── CONTRIBUTING.md
```

Issue 建议分类：

```text
feat
fix
refactor
security
performance
docs
test
```

Branch 建议：

```text
main
develop
feature/*
fix/*
hotfix/*
```

提交信息：

```text
feat: add window manager
fix: repair file delete flow
refactor: simplify app runtime
docs: update app sdk
test: add vfs integration tests
```

---

# 54. PRD 完成定义

本 PRD 作为 AgehaOS 第一阶段产品基线。

后续开发中若新增能力，应至少明确：

- 为什么需要该功能
- 用户是谁
- 解决什么问题
- 依赖哪些系统能力
- 安全边界是什么
- 如何测试
- 如何验收
- 是否影响现有 API

所有新增需求原则上通过：

`Issue → Design → Implementation → Test → Review → Merge`

进入产品主线。
