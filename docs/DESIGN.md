# AgehaOS 设计方向 · 「Calm Future」玻璃语言（Token 2.0）

> 2026-09-30 用户裁决（grilling 共识，ADR 24）：启动 UI 全面视觉升级 Phase 1，
> 视觉权威 = 仓库根《AgehaOS UI 全面视觉升级.png》（永不提交，只可缩放裁切）；
> 布局骨架以升级提示词 §45 为准（顶栏 + 浮动窗口 + 底部 Dock）。方向由
> 「蓝白渐变·精密仪表」升级为 **「Calm Future」玻璃语言**：Japanese Futuristic
> × Modern SaaS——中性冷白/冷墨基底 + 白玻璃 chrome + 单一品牌强调，
> 层次靠 surface/shadow/blur 刻度而非发光；95% 中性、5% Ageha 强调。
> 默认主题翻转为**深色**（贴合权威图暗曙光彩；存量偏好一律不动）。
> 七项开工裁决与既有用户裁决的覆盖关系见 §17。
>
> 历史裁决存档：2026-09 grilling（taste-skill 自由方向、全局 Token 跟随、
> CSS-only 动效）；2026-09-26 配色改蓝白渐变。本文仍是方向的唯一权威定义；
> 拨盘：VARIANCE 3 / MOTION 2 / DENSITY 5-6（产品 UI 要可预期性，不是营销页
> 的表现力）。

## 1. 一句话方向

**蓝白渐变纸面上的精密仪表**：白→淡蓝的渐变大面（浅色基线）/ 藏蓝墨渐变
（深色适配）+ 单一钴蓝强调 + 等宽数据层。系统应用看起来像「被精确加工过的
仪器面板」，而不是「被装饰过的网页」。渐变只属于大面（画布与应用面板根），
控件一律实色——层次靠材质分工，不靠花哨。

与旧方向（warm-stone + teal + 圆润玻璃）的根本区别：中性轴从暖转蓝白渐变、
强调色从青绿转钴蓝、圆角收紧一档、数据元素（路径/计数/时间戳）进入等宽
字体层、emoji 全部退出系统 UI（品牌 🦋 除外，既有用户裁决）。

## 2. 设计 Token（双主题）

### 2.1 色彩

| Token | 浅色（基线） | 深色（适配） | 用途 |
| --- | --- | --- | --- |
| `--ag-bg` | `#eef4fd` | `#0c1220` | 画布基底色（渐变兜底） |
| `--ag-canvas` | `白→#dcebfb` 168° 渐变 | `#131e36→#0a0f1c` 渐变 | 登录/boot 画布（body 背景） |
| `--ag-surface` | `#fbfdff` | `#141b2b` | 应用面板实色（控件/内嵌区的兜底与渐变底色） |
| `--ag-panel` | `#fdfeff→#f3f8ff` 渐变 | `#172130→#121828` 渐变 | 应用页根大面（`.surface-panel`） |
| `--ag-surface-raised` | `#edf3fc` | `#1b2438` | 凹槽、悬停、内嵌区 |
| `--ag-text` | `#18202c` | `#e6ecf7` | 蓝墨色（非纯黑/白） |
| `--ag-text-muted` | `#5a6b82` | `#94a3bf` | 次级文本（对浅面板 ≥4.5:1） |
| `--ag-primary` | `#2f5fe8` | `#82a3ff` | 唯一强调色：焦点/选中/主动作 |
| `--ag-primary-contrast` | `#f7f9ff` | `#0d1220` | 强调色上的文字（双向 ≥4.5:1） |
| `--ag-border` | `#d9e3f4` | `#263149` | 分隔线 |
| danger / success / warning | `#dc2626` / `#059669` / `#b45309` | `#f87171` / `#34d399` / `#fbbf24` | 语义色，按主题两档 |

玻璃材质（chrome 专用：Dock/开始菜单/窗口标题区/顶栏）：浅 `rgb(255 255 255 / 72%)`
/ 深 `rgb(16 23 40 / 66%)`，蓝白调，blur 28px（`--ag-blur-lg`）；应用内部一律
不透明渐变面板——**玻璃归 chrome，纸面归应用**，材质分层即层级。
（§21 裁决：窗体纸面维持不透明——主题池配色明暗同侧，半透明纸面对比度
收益为负；全应用纸面半透明留待后续应用套件单独评审。）

### 2.1.1 Token 2.0 扩展（2026-09-30 起，ADR 24）

在 v1 Token 之上**扩展**（v1 名保留为别名，`--ag-surface-raised →
--ag-surface-soft`、`--ag-brand → --ag-primary`；新代码一律用 v2 名）：

| 组 | Token | 说明 |
| --- | --- | --- |
| Surface 层级 | `--ag-surface-soft / -elevated / -popover / -modal` | 凹槽悬停 / 悬浮卡 / 弹层玻璃实色兜底 / 模态；浅 `#edf3fc·#ffffff·#f9fbff·#ffffff`，深 `#1b2438·#1e2a42·#16213a·#1a2540` |
| 文字层级 | `--ag-text-tertiary / -disabled` | 辅助说明 / 禁用 |
| 边框层级 | `--ag-border-subtle / -strong` | 弱分隔 / 强分隔 |
| 强调族 | `--ag-brand(-strong/-soft)` | v1 primary 的语义别名（主动作/焦点/选中） |
| Accent 族 | `--ag-accent-blue/indigo/violet/cyan/pink` | 数据/徽章语义专用，不作 UI 主色（95/5 原则） |
| 状态 | `--ag-info` | 与 danger/success/warning 同列 |
| 阴影五档 | `--ag-shadow-soft/panel/window/popover/modal` | 柔和弥散低透明，「浮起来」而非「压下去」；`window-flat` 保留 |
| 模糊三档 | `--ag-blur-sm/md/lg`（12/20/28px） | 玻璃只属于 chrome（Dock/窗口/启动器/搜索/弹层/通知/系统中心） |
| 遮罩 | `--ag-scrim / -strong` | 搜索背板 / 模态遮罩，替换散落的 `bg-black/*` |
| Shell 几何 | `--ag-menubar-height(32) / --ag-dock-height(68) / --ag-dock-item-pitch(48) / --ag-dock-icon(24)` | 顶栏与浮动 Dock 的契约值；pitch 48 = 波浪 σ44 的几何前提，勿动 |
| 桌面图标标签 | `--ag-desktop-label / -label-shadow` | 壁纸上唯一样式，随主题翻色（原白字硬编码收编，见 §17） |

