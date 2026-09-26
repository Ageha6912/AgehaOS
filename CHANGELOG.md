# 更新日志

本文件遵循 Keep a Changelog 风格，版本号遵循语义化版本。

## [Unreleased]

### 自动隐藏任务栏（docs/DESIGN.md §9，用户裁决）

- 任务栏默认整体藏于屏幕底缘之外：指针触底（6px 唤出区，压在窗口层之上）或键盘焦点进入任务栏控件时 300ms ease-out 缓滑入场；离开任务栏子树（含菜单/悬停预览等浮层）400ms 缓冲后滑出
- 背景弃用玻璃面板，改为随主题的底部渐变纱（`from-bg/85`，无描边）——视觉透明融进壁纸且深浅照片下文字可读
- 工作区不再为任务栏预留高度：窗口层铺满视口（`getWorkspaceViewport` = 整个视口）、桌面图标网格高度解除 48px 预留、最大化窗口全屏
- 关键修复：唤出区也要安排收起——静止指针下任务栏滑入不触发 pointerenter（hover 链只在指针移动时刷新），跳离场景只有唤出区 leave 可靠；真实浏览器 E2E 抓获
- E2E：新增 `e2e/helpers.ts#revealTaskbar` 辅助并适配全部既有 spec 的任务栏交互；新增 taskbar-autohide spec（默认隐藏/唤出/收起/唤出后启动）

### 应用徽章图标系统与桌面图标层（docs/DESIGN.md §8）

- 七个内置应用统一换装「圆角徽章」图标：冷色系双色渐变底 + 白色填充字形，几何/投影/发丝内圈完全统一，色相限制在蓝白邻近域（钴蓝/紫/靛/天蓝/青/石墨）；未知应用回落石墨蓝通用徽章（配置 `src/apps/app-badges.ts`，渲染 `AppIcon`）
- 图标站点全量迁移：任务栏项、开始菜单、任务栏悬停预览（头 20 / 体 48 水印）、全局搜索、窗口标题栏（新增）；`APP_UI_META.icon`（16px 线性字形）退役，视觉身份收敛到单一来源
- 新增桌面图标层 `DesktopIcons`：全部内置应用固定于桌面左上纵向网格（空白区域指针穿透），单击选中（钴蓝外圈 + 标签底色）、双击/回车启动、图标外指针按下清除选中；标签白字深投影保证照片壁纸可读
- 修复 WindowLayer 透明容器拦截指针事件的问题（容器 `pointer-events-none`、窗口本体 `pointer-events-auto`）——该缺陷使任何位于 z-30 层之下的可点元素失效，由新 E2E 抓获

### 管理员角色与远程目录发布（ADR 20，PRD §47 应用审核前置）

- 角色：`UserRecord.role`（'user' | 'admin'）；`AGEHA_ADMIN_USERNAME` 引导——该用户名注册即 admin，既有同名用户每次启动幂等提升（可追溯生效于存量库）；三驱动存储跟进（pg 补 `role` 列）
- 首个管理能力：`GET/PUT /api/store/admin/catalog`（仅 admin）——发布远程目录，服务端白名单深度校验（entry 钳制 `/apps/sites/<name>/index.html`、权限 ⊆ MVP 名单、字段恰 8 项、≤50 条）；公共 `GET /api/store/catalog` 优先返回已发布目录并照常 Ed25519 签名分发
- 前端：远程模式下 admin 可见设置「远程目录」面板（列表/移除/JSON 追加发布，双语文案与结构化错误提示）；账户区「管理员」徽标；商店合并时内置清单优先于同 id 远程条目；本地模式不存在 admin
- 真实后端双角色烟雾通过：boss 注册即 admin → 面板发布计数器 → 服务端落盘 → 普通用户商店见「远程」徽标条目，且无管理面板与徽标

### 应用套件设计翻新 · 蓝白渐变「精密仪表」（docs/DESIGN.md，ADR 19）

