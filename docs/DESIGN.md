# AgehaOS 应用套件设计方向 · 蓝白渐变「精密仪表」

> 2026-09 设计裁决（grilling 共识）：taste-skill 自由方向、浅色基线、全局 Token
> 跟随、CSS-only 动效。**2026-09-26 用户裁决修订：整体配色改为蓝白渐变，
> 方向其余不变。**本文是方向的唯一权威定义；试点页（Files）实现即本文件
> 的可视化。拨盘：VARIANCE 3 / MOTION 2 / DENSITY 5-6（产品 UI 要可预期性，
> 不是营销页的表现力）。

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

玻璃材质（chrome 专用：任务栏/开始菜单/窗口标题区）：浅 `rgb(248 251 255 / 84%)`
/ 深 `rgb(20 27 43 / 78%)`，蓝白调；应用内部一律不透明渐变面板——**玻璃归
chrome，纸面归应用**，材质分层即层级。

### 2.2 形状（一档收紧）

`radius: sm 4 / md 8 / lg 12`（原 6/12/16）。规则不变：控件与行 = md，浮层
（窗口/菜单/对话框/卡片）= lg，微件 chrome（标题栏按钮）= sm。

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
- 壁纸引擎 INK/SURFACE 质量门常量随 Token 同步（冷墨值），山水调色板对比
  度门禁复跑验证。
- E2E 在 Playwright 中钉住 `colorScheme: 'light'` 保证确定性。

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

尺寸约定：搜索 16 / 窗口标题栏 16 / 任务栏 20 / 悬停预览 20（体 48）/
开始菜单 24 / 桌面 40 / 商店列表 36。字形占徽章边长 58%。

桌面图标层（`DesktopIcons`）：内置 7 应用按固定顺序常驻；**商店安装的
应用（含远程目录发布）自动追加其后，卸载即从桌面消失**。单击选中
（钴蓝外圈 + 标签底色）、双击/回车启动、图标外任意指针按下清除选中。
标签白字 + 深投影，明暗照片壁纸均可读。

## 9. 自动隐藏任务栏

任务栏默认完全藏于屏幕底缘之外（`translateY(100%)`），背景弃用玻璃
面板，只留一条随主题的底部渐变纱（`from-bg/85 via-bg/45 to-transparent`，
无描边）——视觉上透明融进壁纸，深浅壁纸下文字均可读。

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