Token 存在性与别名关系由 `src/index.css.test.ts` 契约测试钉住。

### 2.2 形状（Token 2.0 刻度，2026-09-30）

`radius: sm 8 / md 12 / lg 16 / xl 20 / pill 9999`（v1 的 4/8/12 就地升级）。
规则：控件与行 = md，浮层（窗口/菜单/对话框）= lg，主入口大面（启动器/
搜索/Dock 容器）= xl，微小 chrome（标题栏按钮）= sm，胶囊（Dock 外壳/
指示点）= rounded-full。

### 2.3 排版（三层 + 等宽数据层）

| 层 | 规格 | 用途 |
| --- | --- | --- |
| 标题 | `text-sm font-semibold` | 页头、区块名 |
| 正文 | `text-sm` / `text-xs` | 列表、表单、说明 |
| 注释 | `text-xs text-text-muted` | 辅助说明 |
| **等宽数据层** | `font-mono text-[11px] tabular-nums` | 路径、计数、时间戳、版本号——方向的签名元素 |

字体族维持系统栈（local-first，零网络字体）；字体的「身份」来自字重/字距/
等宽层的纪律，而非换字体。未来可选自托管拉丁显示字体，非本期决策。

### 2.4 图标

Phosphor 单族（既有依赖），四种标准尺寸：**14**（行内/列表行）、**16**（工具栏）、
**20**（应用图标）、**28**（网格瓦片）。文件夹/文件用 `weight="fill"`，操作用
`regular`。系统 UI 内 emoji 一律清除（品牌 🦋 除外）。

### 2.5 动效

沿用 motion tokens（fast 120ms / base 200ms，transform+opacity only），
`prefers-reduced-motion` 已全局折叠。不新增任何循环动画——仪表不闪烁。

## 3. 组件规范（应用页共用）

- **按钮一档**：默认 `h-7 px-2.5 rounded-md border text-xs`；主动作
  `bg-primary text-primary-contrast border-transparent`；危险动作 ghost
  `text-danger border-transparent hover:bg-danger/10`；disabled 统一
  `opacity-40`。
- **选中态**：`border-primary bg-primary/10`（+ 文字不变色——选中靠框不靠染）。
- **空态**：居中构图 = 图标（28-40，muted 半透明）+ 标题（text-sm）+ 提示
  （text-xs muted，指向可用动作）。
- **加载态**：`role=status` + 脉冲点，不转圈。
- **状态栏（工具型应用页脚）**：`border-t` + 等宽 11px + muted——承载计数/
  路径/上下文，是「仪表」气质的落点。
- **页头三分归一**：所有应用页统一 `px-4 h-10 border-b` 工具栏节奏（标题或
  面包屑在左、动作在右），Files 的面包屑即其页头形态。
- **滚动列表**（2026-09 增补）：一律 `ScrollFadeList`（`.scroll-thin` 常驻
  6px 主题色细滚动条 + 「有溢出且未到底」时的底部 28px 渐隐遮罩
  `from-surface`）——悬浮式滚动条在 Windows 下悬停前不可见，末行截断时
  用户无从判断可滚；常驻细条 + 渐隐双通道解决。已落 Store 列表与
  通知中心历史。

## 4. 密度分档（按职能）

| 档 | 应用 | 特征 |
| --- | --- | --- |
| 紧 | Files、Terminal | 行高紧凑、网格瓦片 ~104px、状态栏常驻 |
| 中 | Notes、Settings | 表单与列表的标准节奏 |
| 松 | Store、动态面板 | 卡片留白多一档（既有结构已接近） |

## 5. 盘点问题归案

| 盘点发现 | 本方向的处置 |
| --- | --- |
| 页头三分 | §3 页头规范归一（试点：Files 面包屑工具栏） |
| 图标语言割裂 | §2.4 四档尺寸 + Phosphor 全覆盖 |
| 按钮三档 padding | §3 按钮一档 |
| 圆角 md/lg 混用 | 形状规则已有，Token 收紧后全局一致 |
| 空态纯文本 | §3 空态构图 |
| 字号碎片化 | §2.3 四层 + 等宽数据层；`text-[10px]` 全面上调至 11px/等宽层 |
| Terminal 硬编码底色 | 改 `bg-surface` 跟随主题（缺陷修复） |
| 侧栏 w-40/w-44 | 统一 `w-44` |
| 预览遮罩手写 | 试点内改为统一的浮层材质（surface + shadow-window） |

## 6. 主题基线迁移

- 新用户默认主题 `dark` → `light`（`DEFAULT_THEME`）；存量用户已保存偏好
  一律不动；`system` 仍可选。
- **2026-09-30（ADR 24）：默认主题再翻转为 `dark`**——「Calm Future」基线
  贴合视觉权威图的暗曙光彩；存量已保存偏好依旧一律不动（含 light）。
- 壁纸引擎 INK/SURFACE 质量门常量随 Token 同步（冷墨值），山水调色板对比
  度门禁复跑验证。Token 2.0 未动 `--ag-text/bg` 基准色，INK 常量本轮无需跟随。
- E2E 在 Playwright 中钉住 `colorScheme: 'light'` 保证确定性（浏览器渲染
  偏好，与应用主题默认值无关，维持不动）。

## 7. 铺开顺序（试点后）

Files（试点）→ Terminal（含主题修复）→ Notes → Settings → Store → Calculator
→ 动态面板 → 外壳 chrome 微调收口。每片：实现 → 测试 → 四门禁 → 双主题截图
过 visual-judge → 独立提交。

## 8. 应用徽章图标系统

每个应用一枚「圆角徽章」：冷色系双色渐变底 + 白色填充字形。三层来源
（`src/apps/app-badges.ts`，渲染于 `AppIcon`）——

1. **精选**：7 内置应用 + 5 商店样本手工配色（见下表）；
2. **生成**：任何未知应用（用户安装/管理员发布的每一个新应用）由 appId
   哈希（djb2）确定性选取「色板 × 字形」组合——同一应用永远同一徽章，
   新应用零成本获得设计感图标；同一构建内置 12 色板 × 10 字形；