- grilling 共识（taste-skill 自由方向、浅色基线、全局 Token 跟随、CSS-only 动效）+ 试点裁决修订（蓝白渐变）；方向唯一权威定义见 `docs/DESIGN.md`
- Token 全局换装：浅色基线 = 白→淡蓝渐变大面（`.surface-panel`/`.surface-canvas`，实色兜底）、深色适配 = 藏蓝墨渐变；单一钴蓝强调、蓝墨文字、圆角收紧 4/8/12、玻璃材质转蓝白调（chrome 专用，应用内部不透明渐变面板）
- 浅色成为新用户默认主题（存量偏好不动）；壁纸质量门 INK 常量同步；Playwright 钉住 `colorScheme: 'light'`；桌面回落画布与登录屏改 Token 渐变（v0.1 暖色硬编码退场）
- 七应用全部落位：Files（试点：Phosphor 侧栏/等宽面包屑/构图空态/mono 状态栏）、Terminal（内嵌输出井 + 修复硬编码黑底对比缺陷）、Notes（图标化 + 编辑井 + 空态）、Settings（共享药丸 ToggleSwitch 替换按钮伪装开关、侧栏统一 w-44、分段控件规范化、版本入等宽层）、Store/Calculator/动态面板（渐变根面 + 11px 等宽徽标层、计算器等宽表数）
- emoji 全面退出系统 UI（品牌 🦋 除外）；跨应用不一致清单（页头三分/按钮三档/图标割裂/字号碎片）全部归案；每片双主题截图过视觉审查（试点 4/4、铺开 12/12）

### 远端应用目录·签名目录（PRD §47 前置切片，ADR 18）

- 服务端 `GET /api/store/catalog`：Ed25519 签名目录（密钥持久化于数据目录、keyId 为公钥短哈希），载荷经稳定键序规范化 JSON 签名
- 客户端 `core/apps/remote-catalog.ts`：WebCrypto 验签 → parseManifest + 同源 allowlist 过滤 → 合并进 App Store 并带「远程」徽标；任何一步失败整包拒绝，商店显示签名校验失败提示
- 公钥钉扎：生产以 `VITE_STORE_CATALOG_PUBLIC_KEY` 把发布方公钥钉进构建（本地开发未钉扎时信任服务端下发键）
- 新增远程样例「计数器」（仅经远程目录发布）；服务端签名/篡改/持久化与客户端验签/allowlist/钉扎均有测试；真实后端烟雾完成安装

### 云文件同步·文件级三方合并与冲突副本（PRD §35 Phase 3，ADR 17）

- 快照格式 v2（逐文件 cyrb53+长度哈希）：每次同步 = GET 服务端树 → 纯函数三方合并（`core/sync/file-merge.ts`，base/本地/服务端逐文件）→ 应用下载/删除/冲突副本 → PUT 合并树 → 推进本地基线
- 冲突不丢数据：编辑/编辑相撞 → 本地保留原地 + 服务端版本另存 `<name>.conflict-<savedAt><ext>`；编辑与删除相撞 → 编辑赢；基线未知时以服务端为基线，避免升级/首拉产生虚假冲突
- v1 整快照 blob 兼容（旧标记/旧数据走「服务端赢整体应用」后即转 v2）；空目录删除不参与同步
- 真实后端双上下文验证：A 建笔记 → B 并发修改 → A 再改 → 服务端同时保有三方（A2 原文 + B 版冲突副本），无数据丢失

### SDK 全 API 面（PRD §17 收口）与 APP_SDK.md 开发者文档

- 新增免许可只读三 API：`AgehaOS.user.get()`（最小身份：username/displayName，无邮箱/头像/会话）、`AgehaOS.permissions.all()`（本应用授权清单）、`AgehaOS.system.info()`（version/locale/tier 环境事实）
- 新增 `docs/APP_SDK.md`：运行模型、权限表、8 个 API 契约与配额、错误码表、示例应用指引（PRD §42 仓库结构项）
- 修复面：`parseSdkRequest` 运行时 API 白名单与 `SdkApi` 类型面的同步由回归测试固化（类型加了、白名单漏了会导致静默超时——真实浏览器烟雾抓到后已修）

### SDK Notification/File API（PRD §17）