3. 色板全部取自蓝白基调邻近冷色域，几何完全统一——24% 圆角、150° 渐变、
   `ring-white/25` 发丝内圈、同规格投影。

| 应用 | 渐变 | 字形 |
|---|---|---|
| 文件 Files | `#3b6cf6 → #1d43b8` 钴蓝 | FolderOpen |
| 记事 Notes | `#8b6cf2 → #5a3ed0` 紫 | NotePencil |
| 设置 Settings | `#64748b → #3f4c63` 石墨 | GearSix |
| 应用商店 Store | `#22a7f0 → #0369a1` 天蓝 | Storefront |
| 计算器 Calculator | `#6d75f8 → #4338ca` 靛 | Calculator |
| 动态面板 Panel | `#1fb8a6 → #0f766e` 青 | Newspaper |
| 终端 Terminal | `#3a4761 → #1c2434` 藏青 | TerminalWindow |
| 时钟 samples.clock | `#22d3ee → #0e7490` 青 | Clock |
| 画板 samples.sketch | `#c084fc → #7e22ce` 紫罗兰 | PaintBrush |
| 便签 samples.sticky | `#818cf8 → #3730a3` 靛蓝 | NotePencil |
| 云笔记 samples.fs-note | `#38bdf8 → #1d4ed8` 湖蓝 | CloudArrowUp |
| 计数器 samples.counter | `#60a5fa → #2563eb` 蓝 | Hash |
| 贪吃蛇 games.snake | `#34d399 → #047857` 翡翠 | Joystick |
| 2048 games.2048 | `#67e8f9 → #155e75` 深青 | GridFour |
| 记忆翻牌 games.memory | `#d8b4fe → #9333ea` 紫丁香 | Brain |
| 扫雷 games.mines | `#94a3b8 → #475569` 板岩 | Bomb |

新增精选徽章 = 在 `APP_BADGES` 加一行（覆盖生成器）。

**小游戏轮换**：`desktop/game-rotation.ts`——进入桌面在已安装游戏
（snake/2048/memory/mines）中随机打开一个且与上次不同（上次记录持久化），
窗口居中弹出；未安装任何游戏则静默跳过。

## 10. 品牌 logo（BrandLogo，v2 揚羽蝶主视觉·透明底）

2026-09-26 起系统 logo = 用户提供的 v2 成品插画（玻璃质感蝶 + 桌面窗景
+ 渐变 AgehaOS 字标，纯黑底）。**铁律：图片本身只允许缩放与裁切**；
黑底经「边界泛洪」转为透明（用户裁决，唯一获批的像素级操作）；界面内
贴合走展示层。

资产链（`public/brand/`，母版 `agehaos-logo-v2-master.png` 1254² 永不动）：

| 文件 | 内容 | 用途 |
|---|---|---|
| `agehaos-logo-v2-full-512.png` | 图形+字标，透明底 | 开机动画（产品 BootScreen 96px，DESIGN.md §11；`BrandLogo` full 变体） |
| `agehaos-logo-v2-mark-256.png` | 纯图形（字标上沿以上），透明底 | **界面内唯一引用**（`BrandLogo` 默认） |
| `agehaos-logo-v2-mark-192/180.png` | 纯图形 | favicon 回退 / apple-touch-icon |
| `agehaos-logo-v2-mark-64.png` | 纯图形 | 浏览器标签页 favicon |

字标分离点 = 内容高度 62%~94% 区间「不透明像素最少行」自动检测
（避免 18px 小尺寸下字标糊成一团；开机屏等大尺寸位才展示字标）。

界面适配点（`BrandLogo`，透明底自适应明暗背景，无需圆角裁黑角）：
mark 稿——登录屏 56 / 开始按钮 18 / 设置关于 40·侧栏 14；
开机屏 96 用 **full 稿**（含字标，圆角裁切关闭，见 §11）；
favicon 在明暗标签栏下均无底色方块。

尺寸约定：搜索 16 / 窗口标题栏 16 / Dock 24（2026-09-30 起，原 20）/
悬停预览 20（体 48）/ 开始菜单 24 / 桌面 52（2026-09-30 起，原 40）/
商店列表 36。字形占徽章边长 58%。

桌面图标层（`DesktopIcons`）：内置 7 应用按固定顺序常驻；**商店安装的
应用（含远程目录发布）自动追加其后，卸载即从桌面消失**。单击选中
（钴蓝外圈 + 标签底色）、双击/回车启动、图标外任意指针按下清除选中。
2026-09-30 Slice 5：图标 40→52、格宽 w-24、行距 gap-1、悬停白纱收编
`--ag-desktop-icon-hover`（`.desktop-icon-button`，原 hover:bg-white/10）；
标签随主题翻色（`--ag-desktop-label/-shadow`，§17）；列顶起于顶栏之下
（§19）。选中态保持轻盈（图标外圈 + 标签底色，非整格蓝框）。

## 9. 自动隐藏 Dock（原「自动隐藏任务栏」，§20 浮动化修订）

Dock 默认完全藏于屏幕底缘之外（`translateY(100%)`）。视觉本体是居中
悬浮玻璃胶囊（§20）；承载它的全宽 footer 只是透明运动层
（`pointer-events-none`，不截胡两侧窗口点击——2026-09-30 起渐变纱
退役）。

- **唤出**：指针进入底缘 6px 唤出区（`taskbar-reveal-zone`，z-40 压在
  窗口层之上、弹层之下）或键盘焦点进入任务栏任意控件；300ms ease-out
  滑入。最大化窗口占满视口，唤出的任务栏悬浮其上。
- **收起**：指针离开任务栏子树（含菜单/预览等 DOM 子孙浮层）或焦点
  移出，400ms 缓冲后滑出；唤出区同样挂收起——指针静止时滑入的
  任务栏不会收到 pointerenter（hover 链只在指针移动时刷新），
  直接跳离时只有唤出区的 leave 可靠触发。
- **工作区**：窗口层/视口约束/桌面图标高度均不再为任务栏预留
  （`getWorkspaceViewport` = 整个视口）。
- E2E 交互前须先唤出：`e2e/helpers.ts` 的 `revealTaskbar(page)`。

## 11. 开机动画（motion-lab boot → 产品集成）

2026-09-26 起 `BootScreen` 由 motion-lab/boot 引擎驱动（用户已验收的演示
1:1 落地）：深色揭示画布 + 含字标全尺寸 logo + 细长进度条四段变速推进 +
退场露出下层界面。

### 架构

- **纯曲线** `src/core/boot/boot-curve.ts`：四段变速（进度 36/62/80/100，
  时间占比 16/36/26/22），逐段独立缓动、全程单调不减；零 React、可独立单测。
- **DOM 引擎** `src/desktop/boot/boot-motion.ts`：rAF 推进 + 完成编排 + 退场。
  每帧只写 `fill.style.transform = scaleX()`（合成层，禁 width）；整数百分比
  变化才同步 `aria-valuenow` 与 onProgress 回调；后台标签页单帧封顶 100ms
  （回前台不跳变）；`transitionend` 为主、setTimeout 兜底收尾退场。
- **React 侧绕过渲染路径**：60fps 进度不进 setState；状态文案切换（进度越过
  第一段 →「加载系统资源」）与完成判定（会话状态 → ready/login）经
  `store.getState()` 取最新值，无陈旧闭包。
- **覆盖层生命周期**：`finishBoot` 后目的界面挂载在下层，BootScreen 留场播
  退场（淡出 + scale 1.05），收尾置 `boot-store.layerExitDone`，App 据此卸载。

### 归档口径

- **总时长 2.2s**：实验室演示 3.8s → 产品压缩（实验室建议 2.5~3s，但
  PRD §29.1「重载后 3s 内恢复可交互桌面」的预算含应用加载——需求优先；
  `boot-motion.test` 对该值钉扎）。
- **退场 400ms**（`--ag-motion-boot`）：全系统唯一 >300ms 豁免档；
  `prefers-reduced-motion` 下引擎直接切换（进度条照常推进，属功能性反馈），
  全局令牌塌缩作双保险。
- **深色揭示画布为主题无关常量**（`--ag-boot-*` token，不随 `.dark` 翻转）：
  开机亮相是 macOS 同款的深色时刻，浅色基线从登录页/桌面开始。

### 交互与测试钩子

- **跳过**：点击任意处或按任意键（幂等 skip）；进度尚未越过状态切换点时
  skip 也能完成（`finishBoot` 接受从 booting 直达）。
- **E2E 钩子**：`[data-boot="complete"]`（完成瞬间挂 root）与
  `[data-testid="boot-screen"]`（覆盖层本体，卸载 = 退场收尾）——断言
  完成态/卸载用这两个钩子，勿断言 transform 中间值；`revealTaskbar` 已内置
  等待覆盖层卸载（退场中的覆盖层会吞指针，静止指针此后不再触发 hover 链）。
- **联调覆写**：`window.AgehaBootConfig`（`BOOT_DURATION_MS` / 
  `exitDurationMs`）保留，钳制 1000~10000 / 150~5000。
- **i18n**：`boot.progress`（进度条可访问名）/ `boot.skipHint`（跳过提示）。

## 12. 窗口生命周期动效（motion-lab window → 产品集成）

2026-09-26 起窗口开合与 genie 最小化/还原由 motion-lab/window 引擎驱动：
打开从任务栏按钮方向弹性长出（scale 0.9→1 + fade）、关闭沿同一路径反向
收拢（恒短于打开）、genie 沿「窗口中心 → 任务栏按钮」位移路径飞行
（横缩纵压挤扁感），还原 = 同一组关键帧 `anim.reverse()` 时间镜像。

### 架构

- **纯数学** `src/core/window/motion.ts`：flightDelta（中心→锚点位移）、
  originToward（来源锚定投影 + 限幅 [-50,150]/[100,140]，零尺寸矩形安全收敛）、
  flightKeyframes（三关键帧：中段偏移 0.55 制造「先坠后收」弧线）、时长/曲线
  常量；零 DOM 零 React。
- **DOM/WAAPI 层** `src/desktop/window/window-motion.ts`：WAAPI 探测与
  prefers-reduced-motion 检测（不可用一律返回 null → 调用方直接落定终态）、
  任务栏锚点（`taskbar-item-<id>` 按钮中心；自动隐藏任务栏藏于底缘外时钳制
  到底缘上方 12px）、四个播放函数、clearInlinePose。
- **编排** `use-window-motion.ts`：flight 控制器（track / reverseTo /
  settleActive），打开挂 mount、最小化/还原挂 store 状态迁移、关闭挂
  requestClose 拦截。

### 状态语义（与 motion-lab 演示的差异）

- **store 先行**：窗口状态由 store 如实先行提交（任务栏切换/窗口按钮/引擎
  路径共用一条来源），动效是纯表现层——最小化飞行期间 React 类名已是
  `hidden`，用 inline `display:flex` 反压保持可见，落定后 `clearInlinePose`
  交还类名接管。
- **关闭 = 立即提交 + ghost 续播（2026-09-27 修订）**：`store.close` 在点击
  瞬间提交（引擎/任务栏/启动逻辑立刻见到真相），退场视觉由 ghost 快照接管
  （`closing-ghosts.ts`）：WindowLayer 以同 key 渲染快照（组件实例与 DOM 存活，
  内容连续），aria-hidden + pointer-events-none——不进可达树、不截胡指针，
  飞完即卸载（600ms 兜底清除）。早期方案的「退场飞完才提交」会让将死窗口在
  store 里多活 120ms，与紧随其后的重开点击产生可达树撞车与旧 iframe 错配
  （sdk-fs-note E2E 竞态根因，已根除）。
- **半途抓回**：最小化↔还原互为反向，飞行中点反操作走 `anim.reverse()` 从
  当前呈现值续动（时间镜像、路径严格对称）；打开途中点关闭同样反向收回收回；
  交叉中断先落定当前目标终态再继续；任何时刻不锁 store、不锁输入。
- **时长归档**（motion-lab README §8 约定：以产品档为准）：open 200ms =
  `--ag-motion-base` 同值；close 120ms = `--ag-motion-fast` 同值；飞行 300ms =
  motion-lab `--ml-dur-slow` 同值。弹簧曲线 `[0.32,0.72,0,1]` 与
  `--ml-ease-spring` 同值声明（WAAPI 侧无法引用 CSS 变量，注释互指）。
- **降级**：jsdom/老浏览器（无 `el.animate`）与 `prefers-reduced-motion` 下，
  一切状态变化瞬时直达终态（单元测试默认即降级路径，真实浏览器走 WAAPI）。