- 沙箱桥能力面扩至 5 个 API（window/storage/theme/notification/files），`handleSdkRequest` 改为异步以承载文件操作；权限解析改为按（api, action）——`files` 读/列需 `filesystem.read`，写/建/删需 `filesystem.write`（§10.1）
- File API 按应用授权：路径一律钳制在应用专属目录 `/Apps/<appId>/` 内（拒绝 `..` 上跳/控制字符/越界），单文件 ≤256KB；删除沿用回收站语义；VFS 端口以注入式 `SdkFilePort` 适配（`src/services/sdk-file-port.ts`）
- Notification API：应用发送字面文本通知（去控制字符、标题 ≤64/正文 ≤200），进宿主通知中心（toast + 历史）；通知 store 支持字面 `title/body`（SDK 应用内容）与词典键（系统文案）双轨渲染
- 客户端库 `AgehaOS.notification.show` / `AgehaOS.files.{read,write,list,mkdir,remove}`；新增 App Store 样例「云笔记」（fs-note）与 E2E 全链路验收（安装→授权→写笔记→重开恢复→发通知）

### 云文件同步引擎·文本切片（PRD §35 Phase 3「云端文件」+ §42 Local First）

- 后端同步 KV 按域分键：`GET/PUT /api/sync/data/:domain`（`settings` / `files`），无键路由保留为 settings 别名；三驱动跟进——file 存储旧扁平形状读取时自动迁移进 settings 域，postgres 以 `(user_id, domain)` 唯一索引迁移（自动补 `domain` 列、重建主键为唯一索引）
- 前端 `file-sync` 服务：登录拉取（仅当服务端 `savedAt` 新于本机同步标记时应用，服务端赢；本机离线改动照常上推——整快照 last-writer-wins）、`file.*` 事件防抖上推（本地赢）、`applying` 回声防护、快照超 256KB 跳过上推并发一次性通知
- 会话中途开启同步开关（设置 → 账户 → 云同步，文案现涵盖文件）立即触发拉取/上推；根级系统目录（Desktop/Documents/… 受保护）不可整删——保留外壳、清空内容；回收站不参与同步（设备本地语义）
- 双上下文真实后端联调通过：A 注册→开同步→建文件→服务端落盘，B 同账户登录→开同步→文件可见

### 真实照片壁纸（Phase A.6，动态桌面）

- 用户裁决「程序山水大同小异，要真实风景照片」：新增 `photo` 壁纸风格并成为唯一主动采样域；程序化山水与抽象风格退出采样域（代码保留供旧计划重放）
- 16 张人工目检的真实风景照打包于 `public/wallpapers/landscapes/`（1920px JPEG，同源加载零联网），全部来自 Wikimedia Commons 自由许可（CC0/CC BY/CC BY-SA），署名见目录元数据与 `CREDITS.md`
- 主题适配：亮调照片配浅色主题、暗调配深色主题（mood 池）；会话级 `recentPhotoIds` 优先排除近期用过的照片；渲染以 `<img>` cover 呈现，加载失败回落渐变并转「壁纸失败」通知
- 「AI 生成」徽标对照片计划隐藏——照片是人类摄影师的作品，AI 仅参与自动选片；自动换新频率沿用随机度档

### 山水引擎（Phase A.5，动态桌面）

- 壁纸生成 v2：`buildLandscapeScene` 程序化山水——天空渐变、日/月辉光、星空、三层中点位移山脊（大气透视色阶）、雾带、水面涟漪、飞鸟；全部由种子确定性派生，渲染层零随机
- 6 组山水调色板（晨雾/晴岚/青绿/水墨/暮色/星夜，浅深主题各半）；抽象色块风格退出随机采样域（代码保留供旧计划重放）
- 自动随机切换：按随机度档定时换新（微调 15min / 平衡 10min / 探索 6min / 狂野 3min；固定档不自动），隐藏页与固定态跳过

### 内容过滤管线与举报通道（DDS §8.4/§8.6，Phase C 切片）

- `src/core/dynamic/content/filter.ts`：渲染前三类本地过滤——violation（违规词库）/ misleading（联系方式引流、裸链接无来源）/ discomfort（重复刷屏、喊话式全大写）
- LLM 自由文本（Phase C）在通过过滤后可进入提示卡，词表变体（Phase B）路径保持不变；未知槽位仍一律丢弃
- 提示卡自由文案带「举报」按钮：点击立即撤下回落词典模板 + `ai.content.blocked {reason:'reported'}` + 会话封禁该文本；样本上传通道待基础设施接入（不上传即不涉及同意）
- 服务端分类器、样本上传、跨会话黑名单归 Phase C 完整交付

### 设备管理与配置同步（PRD §35，v0.5 前置切片）

- 会话元数据：登录/注册记录 `createdAt` 与设备短标签（User-Agent 解析），旧数据缺省容忍
- 设备管理：`GET /api/auth/sessions`（token 短哈希为 id，本体不出服务端）+ `DELETE /api/auth/sessions/:id`；Settings「账户」区列出登录设备并支持逐条撤下
- 配置同步：`GET/PUT /api/sync/data`（按用户哑 KV，≤256KB）+ 前端 `settings-sync` 服务（boot 拉取应用、本地改动防抖上推、回声防护），Settings 开关默认关、仅远程模式显示
- 修复：远程模式注册即登录，不再产生重复会话；客户端空 body 不再声明 json content-type（Fastify 会判 400）

## [0.2.0] - 2026-09-23

v0.2 功能面（PRD §35 Phase 2 全清单）+ 应用生态 + AI 动态桌面三域 + Milestone 5 后端认证。

### 后端认证服务（Milestone 5，PRD §20/§30.4）

- `server/`：Node.js 24 + Fastify 5 认证 API——注册/登录/登出/会话/当前用户端点，错误码与前端 `AuthErrorCode` 对齐（契约见 `docs/API.md`）
- 会话令牌迁移：256-bit opaque token 仅存 `agehaos_session` HttpOnly Cookie（SameSite=Lax，生产 Secure），JS 不可读、不入 LocalStorage；服务端会话表登录轮换、登出即删、惰性过期清理
- 存储：`DataStore` 接口 + memory / file（JSON 原子写，重启持久化）/ postgres（幂等建表 + 参数化 SQL，驱动就绪待活库验证，附 `server/docker-compose.yml`）三驱动
- 安全：scrypt 口令哈希（N=2¹⁵/r=8/p=1，参数随哈希存储）、登录失败等时防账号枚举、CSRF Origin 校验（配合反代 X-Forwarded-Host + trustProxy）、按 IP 路由限流（login 10/min、register 20/min）、helmet 安全头、pino 结构化审计
- 前端接线：`systemAuthService` 升级为可切换 `AuthProvider` facade（默认本地实现，行为不变），新增 `RemoteAuthClient` 与 boot 期 `reconcile()`；`VITE_AUTH_BACKEND=1` 启用远程模式（同源 `/api` 经 Vite 代理），UI 与 store 零改动
- 工具链：`npm run dev:server / start:server / test:server`，typecheck 与 `npm run test` 覆盖前后端双套件

### 用户资料与会话管理（PRD §12.1）

- 后端：`PATCH /api/users/me`（昵称/邮箱/头像，缺省不变、显式 null 清除）、`POST /api/users/me/password`（校验当前密码，成功后自动吊销其他会话）、`POST /api/auth/sessions/revoke-others`（登出其他设备）；`UserRecord` 扩展 `displayName`/`email`/`avatar`，Postgres 迁移自动补列
- 头像：客户端 canvas 缩放为 128×128 JPEG data URL（体积与原图无关，≤64KB 字符），格式白名单 png/jpeg/webp 前后端双重校验；任务栏与账户区展示
- 前端：Settings 新增「账户」区（头像 / 资料保存 / 修改密码 / 会话安全），任务栏用户菜单显示昵称与头像；`AuthProvider` 增加 `updateProfile` / `changePassword` / `revokeOtherSessions`，本地与远程模式同等可用

### 桌面编排建议（DDS §5.1 域②，本地规则切片）

- `src/core/dynamic/layout/engine.ts`：纯函数布局建议引擎——档位三选一（单列/双列/宫格）+ i18n 键分组（≤4 组 × ≤8 个），输出经 schema 自校验；永不随机清单应用（files/notes/settings）绝不进入建议成员
- 动态面板新增「桌面编排建议」卡（开启动态桌面时），带「应用到开始菜单 / 恢复默认布局」；发 `desktop.layout.suggested` 与 `ai.decision.performed {domain:'layout'}`
- 开始菜单采纳渲染：系统应用固定顶部，AI 分组带标识，档位决定菜单宽度；渲染前裁剪已卸载成员，采纳结果按用户持久化

### 终端应用（PRD §26，v0.2 收口）

- `src/core/terminal/shell.ts`：伪 Shell 引擎 over VFS——pwd/ls/cd/cat/echo/mkdir/touch/rm/date/whoami/clear/help 十二命令，相对路径与 `..` 解析，输出结构化（i18n 键 + tone），rm 走回收站语义
- `com.ageha.terminal` 内置应用（零权限，660×440 可调）：等宽 UI、自动滚底、↑↓ 命令历史召回