### 测试钩子

- 单测以「可控替身」替换 `Element.prototype.animate`（finished 手动 resolve、
  reverse/cancel 可断言），驱动飞行编排与半途抓回路径。
- 断言窗口类名单一类用 `classList.contains`（className 子串会撞上
  `overflow-hidden`）；飞行中的位姿在动画效果里，读 `getComputedStyle`
  的 transform/opacity 而非 `el.style`。

## 13. 任务栏波浪（motion-lab dock → 产品集成）

2026-09-26 起任务栏窗口按钮图标带高斯距离衰减放大波浪（macOS Dock 隐喻，
SPEC §1.3）：指针进入任务栏图标区，图标按 `scale = 1+(max-1)·exp(-d²/2σ²)`
随水平距离连续放大并上浮，近者多、远者趋于 1，无跳变。

### 架构与归档

- **纯数学** `src/core/dock/wave.ts`：gaussianScale / iconScale（波形 × 进入
  包络）/ iconLift / wavePose / cubicBezierAt（CSS cubic-bezier 同语义二分求值）；
  零 DOM 零 React。
- **rAF 引擎** `use-dock-wave.ts`：事件回调只记指针坐标，每帧至多一轮
  「计算 + 写入」；图标中心在 pointerenter/resize/scroll 一次性实测缓存
  （中心 x 不随缩放漂移）；变化阈值内的静止帧零写入。
- **收敛停帧（改进于演示模块）**：包络满格且指针静止即停表，pointermove
  唤醒；离开后 200ms 收敛归位并摘 will-change（SPEC §3.5 只在动效期挂载）。
- **归档参数**：maxScale 1.5 + lift 3px（§20 后裁剪盒 64px、图标 24px，
  1.5×=36px 不出框；按钮节距恒 48px = w-11 + gap-1，是 σ44 的几何前提）、
  σ 44px（节距 48px 的 ≤1.2×）、enter 120ms = `--ag-motion-fast`、
  settle 200ms = `--ag-motion-base`、ease = `--ag-motion-ease` 同值声明。
- **降级**：触屏（pointerType=touch）与 prefers-reduced-motion 整体不启动，
  按钮 CSS 悬停变色 / `:active` 按压保留（演示模块的 pressScale 不迁入——
  全局按钮 `:active scale(0.98)` 已有，避免同元素两套按压）。

### 与任务栏既有机制的边界

- 波浪只写 `[data-wave-icon]` 包裹层（按钮内图标 span）的 transform，不碰
  按钮自身——自动隐藏任务栏的 reveal/hide pointerenter/leave 链（§9）不受
  影响（E2E `taskbar-autohide` 固化）。
- 图标行容器 `self-stretch` 把 `overflow-x-auto` 的隐式裁剪盒抬到整条任务栏
  高（48px），放大 + 上浮不出框（坑 13 的变体）。
- 演示模块的激活点 pulse（2.4s 循环）不迁入：任务栏已有静态下划线指示，
  循环动画需走 §2.5 豁免评审。

## 14. 菜单与通知（motion-lab menu-toast → 产品集成）

2026-09-26 起弹层与通知统一 motion-lab/menu-toast 的动效语言：菜单类浮层
「淡入 + 上浮 4px」进、反向微移出；通知「右滑入 → 驻留（hover 暂停）→
滑出 + 腾位上移」三段节奏。

### 架构

- **动效原语** `src/components/pop-motion.ts`：`useExitPhase`（退场相位——
  open 翻 false 后节点多存活 120ms 播完过渡，期间重开立即恢复：CSS
  transition 从当前呈现值续动，天然可中断）；`popoverMotionClass` /
  `toastMotionClass`（进/出态类名矩阵）；`motionMs`（reduced 或无 WAAPI
  运行时归零）。
- **双层分离的产品化**：进场沿用既有 `animate-os-pop-in`（200ms
  `--ag-motion-base`），退场走 transition（120ms `--ag-motion-fast` +
  新令牌 `--ag-motion-ease-in`，关闭恒不长于打开）；浮层定位类挂外层元素，
  动效类只写 opacity/transform，不与摆位冲突。
- **退场接线范围**：开始菜单（AppLauncher 双形态）、用户菜单、通知中心
  面板、Ctrl+K 搜索面板（含遮罩淡出）。桌面图标/窗口无退场动画（窗口走
  §12 ghost）。
- **桌面右键上下文菜单（2026-09-27 落地，`ContextMenu.tsx`）**：空白画布
  （宿主或壁纸层）右键弹出；指针位置 + 视口边缘收拢 8px（pre-paint 实测
  钳制无闪烁）；菜单项 = 更换壁纸（`systemDynamicDesktop.refresh()`，
  5s 节流在服务侧）/ 打开应用商店 / 打开设置；关闭 = 项点击 / Esc /
  菜单外按下（capture）/ 视口尺寸变化。**窗口与图标上不出菜单**（交由
  后续的元素级菜单），右键被浏览器默认菜单吞掉的区域同理。
- **降级**：`prefers-reduced-motion` 全局令牌塌缩 + JS 等待归零；无 WAAPI
  运行时（jsdom/老浏览器）退场相位直接跳过——保持旧的即时卸载语义
  （fake-timer 测试里退场计时器会被冻结，无 WAAPI 即无 CSS transition
  可播，停留纯属死时间）。

### 通知三段节奏（NotificationToasts 重写）

- **滑入 200ms**（`animate-os-toast-in`：translateX 24px 过冲 + 淡入）→
  **驻留**（normal 4.5s / critical 8s 不变；hover 暂停、离开续走剩余时间，
  `performance.now()` 差值法）→ **滑出 120ms** + 卸载。
- **栈 ≤3 条**（此前产品只显示最新一条，本次按演示模块的堆叠形态放开）：
  最新 3 条可见，第 4 条起排队等位；槽位固定宽度，高度实测后以 translateY
  排布，关闭腾位时其余卡片 transform 过渡上移（与滑出并行）。测量结果经
  延迟一拍提交（坑 4），新卡片首帧以旧偏移渲染、随后过渡归位。
- 点击通知 = 标记已读 + 滑出退出；SDK 通知经 `notification-store.push()`
  汇入同一路径自动生效。

## 15. 桌面增强档（motion-lab enhance → 产品集成）

2026-09-26 起 enhance 档四项接入产品，其余按挂载面与产品现状裁定（见末表）。
开关存储：`motion-prefs-store`（`agehaos.motion.prefs.v1`，设备本地——性能
相关开关不进云端同步），设置 → 外观分区两个 ToggleSwitch。

### 已接入

- **壁纸指针视差**（parallax 照片平面化单层版，默认开）：照片是单层位图，
  三层景深不适用——单层位移 ±22px（纵向 ×0.55、反向、lerp 0.085、收敛
  停帧 epsilon 0.0012）+ scale 1.03 掩边；仅照片计划且激活层参与（交叉
  淡入的下层不错位）；rAF 纪律同前，`use-wallpaper-parallax.ts`。
- **桌面图标错峰入场**（stagger-enter，默认开，每页面会话一次）：250ms
  上浮 14px 淡入 + 60ms 错峰（SPEC §1.4 的 40~60ms 档）；`os-stagger-item`
  类 + 每图标 animationDelay；模块级标记保证会话内重进不重播。
- **点击涟漪**（click-ripple，默认开）：仅桌面空白画布（宿主自身或壁纸层；
  图标/窗口/任务栏等交互元素不注入）——直径 = 点击点到最远角 ×2 ×1.15
  （上限 720px），300ms 扩散（铁律上限档），animationend 自清理 + 超时兜底；
  reduced-motion 不注入（反馈退化为 `:active` 微缩放）。
- **指针跟随光晕**（cursor-glow，**默认关** + 设置项）：320px 主题色径向
  光斑（浅色 multiply / 深色 screen），平滑 0.18、收敛停帧、进出淡入淡出；
  光晕层 z-5 压壁纸垫窗口（不叠窗口内容），pointer-events-none。

### 裁定不接入/缓办

- **glass-panel**：产品已有 `.surface-glass`（blur 24px、实色兜底、
  reduced-transparency 回退）+ 弹层进场动效，等价覆盖。
- **icon-press**：全局 `:where(button):active { scale(0.98) }` 已覆盖。
- **theme-glow**：指南明确照片壁纸上叠大光斑显脏——当前唯一主动样域即
  照片，无挂载面，待程序化样域回归再议。
- **aurora / dock-sheen**：默认关 + 常驻成本，无设置面，缓办。
- **window-tilt**：与 §12 窗口生命周期动效二选一，取 §12（打开/genie 已是
  来源锚定的空间连续语言）。

## 16. 生成式壁纸 · gradient-field（macOS 风分层色场）

2026-09-27 用户裁决：「**不要风景图了，参照 macOS 自行设计与现有主题相关的
壁纸**」——2026-09-24「要真实风景照」裁决就此推翻，照片域整体移除（目录/
图片/渲染分支/质量门口径/i18n/E2E 全清，git 历史可回溯）。grilling 共识：
原「不搭」根因是色相冲突与明信片高饱和，而非题材；协调层（scrim+降饱和）
随照片一并取消——生成的壁纸天生同语系。

### 形态与引擎

- **引擎** `src/core/dynamic/generative/gradient-field.ts`：大面积柔和渐变
  色场 + 3-4 层对角流动曲面（blur 18px 柔化）+ 一条弱流线（blur 22px）；
  **固定 10 款构图（5 亮 + 5 暗），seed 只驱动曲线相位/倾斜/振幅微变体**
  ——「换一张」永远安全（主结构与配色恒定）。
- **10 款配色**（用户从多彩候选中全数保留）：亮池 = 晨白（蓝白锚点）/青屿/
  紫岚/樱曙/琥晓；暗池 = 夜幕/极光/绯暮/紫曜/琥珀夜。主题令牌核心 +
  冷暖邻域以设计化处理入选。
- **决策引擎** `ACTIVE_STYLES = ['gradient-field']`：按主题取池 + 最近
  构图排除（recentFieldIds，finite 池放开语义与照片时代一致）；风格熵/
  强制探索/三区配比等 §6.4 机制全沿用。
- **质量门**：校验构图成员 + 主题匹配（自带配色，无调色板口径——通过即
  短路）；安全过滤同规。面板「今日壁纸」卡显示构图名（wallpaper.field.*）。
- **AI 生成徽标移除**（用户裁决）：桌面壁纸一律不显示（面板内容归属行
  保留）。视差（§15）改挂生成 canvas（scale 1.03 掩边同样成立）。

### 沿用项

自动轮换档位（15/10/6/3 分钟/固定）、「换一张」5s 节流、决策反馈回路、
交叉淡入（600ms）、壁纸默认开（主开关 = 退出项）、视差与光晕设置项——
全部不变，只换生成域。

## 17. Phase 1「Calm Future」开工裁决（2026-09-30，ADR 24）

七项 grilling 裁决与既有用户裁决（HANDOFF 坑 35）的覆盖关系：

| # | 裁决 | 与既有裁决的关系 |
| --- | --- | --- |
| 1 | 图定材质风格，提示词 §45 定布局骨架；图中左侧导航栏/右侧小组件为 Phase 2 候选，本期不建 | 新增（不影响既有裁决） |
| 2 | 方向升级「Calm Future」写入本文 + ADR 24；**默认主题 light → dark**（存量偏好不动）；壁纸沿用 gradient-field 10 构图，不新增构图 | 修订 ADR 19 的「浅色基线」段；坑 35「浅色默认」就被此条有意覆盖 |
| 3 | 顶栏承载系统状态（网络/云同步/通知/用户/时钟），Dock 纯应用 + 运行指示 | 坑 35「图标任务栏 + 悬停预览」行为保留，部件归属调整在 Slice 3/4 落地 |
| 4 | 窗口控制采用左置交通灯（小、克制、精确），aria-label 契约不变 | 新增 |
| 5 | v1 Token 名保留为别名（surface-raised→surface-soft 等），新代码用 v2 名；全量迁移留 Phase 2 | 新增 |
| 6 | 应用图标保留彩色徽章体系（app-badges + AppIcon），仅升级容器视觉 | 重申坑 35/坑 41 |
| 7 | Dock 自动隐藏保持「完全出屏」（translateY(100%) 契约与 E2E 几何不变） | 重申坑 35/坑 42 |