### 全局搜索与快捷键（PRD §15/§26，v0.2 基础集）

- Ctrl/⌘+K 呼出搜索面板：应用（展示名/名称/appId 三路匹配、前缀优先、≤5 条）+ 文件（VFS 根检索、≤5 条）双域，↑↓/Enter 键盘导航，Esc 关闭
- 系统快捷键（window capture 级）：Ctrl/⌘+K 搜索、Esc 关闭面板、Alt+W 可见窗口焦点轮转（跳过最小化）
- 文件结果暂落 Files 应用；携参启动（§24.3）、设置/命令/最近项目/AI Search 属后续

### 通知中心（PRD §16）

- `notification-store`：推送/已读/全部已读/单删/清空，30 条 LRU；文本存 i18n 键 + `bodyParams`，新增 `formatMessage` 占位插值
- 桌面 toast（右上角，critical 8s / normal 4.5s，点击即读）+ 任务栏通知中心（铃铛 + 未读徽标 + 历史面板）
- 系统事件桥接：`app.crashed` → critical 通知（带应用名）、`desktop.generation.failed` → 通知

### LLM 同源代理与深度增强（DDS §5.3，Phase B 切片）

- 后端 `POST /api/ai/proxy`：schema 白名单 + API Key 不下发 + 匿名 ID 不上游转发 + 2s 超时 + 响应过滤 + 限流；未配置 Key 时 503（契约见 `docs/API.md`）
- 前端 `src/core/dynamic/llm/client.ts`：一次性匿名 ID、2s 超时、会话重试 ≤1、Phase B 词表门控（LLM 仅从提示卡变体白名单中选，自由文本不渲染）+ 会话缓存；降级链 LLM → 缓存 → 本地模板，装配永不被阻塞
- 动态面板：`prefs.llmEnhance` 开关（Settings 动态桌面区，默认关）；增强成功后提示卡渲染选中变体、页脚决策来源三值可查（本地规则/云端模型/缓存重放）

## [0.1.0] - 2026-09-21

AgehaOS 首个 MVP 版本（对应 PRD Phase 1 / §50 最小可运行范围）。

### 桌面环境

- 启动流程：Boot Screen（booting → loading）→ 会话检查 → 桌面 / 登录页（PRD §23.1/§24.1）
- 桌面：壁纸渐变、开始菜单启动器、任务栏（运行窗口切换、时钟、用户菜单）
- 窗口管理器：拖拽、缩放、最小化/最大化/还原、焦点与 z 序、层叠定位、几何约束（PRD §7）

### 系统应用

- 文件：目录浏览、面包屑、新建文件夹/文本文件、重命名、删除进回收站、还原/彻底删除、目录内搜索、只读预览（PRD §23.4）
- 记事：基于 VFS 的文本编辑器，新建防覆盖、脏状态保存（PRD §26）
- 设置：主题（浅色/深色/跟随系统）、字体大小、界面语言（简体中文/English）、权限总览、关于（PRD §14/§27/§41）

### 系统平台

- 应用系统：Manifest 全量校验（反域名 id、semver、权限白名单）、AppRegistry、窗口事件推导的应用生命周期、崩溃隔离与恢复 UI（PRD §8/§9/§25）
- 权限系统：Default Deny、显式授权持久化、启动门禁与 `permission.denied` 审计（PRD §10）
- 虚拟文件系统：默认目录树、CRUD、回收站、搜索、`file.*` 事件、IndexedDB 存储适配器与能力检测降级（PRD §11/§31）
- 用户系统：本地注册/登录/登出，盐值 SHA-256 口令哈希，7 天过期会话（PRD §12）
- 基础设施：类型化事件总线（PRD §22）、双主题设计 Token（PRD §27）、中英双语 i18n（PRD §41）

### 质量与安全

- 222 项单元/组件测试 + 4 项 Playwright E2E（含核心路径 §34.3、3 秒可交互 §29.1、20 窗口压力 §29.2）
- 生产构建 CSP、`no-referrer`、无原生 HTML 注入（PRD §30.2，详见 docs/SECURITY.md）

### 暂缓（按 PRD §50）

App Store 与第三方应用、云同步、OAuth、移动端、iframe/SDK 应用类型（Type B/C）、后端服务（Milestone 5）。