另：坑 35「桌面图标标签白字 + 深投影（照片壁纸可读）」随照片域退役失去前提，
已于 Token 2.0 收编为 `--ag-desktop-label(-shadow)`（浅色池壁纸上白字实测
3.3:1 不及格；现浅色 10.7:1+ / 深色白字 + 墨影不变）。

已知遗留（非本片回归，git HEAD 复现确认）：动态面板卡片列表内容超出窗口
高度时滚动折叠线裁切（`overflow-y-auto`，HEAD 即 `scrollHeight 588 >
clientHeight 396`）——后续按坑 44 迁移 `ScrollFadeList` 或调高默认窗口，
随应用侧收口片处理。

## 18. 桌面氛围层（Phase 1 Slice 2，2026-09-30）

壁纸/画布之上的环境层（升级提示词 §5 Layer 2 的静态子集）：顶部环境光 +
暗角，随主题翻转——浅色白顶光 + 蓝墨暗角（边角实测 ~4-5% 增深），深色靛蓝
顶光 + 冷墨暗角（更沉一档）。`src/desktop/atmosphere/AtmosphereLayer.tsx`
消费 `--ag-atmosphere-ambient/-vignette` token（`src/index.css` 双主题）。

- 铁律：纯静态 CSS 渐变——零动画、零 rAF、零常驻合成负担（提示词 §36）；
  `pointer-events-none`（坑 40），涟漪/右键菜单的目标判定（画布宿主或
  壁纸层）永远不会命中本层；`aria-hidden` 不进可达树。
- 层序：壁纸(无 z) < 氛围 `z-[2]` < 指针光晕 `z-[5]` < 图标 `z-10` <
  窗口 `z-30` —— 暗角是环境不是前景，窗口浮于其上。
- 壁纸关闭时依然渲染（落在 surface-canvas 渐变上）；登录屏暂不挂（后续片
  裁量）。
- 交互冒烟钉住：空白画布左键涟漪注入、右键上下文菜单在氛围层之下照常触发
  （.tmp 脚本，坑 66）。
- visual-judge 像素验收：无色带（纯壁纸区最大梯度步进 ~1.3/255）、无暗框
  感、浅色无泥黄、深色不糊黑；壁纸仍是视觉主角。

## 19. 顶部菜单栏（Phase 1 Slice 3，2026-09-30）

升级提示词 §15 的 AgehaOS 式顶栏（借鉴 OS 菜单栏的空间逻辑，非 macOS 复刻）：
`src/desktop/menu-bar/MenuBar.tsx`，常驻 `fixed inset-x-0 top-0 z-40`，高
`--ag-menubar-height`（32px，与 `viewport.ts` 的 `MENUBAR_HEIGHT_PX` 双常量
互指钉扎）。视觉：白/墨玻璃 + `border-border-subtle` 发丝底边 + shadow-soft，
克制不抢焦点。

- **左侧**：BrandLogo(16) + AgehaOS 字标 + 菜单——只放有真实动作的项：
  文件（打开文件管理器 / 搜索…=Ctrl+K）、视图（更换壁纸 / 浅色/深色/跟随系统
  带勾选）、窗口（最小化全部 / 关闭全部 / 打开窗口清单点击聚焦还原）、
  帮助（关于=打开设置）。「编辑」无真实目标，缓办；「网络/云同步」等无真实
  信号的状态图标不做（拒绝装饰性谎言，待有真数据再挂）。
- **右侧（Q3 裁决自任务栏迁移）**：通知铃（面板向下展开 top-10）+ 用户菜单
  + 时钟。任务栏回归纯应用 Dock；E2E 全局 testid/role 定位不受挂载点影响。
- **键盘/可达性**：触发器 `aria-haspopup/aria-expanded`、下拉 `role=menu`、
  项 `role=menuitem`（禁用态半透明）；Tab/Enter/Esc 可完整操作，外部
  pointerdown/Esc 关闭（与右键菜单同语义）；悬停切换菜单（有菜单打开时）；
  箭头遍历缓办。
- **工作区契约**：`getWorkspaceViewport()` 高度扣减顶栏（拖拽/缩放钳制）；
  最大化窗口 `top: var(--ag-menubar-height)` 只占顶栏之下的工作区；桌面图标
  列、动态面板自动停靠、小游戏轮换弹出的 y 基线全部避开顶栏；toast 栈
  顶偏移 `calc(var(--ag-menubar-height)+0.75rem)`。
- **动效**：下拉复用 §14 弹层语言（进 200ms / 退 120ms，jsdom 无 WAAPI 即时
  卸载语义不变）。

## 20. 悬浮 Dock（Phase 1 Slice 4，2026-09-30）

任务栏视觉本体升级为**居中悬浮玻璃胶囊**（升级提示词 §16 的 Floating Dock，
权威图同款）：

- **结构分层**：全宽 `<footer>`（contentinfo + `data-state` + 内联
  `translateY` 契约不变）降级为**透明运动层**（`pointer-events-none`，
  坑 40——两侧不截胡窗口点击）；胶囊本体 `pointer-events-auto`
  `surface-glass` + `rounded-full` + hairline 边 + `shadow-popover`，
  高 `h-16`（64px，footer `pb-3` 悬浮出 12px 底隙，总高 ≈76 ∈ 提示词
  64~76 目标），`max-w-[calc(100%-1.5rem)]` 溢出时图标行滚动。
- **几何契约（勿动）**：窗口按钮 `w-11 + gap-1` = **节距恒 48px**
  （σ44 波浪前提，§13）；波浪裁剪盒由 self-stretch 抬到整条胶囊高；
  `taskbar-item-*` testid 与可测量按钮保留（窗口动效锚点）。
- **组件**：激活指示改**极小圆点**（h-1 w-1，保留 `bg-primary` 类契约，
  弃 2×20px 胶囊条）；图标 20→24；启动器按钮 `h-12 rounded-full`；
  启动按钮与窗口区之间 hairline 分隔；悬停预览 `bottom-full mb-2`
  悬于胶囊上方；启动器菜单 `bottom-full mb-3` 同理。
- **行为零改动**：唤出区 6px / 300ms 进 400ms 出 / 键盘焦点唤出 /
  悬停预览 350ms / 波浪引擎 / ghost 关闭 / genie 锚点钳制——全部原样
  （Q7 裁决：自动隐藏保持完全出屏）。
- 测试契约更新：Taskbar.test 的「渐变纱而非玻璃」断言翻转为「透明运动层 +
  玻璃胶囊」新契约（合法翻转，本节为权威）；E2E taskbar-autohide 几何
  断言（隐藏时物理出屏）原样通过。

## 21. 窗口 chrome（Phase 1 Slice 6，2026-09-30）

窗口视觉升级（升级提示词 §18/§19，Q4 裁决交通灯左置）：

- **窗体**：`rounded-xl`（20px，最大化 `rounded-none`）；`surface-glass` 框 +
  细边（激活 `border-primary/50 shadow-window` / 非激活 `border-border
  shadow-window-flat`）——激活/非激活差异保持「细腻五感」：边框/阴影/标题
  清晰度/表面/交通灯不透明度。
- **头部**：`h-11`（44px）玻璃材质（弃 `bg-surface-raised` 实色，让框体玻璃
  连续），底边 `border-border-subtle` 发丝线；AppIcon 16 + 标题（激活
  text-text / 非激活 text-text-muted）。
- **交通灯**（主题无关常量 `--ag-wl-{close,min,max}(-glyph)`）：左置三枚
  12px 圆点（close #ff5f57 / min #febc2e / max #28c840），hover 显字形
  （group-hover，Phosphor 8px），命中区 24px；非激活窗口整组 opacity-60。
  可访问名契约不变（`window.close/minimize/maximize/restore`——测试与
  E2E 按名点击）；按钮 `onPointerDown` stopPropagation 保留（拖拽不吞点击）。
- **窗体纸面**：维持不透明（§2.1 裁决见上）；动效契约（§12 WAAPI 常量/
  ghost/genie）与窗口状态语义零改动。
- 测试：WindowFrame +1（三灯左置顺序/点色 Token/头 44/圆角 xl）；CSS 契约
  +1（wl token 双侧存在）。

## 22. 启动器（Phase 1 Slice 7，2026-09-30）

开始菜单升级为图标优先的紧凑面板（升级提示词 §20）：

- **扁平形态**（未采纳布局建议）：`w-[24rem]` 玻璃面板 + `rounded-xl`，
  顶部**本地搜索框**（`launcher-search`，按本地化名称过滤，启动后输入随
  菜单关闭清空；未命中走既有 `search.empty`「无匹配结果」）+ **4 列图标
  瓦片网格**（AppIcon 40 + 11px 标签，图标明显文字精简）。
- **布局形态**（采纳动态布局建议）：分组行式列表保留（建议语义以行阅读
  更佳），宽度调宽 single 384 / double 480 / grid 544；搜索框同样过滤
  （空组自动隐藏，重置行常驻）；分组标题 10px → 11px（§5 字号纪律收口）。
- **契约不变**：`menu[aria-label=开始]`（role=list）、按钮按本地化应用名
  可点（E2E/core-path）、`launcher-layout-*`/reset testid、三档宽度机制、
  §14 弹层动效、`bottom-full mb-3` 悬于胶囊上方（§20）。
- **缓办（无真实数据源不做装饰）**：Recent Apps（无用量统计）、独立
  Categories（动态布局建议的分组已覆盖该语义）、560-680 全宽档（现有
  应用数量下 384-544 更克制；数量增长后再评估）。

## 23. Ctrl+K 搜索面板（Phase 1 Slice 8，2026-09-30）

- **居中**：`items-center justify-center` 视口正中（Spotlight/Raycast 比喻，
  升级提示词 §21），弃顶部 12vh 悬挂；遮罩 `bg-black/30` → **`bg-scrim`
  Token**（退场 `bg-scrim/0`，Token 2.0 收编散落遮罩）。
- **面板**：`w-[32rem]` → `w-[38rem]`（608 ∈ 600-720）+ `rounded-xl` +
  `shadow-popover`（浮层档影，高于窗口档）。
- **字号纪律**：分组头/文件路径行/底部提示条 10px → 11px（§5 收口）。
- **契约不变**：搜索逻辑（rankApps/VFS 搜索）、键盘导航（↑↓/Enter/Esc）、
  testid（search-*）、激活行 `bg-primary/10`、§14 动效全部原样。

## 24. 弹层统一材质与遮罩 Token（Phase 1 Slice 9，2026-09-30）

- **`.popover-panel`**（与 `surface-glass` 搭用）：收编「rounded-lg +
  border-border + shadow」三件套模板，统一落在右键菜单 / 通知中心面板 /
  用户菜单 / Dock 悬停预览 / Toast 卡片 / 顶栏下拉六处（消解散落重复）；
  动效类仍由 pop-motion 叠加，定位与尺寸归调用点。
- **对话框遮罩 Token 化**：confirm/prompt/permission-consent 三处
  `bg-black/50` → `bg-scrim-strong`（Token 2.0 遮罩族），配合 §23 的
  `bg-scrim`——遮罩自此全部走 Token，无散落 black。
- **契约不变**：全部 testid/role/动效类（含 ContextMenu 的
  `animate-os-pop-in` 断言）原样。

## 25. 响应式兜底（Phase 1 Slice 10，2026-09-30）

桌面优先（PRD §28，1280+）；窄视口只保「不崩」，完整移动端 UX 属后续 Phase
（升级提示词 §26 同口径）：

- **顶栏**：<640px 收起菜单标签（`hidden sm:flex`，品牌 + 系统状态保留；
  品牌字标 <640px 隐藏只留 mark）。
- **启动器**：菜单锚定改为 **footer 包含块 `fixed`**（与悬停预览同机制，
  `bottom-[calc(100%+0.75rem)] left-2`）——不再随触发按钮位置右溢；
  `max-w-[calc(100vw-1.5rem)]` 限宽（Tailwind calc 任意值需下划线空格形式）。
- **窗口**：`launchApp` 初始尺寸钳制（`min(manifest, viewport-16/-48)`，
  下限 320×240）——manifest 默认尺寸不再超过窄视口（桌面级视口下无感知）。
- **既有兜底复核**：Dock 胶囊 `max-w + overflow-x-auto` ✓；搜索面板
  `max-w-[90%]` 居中 ✓；右键菜单 8px 视口钳制 ✓；通知面板/用户菜单右锚
  不右溢 ✓；桌面图标列 flex-wrap 限高 ✓。
- **E2E**：`e2e/responsive.spec.ts`（375×812：无横向 overflow、顶栏完整、
  自动开窗不超视口、启动器在视口内）。
