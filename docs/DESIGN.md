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

## 0. 现行规范（2026-10-02 UI 评审落地，与下文冲突时以本节为准）

下文 §1–§33 按时间顺序记录了历次裁决，其中多处已被后续裁决推翻。本节
只列**当前生效**的规则；被推翻的条款就地标注「已被 §0 取代」，不再删改
原文（历史可追溯）。评审原文见 `docs/UI-REVIEW-2026-10-02.md`。

### 0.1 方向与基线
- 方向 = **「Calm Future」玻璃语言**（页首）；§1「蓝白渐变·精密仪表」与
  §33「Floating OS」是它的前身与精修，不是并列方向。
- 默认主题 = **浅色**（§32.1 参考图明亮基线），取代页首与 §6/§17 的
  「默认深色」。
- 壁纸 = 照片基底常驻 + 动态桌面覆盖层（§32.1），取代 §16「不要风景图」。

### 0.2 材质：外壳三分（取代 §32.2 中弹层/小组件部分）
| 面 | 浅色 | 深色 | 实现 |
|---|---|---|---|
| 常驻 chrome（左栏、Dock、品牌层） | 低透白玻璃 + 白字 | 同左 | `.desktop-chrome` |
| 菜单栏 | 暗藏青条 `rgb(18 30 66 / 50%)` + 白字，次级白 92% | 同左 | `.menubar-glass` |
| 弹层与小组件卡（菜单下拉、启动器、通知中心、用户菜单、右键菜单、搜索、右栏四卡） | **纸面**：白玻璃 + 墨字（正文 `#18202c`、次级 `#43526a`） | 冷墨玻璃 + 浅字 | `.popover-panel` / `.glass-popover` / `.widget-card` / `.chrome-paper` |

- 纸面块与 `.desktop-chrome` 都在元素自身**重声明整套文字/表面 Token**，
  包括别名 `--ag-surface-raised`、`--ag-brand`——自定义属性在声明处求值，
  `:root` 的别名不会在子树重算（漏声明时菜单栏 hover 底会落成近白实色）。
- 白字落在亮天空上的 12–26% 白玻璃里实测仅 1.7–2.7:1，因此**弹层不得再
  继承 `.desktop-chrome` 的白字**；`.desktop-chrome` 不再声明
  `--ag-glass-bg-strong`。
- 小组件卡 Acrylic 旋钮：`--ag-widget-blur: 8px`（3px 时壁纸细节透字），
  遮罩为白纱；降透明/无 backdrop-filter 时回落 `--ag-surface-popover` 实色。
- 焦点环：2px `--ag-focus-ring` 外环 + 2px `--ag-focus-halo` 衬圈，任何底色
  上都可见；chrome 内取深藏青环 + 白衬圈。
- 品牌层：「OS」渐变提亮为 `#e6efff → #d8ceff`；标语与副标语用全强度
  `text-text` + 双层阴影（不再用 light 字重 / muted 色）。
- 开机屏：mark 图形 + CSS 文字字标（白字，「OS」冷紫渐变），与进度条间距
  24px；不再使用 full 资产（其深色字标在深色开机底上不可见）。

### 0.3 CSS 层叠铁律
- `index.css` **不分层**；未分层规则永远压过 Tailwind 4 的
  `@layer utilities`。凡是 `index.css` 里给了基态（如 `.os-tooltip{opacity:0}`），
  状态变体必须同样写在 `index.css`（`.group:hover .os-tooltip`），写
  `group-hover:opacity-100` 工具类无效。
- 源序：七面玻璃增量块位于 `.surface-glass` 基规则之后、降透明兜底之前；
  纸面 Token 块位于玻璃兜底之后，只发 Token 不发玻璃声明；`.widget-card`
  主规则保持为文件中最后一个 `.widget-card` 块。

### 0.4 弹层契约（补充 §24）
- 统一由 `usePopoverDismiss(id, open, onClose, { insideRefs, dismissible })`
  管理：document 捕获阶段 Esc 关闭；内部区域外按下关闭；焦点落进应用
  iframe 时关闭（仅 window blur 不关，切标签页不丢弹层）；Esc 关闭时若
  焦点在面板内则回焦触发器。
- **互斥**：全局 `usePopoverStore` 槽位，任一时刻至多一个 chrome 弹层；
  自带键盘模型的弹层（菜单栏、右键菜单、Ctrl+K 搜索）以
  `dismissible: false` 只参与互斥。
- 外部触发器（如左栏通知项）加 `data-popover-trigger="<id>"`，按下不触发
  外部关闭，交给它自己的 toggle。
- 启动器打开即聚焦搜索框；通知中心 ≥1280px 停靠在右栏左侧，不盖时钟卡。
- 弹出的遮罩/对话框若挂在带 backdrop-filter 的 chrome 内，必须
  `createPortal` 到 body（坑 67）。

### 0.5 真实性（取代 §32.3 的示例天气与示意图标）
- 「拒绝装饰性谎言」（§19/§27）恢复为铁律：界面不显示示例数据、示意图标、
  裁决日期或内部术语。
- 菜单栏状态簇只显示浏览器读得到的状态（电池）；不画 Wi-Fi/蓝牙。
- 右栏时钟卡显示系统真实时区名（`Intl` `timeZoneName: 'long'`），不再有
  天气行；系统状态卡第一格为「流畅度」= rAF 实测帧率，不再冒充 CPU。
- 应用商店：拿不到远程目录（本地模式/离线/空目录）静默；只有拿到目录却
  通不过签名/公钥/结构校验才告警。示例应用描述用用户语言，不出现
  「Type B / SDK / 沙箱」。
- 动态面板来源标注为「生成于 本机 / 本机缓存 / 云端 AI」，不出现「本地规则」
  「决策来源」。
- Files 根级系统目录显示本地化名（文档、下载…），底层路径保持英文。

### 0.6 可达性与快捷键
- DOM 序 = 视觉/Tab 序：菜单栏 → 左栏 → 窗口区 → 右栏 → Dock；层级用
  z-index 解决（菜单栏 `z-[41]`），不靠渲染顺序（取代 §27 的「轨道栏先渲染」）。
- 地标：视觉隐藏 `h1`、`main`（窗口层，「窗口」）、命名 `nav`（菜单、系统
  导航、程序坞）。
- Dock 常驻瓷贴的可读名称恒为应用名，运行中窗口标题经 `title` 进入描述。
- 交通灯字形在 `:focus-visible` 时与悬停一样显示。
- 最小字号 11px（徽章 10px 豁免）；禁用态用 `text-text-disabled`，不靠整体
  `opacity-40`。
- 快捷键提示按平台写法（`core/platform`：`⌘K`/`Ctrl+K`、`⌥W`/`Alt+W`、
  `⇧⌘Z`/`Ctrl+Y`）；菜单项右侧显示快捷键并带 `aria-keyshortcuts`；
  「帮助 → 键盘快捷键」列出全部生效按键。
- 启动器占位符与能力一致：「搜索应用…」。

### 0.7 待产品裁决（未落地，保持原裁决）
- 左栏与 Dock 的重复入口（文件/终端/商店/设置）是否删减（§32.3）。
- 编辑命令是否移回独立「编辑」菜单（§33 §1① 裁决并入文件菜单）。
- ~~首次登录是否继续自动打开动态面板与轮换小游戏~~（已裁决：2026-10-02 用户裁决不再自动打开，见 §32.5 修订 13）。
- 深色主题配套的黄昏/夜景壁纸；动效默认开启项数（§15 vs 现行默认全开）。

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
（§21 P2-6 终裁 2026-09-30：**应用纸面 92% 轻半透明**——预览工作台 +
像素实测（92% 渗字为零、对比度不变；85% 出现微弱字形残影）后用户拍板。
`.surface-panel` 底色与 `--ag-panel` 渐变均按 92% alpha（color-mix），
纯 alpha 合成零 GPU 成本、不带 blur；`prefers-reduced-transparency`
回退实色。）

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

**小游戏轮换**（2026-10-02 起自动弹出退役）：`desktop/game-rotation.ts` 保留纯函数 `pickGameId`（与上次不同）与 `openRandomGame`（居中弹出）供后续手动入口复用；进入桌面不再自动打开游戏（§32.5 修订 13），游戏经商店安装后手动启动。

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

尺寸约定：搜索 16 / 窗口标题栏 16 / Dock 22（2026-10-01 密度档，原 24）/
悬停预览 20（体 48）/ 开始菜单 24 / 商店列表 36（桌面图标层已移除）。
字形占徽章边长 58%。

**桌面图标层已移除（2026-10-01 用户裁决，继承权威图布局）**：左侧系统
导航栏（§26）+ Dock + 启动器承接全部应用入口，桌面回归纯壁纸空间；
组件/测试/E2E/CSS Token（--ag-desktop-* 与 .desktop-icon-* 类）/i18n
`desktop.iconsLabel` 键/stagger 入场动效全链清除。单击选中
（钴蓝外圈 + 标签底色）、双击/回车启动、图标外任意指针按下清除选中。
2026-09-30 Slice 5：图标 40→52、悬停白纱收编
`--ag-desktop-icon-hover`（`.desktop-icon-button`，原 hover:bg-white/10）；
标签随主题翻色（`--ag-desktop-label/-shadow`，§17）；列顶起于顶栏之下
（§19）。选中态保持轻盈（图标外圈 + 标签底色，非整格蓝框）。**2026-10-01 密度档（用户裁决「太臃肿」）：图标 52→44、格 w-24→w-20、行距 gap-1→0.5、内距 py-2→1.5。**

## 9. Dock（§20 浮动化 + §32 修订 8/9 常驻化）

**常驻显示（2026-10-01 用户裁决，修订 8）**：自动隐藏机制整体退役——
唤出区/收起定时器/reveal 状态机已删除，Dock 恒为可见（`data-state=
"revealed"` 恒定）；视觉本体是居中悬浮玻璃胶囊（§20）；承载它的全宽
footer 只是透明运动层（`pointer-events-none`，内联 transform 保留作
弹层包含块护栏；弹层本体已 `createPortal` 至 body）。瓷贴/运行中/
启动器/回收站按钮不画 hover/active 底色（修订 9：44px 徽章坐 48px
按钮，浅底显成图标四周白边）。

- **悬停预览**（§12/§13 契约不变）：350ms 延时后经 `createPortal` 挂
  body（玻璃胶囊 backdrop-filter 会劫持 fixed 包含块），以图标中心横向
  居中、`bottom: --ag-dock-height + 1.25rem` 悬在胶囊上方。
- **最大化窗口**（修订 12）：整视口真全屏，常驻 Dock 与菜单栏被窗口层
  （z-[45]）覆盖，还原走窗口标题栏。
- E2E：`e2e/taskbar-autohide.spec.ts`（常驻契约 + 悬停预览锚定）。
  `helpers.revealTaskbar` 保留为立即通过。

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

## 13. Dock 波浪（2026-10-05 用户裁决终态：高斯波浪是唯一浮起，强浮起退役）

> **2026-10-05 用户裁决（现行，两次迭代收敛）**：指针在 Dock 上移动时，图标
> 按高斯衰减随距离轻浮——**波浪是唯一的浮起效果**（2026-10-02 的悬停强浮起
> `translateY(-3px) scale(1.18)` + 光晕随同日波浪恢复一并退役，
> `button:hover > [data-wave-icon]` 规则删除）。实现：**Taskbar 波浪引擎**
> （`Taskbar.tsx` 的 `dockWaveTransform`，rAF 节流直写 inline transform，
> 零 React 渲染）——σ = 56px（对齐图标节距）、峰值 `translateY(-8px)
> scale(1.08)` 作用于距指针最近的一枚、超出 2σ 不写样式；`index.css` 的
> `[data-wave-icon]` 基态 220ms transform 过渡提供轻阻尼与离开软回落。
> 触屏与 prefers-reduced-motion 无波浪；`.no-scrollbar`（修订 11）契约
> 不变。E2E `motion-lab.spec` 钉「指针位峰值 1.08 + 相邻轻浮（1 < scale <
> 1.08）+ 3σ 外归位 + 移开全归位」。历史：2026-09-26 起初代波浪 →
> 2026-10-02 退役（只浮起悬浮枚）→ 2026-10-05 恢复并收敛为本终态；旧引擎
> 彼时删除、现行为重写实现。
> 以下为 2026-09-26 ~ 2026-10-02 波浪时期的原契约，仅供历史参照：

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
- ~~点击涟漪~~（**2026-10-01 用户裁决移除**：hook/CSS/测试全清，
  空白画布点击无注入效果）。
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

已知遗留收口记录：动态面板卡片列表滚动折叠线裁切（§17 记录的既有问题）
已于 2026-09-30 Phase 2 · P2-1 迁移 `ScrollFadeList` 修复（坑 44 归一：
常驻细滚动条 + 折叠线渐隐双通道）。

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
`--ag-menubar-height`（**28px**，2026-10-01 密度档原 32；与 `viewport.ts` 的
`MENUBAR_HEIGHT_PX` 双常量互指钉扎）。视觉：白/墨玻璃 + `border-border-subtle` 发丝底边 + shadow-soft，
克制不抢焦点。

- **左侧**：BrandLogo(16) + AgehaOS 字标 + 菜单——只放有真实动作的项：
  文件（打开文件管理器 / 搜索…=Ctrl+K）、视图（更换壁纸 / 浅色/深色/跟随系统
  带勾选）、窗口（最小化全部 / 关闭全部 / 打开窗口清单点击聚焦还原）、
  帮助（关于=打开设置）。「编辑」无真实目标，缓办；「网络/云同步」等无真实
  信号的状态图标不做（拒绝装饰性谎言，待有真数据再挂）。
- **右侧（Q3 裁决自任务栏迁移）**：通知铃（面板向下展开 top-10）+ 用户菜单
  + 时钟。任务栏回归纯应用 Dock；E2E 全局 testid/role 定位不受挂载点影响。
  **Shell 3.1 STEP 3（F3 顶栏信息减法）右簇终态**：电池 → Cloud 同步 → 通知铃
  → 用户 → 时钟——AI 产品句「今日桌面由 N 条趋势信号生成」及其来源弹层
  （原 `menu-bar/WorldSignals.tsx`）整体迁出，归右栏今日世界卡
  （`widgets/WorldSignals.tsx` 内嵌 WorldCard；弹层 createPortal 至 body +
  bottom 定位避 WidgetRail 容器裁剪，`usePopoverDismiss` 槽 'world-signals'
  与 branding 联动保持）；i18n 键 menubar.worldSignals* → widgets.world.signals*。
  顶栏材质（glass-hint + 发丝底边 + shadow-soft）与高度 token 不变。
  **2026-10-06 用户裁决：顶栏背景退役**——glass-hint/发丝底边/shadow-soft
  全部删除，菜单直接浮于壁纸（可读性由 desktop-chrome 白字 + text-shadow
  承担，下拉弹层仍走 popover 玻璃；高度 token 不变），与窄轨图标同供建构
  「原生桌面」感。
- **键盘/可达性**：触发器 `aria-haspopup/aria-expanded`、下拉 `role=menu`、
  项 `role=menuitem`（禁用态半透明）；Tab/Enter/Esc 可完整操作，外部
  pointerdown/Esc 关闭（与右键菜单同语义）；悬停切换菜单（有菜单打开时）。
  **箭头遍历（P2-4，2026-09-30 补全）**：触发器 ←/→ 环游（菜单打开时
  顺带切换）、↓/↑ 开菜单并聚焦首/末项；菜单内 ↑/↓ 循环（跳过禁用项）、
  ←/→ 切换相邻菜单、Home/End 首末项、Esc 关闭并回焦触发器——真实 DOM
  focus（Tab 语义不变），真浏览器键盘链冒烟钉住。
- **工作区契约**：`getWorkspaceViewport()` 高度扣减顶栏（拖拽/缩放钳制）；
  最大化窗口（§32.5 修订 12，2026-10-02 用户裁决）= `inset-0` 整视口真
  全屏——上缘到屏幕顶（盖过菜单栏带）、下缘到屏幕底（盖过 Dock 带），窗口
  层抬到 z-[45] 盖过全部 z-40 chrome（菜单栏/Dock/浮层栏），还原走窗口
  标题栏；桌面图标
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
  高 `h-14`（**56px**，2026-10-01 密度档原 64；`--ag-dock-height` 60，footer
  `pb-3` 悬浮 12px 底隙，总高 ≈72 ∈ 64~76），`max-w-[calc(100%-1.5rem)]` 溢出时图标行滚动。
- **几何契约（勿动）**：窗口按钮 `w-11 + gap-1` = **节距恒 48px**
  （σ44 波浪前提，§13）；波浪裁剪盒由 self-stretch 抬到整条胶囊高；
  `taskbar-item-*` testid 与可测量按钮保留（窗口动效锚点）。
- **组件**：激活指示改**极小圆点**（h-1 w-1，保留 `bg-primary` 类契约，
  弃 2×20px 胶囊条）；图标 22（密度档，曾 24）；启动器按钮 `h-10 rounded-full`；
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
- **头部**：`h-9`（**36px**，2026-10-01 密度档原 44）玻璃材质（弃 `bg-surface-raised` 实色，让框体玻璃
  连续），底边 `border-border-subtle` 发丝线；AppIcon 16 + 标题（激活
  text-text / 非激活 text-text-muted）。
- **交通灯**（主题无关常量 `--ag-wl-{close,min,max}`）：左置三枚 12px 圆点
  （close #ff5f57 / min #febc2e / max #28c840），命中区 24px；非激活窗口
  整组 opacity-60。**2026-10-02 用户裁决：去掉 ✕/—/⬛ 字形**（hover/聚焦
  曾显 Phosphor 8px 字形，随裁决移除；`--ag-wl-*-glyph` Token 退役）——
  纯色圆点 mac OS 素态；可访问名契约不变（`window.close/minimize/maximize/
  restore`——测试与 E2E 按名点击）；按钮 `onPointerDown` stopPropagation
  保留（拖拽不吞点击）。
- **窗体纸面**：§2.1 P2-6 终裁 92% 轻半透明（见上；预览工作台存档
  `.tmp/shots/paper-preview.png`）；动效契约（§12 WAAPI 常量/ghost/
  genie）与窗口状态语义零改动。
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
- **最近区（P2-5，2026-09-30 落地）**：`usage-store`（设备本地
  `agehaos.usage.recent.v1`，上限 8、按 appId 去重置顶）只记用户主动
  启动（`launchApp` 第三参 `source`，桌面自动开窗/小游戏轮换传
  `'system'` 不记）；扁平形态搜索框下显示「最近」3 瓦片（仍安装的），
  搜索态隐藏，分隔线后接全部网格。布局建议形态不接（建议驱动层级）。
- **缓办（无真实数据源不做装饰）**：独立 Categories（动态布局建议的
  分组已覆盖该语义）、560-680 全宽档（现有应用数量下 384-544 更克制；
  数量增长后再评估）。

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
- 关闭/互斥/回焦契约见 §0.4；弹层文字与表面 Token 见 §0.2（纸面）。

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
- **桌面四分辨率探针（Shell 3.0 STEP 10 响应式收尾，2026-10-04）**：
  `e2e/responsive-quad.spec.ts` 在 1280x720 / 1366x768 / 1920x1080 /
  2560x1440 实测几何并写证据（`.tmp/responsive-probe/<WxH>.json + .png`，
  永不提交）：①无横向 overflow；②system-rails 窄轨（left 16 / 内容 72 /
  垂直居中）与展开态 Workspace Panel（组 318 = 316 内容 + 描边×2）均整体
  在视口内、面板内容列自身无横向溢出；③右栏 Floating System Center 顶锚
  48 / 右留白 20 / 底不越 Dock 带（视口-88）；④Dock 高 68 / 离底 20 /
  水平居中；⑤窗口 launch 落点完整在工作区内（§33.4.1），向左拖出屏幕仍
  保有 ≥80px 可见带（window-manager MIN_VISIBLE_EDGE）且可拖回工作区。
  断言全部 boundingBox 实测；四档全绿，无需分辨率特例（几何全走 token）。

## 26. 左侧系统导航栏（Phase 2 P2-2，2026-09-30）

> **Shell 3.0 重构（2026-10-05）**：本节「系统导航栏 + 今日应用列」结构已被
> 左栏 **Workspace Rail + Workspace Panel** 取代（§34.1-§34.3）——条目收敛
> 为八钮窄轨（品牌 pin + 桌面/启动器/文件/笔记/终端/设置/通知），云同步开关
> 退出左栏（深链仍在设置账户区）；行式条目与 150px 栏宽（§33.4.1）一并退役，
> 回归 icon-first 80px 窄轨。下文保留作结构沿革，与 §34 冲突时以 §34 为准。

权威图左侧竖排导航的落地形态：**系统快捷操作轨**（`src/desktop/sidebar/
Sidebar.tsx`），与 Dock（运行中应用）/启动器（全部应用）/桌面图标职责正交。

- **七项真实动作**（拒绝装饰性谎言）：桌面=最小化全部 / 文件·终端·商店·
  设置=启动器 / 云同步=真实开关（`settings-sync`，开启态主色圆点；本地
  模式禁用 40% + 提示「远程模式登录后可用」）/ 通知=唤起通知中心（面板
  开合入 `notification-store.panelOpen`，顶栏铃铛与侧栏共享同一面板）。
  图中「用户中心」不建（与顶栏用户菜单重复）。
- **几何（2026-10-03 三次追加裁决：整块玻璃完全连续）**：玻璃面（背景/边框/
  圆角/投影/`fixed left-4 top-1/2`）上移到 Desktop 的 **system-rails 组容
  器**——一道边框、一份圆角、一份投影承载左栏 + 今日应用列两列；本栏退化为
  组内静态列（`w-[calc(var(--ag-rail-left-width)-0.5rem)]` = 72px；0.5rem =
  8px，Playwright 实测钉扎）。**两列之间无边框、无分隔线**（border-l 分隔线
  亦已按第三次裁决清除）。今日列不在场时组即纯左栏，外观与旧浮岛一致；
  <640px 由组容器 `hidden sm:flex` 承担（§25）。组容器禁止 overflow（会裁
  掉向右伸出的 tooltip）。级联窗口契约不变：`--ag-rail-left-width`(80) =
  CASCADE_BASE，级联窗口仍从左栏右缘起排（今日列在场时窗口滑过其下，同旧）。
- **项视觉**：Phosphor 18px 图标 + 11px 标签（密度档 py-1.5）、hover surface-raised 高亮、
  禁用 40%；通知未读徽标复用铃铛样式（`sidebar-unread`）。
- **缓办**：侧栏项当前无「激活态」概念（无持久选中语义——轨是动作不是
  导航上下文）；若未来加应用分区需先定义信息架构。

### 26.1 今日应用列（2026-10-03 用户裁决）

左栏**右侧再加一整列**放「今日」分类的应用：`src/desktop/sidebar/TodayRail.tsx`。

- **出现条件**：羽化开 + 今日世界就绪（store `world` 摘要含应用）才渲染——
  空栏即装饰性谎言，拒绝；与启动器「今日」分类同一数据源（世界行 hue 着色
  AppIcon + §6.4 确定性徽章），点按同走 `launchApp` 按需生成（kind=today）。
- **几何（2026-10-03 三次追加：并入 system-rails 单一玻璃面板）**：本列是
  组容器内的静态列（`w-[calc(var(--ag-rail-left-width)-0.5rem)]` = 72px，
  与左栏同宽），**无任何自绘边框/分隔线**（border-l 分隔线已按第三次裁决
  清除——两列之间完全连续）。玻璃面/定位/响应式隐藏全部归组容器（见 §26
  几何条）。
- **DOM 序约束**：组内 TodayRail 在前、Sidebar 在后 + `flex-row-reverse`
  （视觉上左栏在左）——同栈内后绘者在上，左栏向右伸出的 tooltip 恒盖住今
  日列（顺序反了会被毛玻璃挡住，2026-10-03 实测）。
- **禁止 overflow**：overflow-y 非 visible 会连带把 overflow-x 变 auto，
  向右伸出的 os-tooltip 被 own 容器裁掉（2026-10-03 实测教训）——本列与组
  容器都不得挂 overflow；应用数设计上限 10（§6.2），纵向天然放得下，不做
  滚动。
- **项视觉**：h-11 瓦片 + AppIcon(hue) 32px，悬停 os-tooltip「应用名 ·
  tagline」（SidebarItem 双轨同款）。

## 27. 右侧小组件栏（Phase 2 P2-3，2026-09-30）

> **Shell 3.0 重构（2026-10-05）**：右栏已重构为**漂浮 System Center**
> （§34.4）——容器不画材质、不再贯穿全高，四层（时钟→系统状态→最近通知→
> 今日世界）；日历收拢进时钟卡（可折叠）、今日壁纸卡退役（换壁纸入口在
> 菜单栏/设置）。下文保留作结构沿革，与 §34 冲突时以 §34 为准。

权威图右侧竖列的「真实数据源」落地：`src/desktop/widgets/WidgetRail.tsx`，
≥1280px（Tailwind xl）显示，**232px** 玻璃栏（2026-10-01 密度档原 272；
`--ag-rail-right-width` 与 `viewport.ts` 常量互指钉扎），hairline 瓦片卡片
（p-2.5/gap-2 密度档，克制非 SaaS 大白卡）。

- **四卡**：时钟（等宽数据层 2xl + 日期）/ 日历（周一开头月网格，今日
  主色圆块，纯日期数学）/ 系统状态（版本·语言·性能档·窗口数·未读，5 行
  mono 对齐）/ 今日壁纸（构图名 + 换一张，走服务端 5s 节流）。
- **缓办（无数据源不建）**：天气 / 音乐 / 照片。
- **几何**：工作区宽度 ≥1280 时再扣 272（普通窗口拖拽钳制）；最大化窗口
  不再让位右栏/左栏（§32 修订 9：全幅贴边，浮层栏置于窗口层之下）；动态
  面板自动停靠让位右栏。
- **层序坑（已修）**：轨道栏与顶栏同为 z-40，**必须先于顶栏/Dock 渲染**
  ——DOM 序靠前者垫底，否则右栏盖住顶栏右挂面板（用户菜单/通知中心）
  的指针事件（E2E core-path 抓出）。
- E2E：`e2e/widgets.spec.ts`（四卡可见 + 面板不重叠）；右键菜单与
  dynamic-desktop 两条 spec 的空白点位随面板左移更新（契约不变）。


## 28. 密度收紧档（2026-10-01 用户裁决「组件太臃肿」）

全局收一档、契约数字随迁（视觉权威 PNG 的意象不变，尺寸以本档为准）：

| 部位 | 原 | 现档 |
| --- | --- | --- |
| 顶栏高 | 32 | **28**（触发器/铃/用户钮 h-7） |
| 桌面图标 | 52 / w-24 / gap-1 | **44 / w-20 / gap-0.5**（py-1.5） |
| 窗口头 | 44（h-11） | **36（h-9）** |
| Dock 胶囊 | 64（h-16） | **56（h-14）**，`--ag-dock-height` 68→60，图标 24→22；**窗口钮节距恒 48px（σ44 前提）不变** |
| 右小组件栏 | 272 | **232**；卡 p-3→2.5、gap-3→2、时钟 2xl→xl、日历格 24→20、状态行距 1.5→1 |
| 侧栏项 | py-2 | **py-1.5** |
| 点击涟漪 | 在 | **移除**（§15） |

- 波浪引擎/自动隐藏/锚点/交通灯可访问名等行为契约零改动；css 契约与
  viewport 常量测试同步钉新值。


## 29. 桌面图标层移除（2026-10-01 用户裁决）

- **入口收敛**：应用启动 = 左系统导航栏（§26 常用项）+ Dock（运行态）+
  启动器（全部 + 最近 + 搜索）；桌面不再摆放图标，回归权威图的纯壁纸
  空间（壁纸是主角，§4 层级更干净）。
- **清除范围**：`DesktopIcons` 组件与测试、`e2e/desktop-icons.spec`、
  `--ag-desktop-label(-shadow)/-icon-hover` Token、`.desktop-icon-*` 类、
  `os-stagger` 入场动效（唯一消费者）、`desktop.iconsLabel` i18n 键；
  app-store E2E 的「安装上图标」断言改为「安装上启动器网格」。
- **连带裁决**：坑 35 的「商店安装自动上桌面」行为随层消亡（安装后由
  启动器/最近区承接曝光）。


## 30. 应用默认窗口一律横版（2026-10-01 用户裁决「不要竖版排版」）

- **裁决**：第一方应用（内置 + 商店目录）默认窗口一律宽 > 高；唯一豁免
  = 计算器（手持计算器物理隐喻，`resizable: false` 固定 300×440）。
  契约测试 `src/apps/window-orientation.test.ts` 钉住两个清单零竖版。
- **尺寸迁移**（旧 → 新）：

| 应用 | 旧（竖版） | 新（横版） |
| --- | --- | --- |
| 动态面板 | 360×520 | **680×420** |
| 时钟 | 360×420 | **480×360** |
| 便签 | 380×460 | **480×380** |
| 贪吃蛇 | 380×500 | **560×420** |
| 2048 | 380×520 | **560×420** |
| 记忆翻牌 | 380×500 | **560×420** |
| 扫雷 | 380×480 | **600×420** |

- **内容适配**：Type B 站点页在 app 内媒体查询（作用域 = iframe 视口 =
  窗口内容区）行布局——游戏页 ≥500px 宽改「棋盘左 + 右侧 160px 控制栏」
  （棋盘跨行、标题/得分/按钮/提示入右栏，2048 方向键排 2×2）；时钟
  ≥440px 宽双卡并排（时钟左、秒表右，字号降档防溢出）；动态面板卡片
  ≥560px 宽双列网格。拉窄回竖版自动回落单列/列布局（resizable 应用
  两向可用，历史会话恢复不受影响——窗口几何逐会话持久化的是用户
  实际尺寸而非清单默认值）。
- **几何连带**：桌面自动开窗（§20）与游戏轮换的 manifest 回退值同步
  680/560×420；E2E 空白右键点迁离新面板覆盖区（344-1024×52-472）。
- **验收**：本地 7 视图截图 + visual-judge（双列面板、四游戏行布局、
  时钟双卡全过）；E2E 时钟/便签/2048/面板四处新增「宽 > 高」断言。


## 31. Round 2 · Reference → Current → Diff → Implement（2026-10-01 用户重申参考图）

用户重申参考图为 Visual Source of Truth，要求按「参考 → 现状 → 差异 →
实施」循环迭代。基线截图（桌面/Dock/启动器三态）对照参考图得出差异表，
四片收口：

| 轴（§34） | 参考图 | Round 1 现状 | 本轮收口 |
| --- | --- | --- | --- |
| Layout/Spacing | 双侧浮动玻璃、留边离缘 | 左右通顶贴边栏（Web Sidebar 感） | **R2-1** |
| 层级/玻璃 | 卡片各自漂浮、之间留空气 | 右栏是一整块通顶面板（Dashboard 感） | **R2-1** |
| Branding | 中央 AgehaOS 字标焦点 | 空桌面无焦点 | **R2-2** |
| Dock | 大图标胶囊（约 40-48px 图标） | 22px 图标、存在感弱 | **R2-3** |
| Launcher | 居中宽幅玻璃面板 | 左下角 24rem 弹出 | **R2-4** |

- **R2-1 浮动双栏**：左栏 = 圆角玻璃卡（`bottom-3 left-2`、rounded-2xl、
  shadow-popover，宽度仍占 `--ag-rail-left-width` 带区——viewport/最大化/
  面板停靠几何契约零改动）；右栏容器只占位（`pointer-events-none`），
  四卡各自 `surface-glass rounded-xl shadow-popover pointer-events-auto`，
  卡间空气处指针穿透回桌面（右键空白契约保持）。
- **R2-2 中央品牌层**：`DesktopBranding`（aria-hidden + pointer-events-none，
  纯装饰）——无可见窗口时展示 Token 渐变字标 + `Your Web OS, Your Space.`
  + 辅线 + 副标语（zh/en 双键），任一窗口可见即 300ms 淡出（§19：绝不挡
  应用）；面板自动开启前有一瞬品牌呈现，全部最小化（桌面按钮）后回归。
- **R2-3 Dock 存在感**：Token `--ag-dock-height` 60→68 / `--ag-dock-icon`
  22→40 / `--ag-dock-item-pitch` 48→52（按钮 w-12 + gap-1；σ44 波浪前提
  σ ≤ 1.2×节距仍成立），胶囊 h-14→h-16、分隔线 h-8；自动隐藏/波浪/预览/
  锚点行为契约零改动。
- **R2-4 启动器居中**：扁平与布局建议两形态统一改 `left-1/2 -translate-x-1/2`
  + `bottom-[calc(var(--ag-dock-height)+1.5rem)]`（Spotlight 式），宽
  36rem（布局建议三档 36/40/42.5rem）、max-h + 内滚、网格 4→6 列。
  **连带修复**：启动器缺 Esc 关闭（旧锚定在左下角掩盖了它——居中后遮住
  窗口内容才暴露，app-store E2E 抓出）；Esc 处理挂在触发器+菜单的共同
  wrapper 上（焦点在按钮时 menu 不是其祖先，挂 menu 上收不到）。
- **已裁决不追**（对照差异表显式放弃）：拟真蝴蝶照片壁纸（Q2：不新增
  壁纸构图）、天气/最近通知/品牌卡（无数据源不建）、第五菜单「编辑」
  与「用户中心」（无真实动作）、空桌面常驻 Dock（自动隐藏出屏为 §11
  既定行为）、桌面图标层（§29 用户裁决移除）。
- **验收**：单测 +6（浮动契约×2、品牌层×2、Dock 几何、启动器居中 + Esc）；
  基线 101 文件 828 用例 + 80 后端全绿；E2E 16/16；visual-judge 对照
  参考图 4/4 PASS + 整体「同一设计体系、OS 感成立」。遗留妆造级备注：
  左栏标签为图标下排（参考图为图标右排），云同步禁用态标签低对比但可读。

## 32. 像素级还原 · 参考图全面落地（2026-10-01 用户指令「像素级还原」）

用户以参考图为唯一视觉权威，要求整页像素级还原（布局/组件/配色/壁纸/
间距），同时保持现有功能与业务逻辑可用。在 §31 Round 2 的四片之上，
本轮把 §31「已裁决不追」清单按新指令推翻重做，并把 chrome 材质从
「主题纸面」切换为「壁纸之上的白字玻璃」。

### 32.1 壁纸与动态桌面关系重裁决
- **照片基底常驻**：`WallpaperLayer` 新增 `PhotoSurface`（出厂壁纸 =
  `public/wallpapers/ageha-dreamland.jpg`，参考图同源画作的最大净空区
  裁切 + 2x 缩放——蝴蝶大部/顶部天空在参考图中被烘焙 UI 遮挡、不可恢复，
  属已声明差异）；指针视差沿用（§15 单层照片档），场层覆盖期间停用。
- **动态桌面出厂默认关**（DEFAULT_PREFS.enabled false，替代 2026-09-26
  「默认开」裁决）：开启后 field 场以覆盖层淡入照片之上（§4.5 过渡规则
  不变），关闭即回落照片。场渲染受「计划存在 且 开关开启」双门控。
- **出厂主题浅色**（DEFAULT_THEME light，替代 2026-09-30 深色出厂默认；
  存量持久化偏好不受影响）。

### 32.2 Chrome 白字玻璃作用域

> 弹层与 `.widget-card` 部分已被 §0.2 取代（改为纸面：白玻璃 + 墨字）。
- `.desktop-chrome`：在 chrome 子树重语义 Token（text=白阶 / border=白阶 /
  surface·glass=低透白 / primary=#5b8def），apps 纸面窗口不在作用域内，
  主题体系照旧；降透明/无 backdrop-filter 回落实色藏青（白字对比不变）。
  挂载点：MenuBar/Sidebar/WidgetRail/Taskbar(含启动器)/DesktopBranding/
  ContextMenu/SearchPalette。
- `.menubar-glass`：顶栏暗藏蓝半透条（参考图顶栏较天空更暗一档）。
- `.widget-card`：右栏卡白→蓝紫玻璃渐变（右栏所压壁纸区偏亮，纯白玻璃
  会隐入背景）。
- 几何 Token 对齐参考图：menubar 28→40 / rail-left 80→132 / rail-right
  232→336 / dock-icon 40→44（节距 52 不变，σ44 ≤ 1.2×节距成立）；
  viewport.ts 常量与 index.css.test 钉扎同步。

### 32.3 组件形态（对照参考图）

> 示例天气、Wi-Fi/蓝牙示意图标、「CPU」帧率估算、⌘K 固定徽标已被 §0.5 /
> §0.6 取代。
- **左栏**：八项「彩瓷贴(28px 渐变圆角方块)+右排标签」，顺序 = 桌面/
  应用商店/文件管理/终端/设置/云同步/通知中心/用户中心；「用户中心」
  经 `app-deep-link` 深链 Settings 直落账户分区（§32 新增模块级一次性
  意图，不改 window-store 数据结构）；「回收站」同理深链 Files 回收站视图。
- **菜单栏**：五菜单 文件/编辑/视图/窗口/帮助（「编辑」= 文档级
  execCommand 真实动作：撤销/重做/剪切/复制/粘贴/全选）；右侧状态簇 =
  Wi-Fi/蓝牙指示（Web 无实时源，title 标注示意）+ 电池电量（Battery
  Status API，不支持的环境隐藏）+ 日期 + 时钟 + 通知铃 + 用户菜单。
- **右栏四卡**：时钟天气（32px 等宽时间 + 日期 + 天气示例行 + 88px 壁纸
  缩略图；月历收拢进时钟卡，点击日期行展开）/ 系统状态（CPU 帧率抖动
  估算 + 内存 performance.memory + 网络 connection.downlink，<1% 保留
  一位小数，源不可用显「—」）/ 最近通知（store 最近 3 条 + 清空）/
  品牌横幅（蝴蝶 + 探索·连接·创造）。原独立月历卡/今日壁纸卡退役
  （功能分别收拢进时钟卡与 视图/右键 菜单）。
- **启动器**：左锚定（贴左栏、Dock 上方；<640px 回落 left-3）双栏面板
  410px（布局档 410/460/490px）——顶部搜索（⌘K 徽标）+ 左侧七项分类轨
  （最近使用默认，最近置顶的全量网格；搜索跨全应用）+ 右侧 4 列网格
  （44px 徽章）+ 推荐行（最近使用驱动）；Esc/重置契约不变。
- **Dock**：启动器瓷贴 + 常驻应用瓷贴（files/notes/calculator/terminal/
  store/settings，单实例激活语义：无窗启动/有窗恢复-聚焦-最小化）+
  运行中窗口（波浪/悬停预览契约不变 §13/§12，非瓷贴应用逐窗出列）+
  回收站深链。20 窗压力语义改为「瓷贴按应用聚合」（§32 E2E 更新）。
- **品牌层**：块中心 44%/29%，字标 72px（Ageha 白 + OS 冰蓝→粉渐变；
  字标豁免 chrome text-shadow——阴影会透过 bg-clip-text 压暗渐变，「OS」
  改用 drop-shadow 分离），标语 26px + 副标语 15px + 分隔线，顺序对齐
  参考图（分隔线在末）。

### 32.4 验收
- 四门禁：101 文件 835 用例 + 80 后端 + E2E 16/16 全绿；typecheck/lint/
  build 过。
- visual-judge 对照参考图：A（空桌面+Dock）/B（启动器）两页 pass；
  整体「并排观感高度一致」。残余差异（声明接受）：壁纸为同源画作净空
  裁切（蝴蝶大部/顶部天空不可恢复）；天气行为示例数据；通知卡空态真实；
  Dock/启动器仅含真实应用；右栏卡片在壁纸亮部区域存在感弱于参考
  （已用蓝紫玻璃渐变 + 阴影补偿）。

### 32.5 修订 9（2026-10-01，用户裁决系列：Dock 交互与最大化契约）

- **Dock 常驻（修订 8 落地）**：自动隐藏机制整体移除（见 §9）。
- **悬停预览锚定**：`createPortal` 至 body + 图标中心横向居中 +
  `bottom-[calc(var(--ag-dock-height)+1.25rem)]`——玻璃胶囊的
  backdrop-filter 会劫持 fixed 后代的包含块（坑 13 再变体），portal 后的
  fixed 弹层必须显式 bottom（bottom-full 相对视口=屏顶）。
- **Dock 图标无底色**：瓷贴/运行中/启动器触发/回收站按钮去除
  hover/active `bg-surface-raised`（44px 徽章坐 48px 按钮，浅底在玻璃
  胶囊上显成图标四周白边）；激活态只剩指示点。弹层内部 hover 底色保留。
- **最大化全幅（§19/§27 契约更新；修订 9 → 12 两步演进）**：修订 9
  （2026-10-01）先改为横向全幅 + 上贴菜单栏下界 + 下贴 Dock 边界；修订 12
  （2026-10-02 用户裁决「依然被上下组件阻拦」）改为 **`inset-0` 整视口真
  全屏**——盖过菜单栏带与 Dock 带及全部 z-40 chrome（窗口层 z-[45]），
  还原走窗口标题栏。普通窗口拖拽钳制（`getWorkspaceViewport` 扣栏）不变。
- 验收：单测（WindowFrame 几何+层级契约、Taskbar 无底色契约、预览 portal
  契约）+ E2E `e2e/window-maximize.spec.ts`（几何边界 ±1px + elementFromPoint
  遮挡探针 + 还原回落）+ `e2e/taskbar-autohide.spec.ts`（预览居中 |Δ|≤2px、
  悬停 computed 透明）；四门禁全绿，E2E 18/18。

## 33. Desktop Shell 2.0 · Floating OS Environment 高保真精修（2026-10-02 用户 /workflow 交付）

方向裁决：从「Sidebar + Content + Dashboard」彻底转为 **Floating OS
Environment**（macOS-like + 日系未来 + Modern SaaS + Calm Glassmorphism），
关键词 Glass / Light / Space / Butterfly / Future。重点是 Space / Hierarchy /
Depth / Proportion / Floating / Atmosphere，不堆特效；不重写 Window Manager /
Motion / Wallpaper 引擎，不删功能删测试，自动隐藏保持退役（§9 常驻 Dock）。
设计规范全程稿：`.tmp/shell2-design-brief.md`（会话产物，数值已收敛入本节）。

### 33.1 玻璃七面材质表（blur 阶梯 Token 化，逐格互异，层级递进）

Wallpaper → Desktop → Window → Popover → Modal 递进成立；大面=玻璃、
小控件=实色；backdrop-filter 源码只写标准属性（§32.3 坑 A 铁律）。

| 面 | 类 | blur | 底色（light·白系 / chrome 作用域 remap） | 阴影 |
| --- | --- | --- | --- | --- |
| menubar | `.glass-hint` | 12px | menubar-glass 白10% | 无（细底边 10%） |
| widget | `.widget-card`（Acrylic 特例） | `--ag-widget-blur`=3px | Acrylic tint 渐变 | shadow-panel |
| rail 左栏（system-rails 组） | `.glass-liquid`（2026-10-02 液态玻璃裁决） | 2px 保底柔化 + SVG 位移折射（#ag-liquid-rail） | surface-glass 基底 | `--ag-shadow-float` + inset 高光 rims |
| dock | `.dock-glass` | 28px | 白22% | `--ag-shadow-dock` |
| window | `.glass-deep` | 36px（`--ag-blur-xl`） | surface-glass 白72% | shadow-popover 档 |
| popover | `.popover-panel` / `.glass-popover` | 44px（`--ag-blur-2xl`） | `--ag-glass-bg-strong` 白86% / 墨84%（chrome remap 白26%） | shadow-popover |
| modal | 实色 | — | #ffffff / #1a2540（唯一非玻璃大面） | shadow-popover |

新增 `--ag-tooltip-bg rgb(18 26 44/92%)`（主题无关）；新玻璃类源序严格插在
`.surface-glass` 基规则与降透明/`@supports` 兜底之间（源序即降级）。

### 33.2 几何 Token 重定档（viewport.ts 常量 + CSS↔TS 互指钉扎同步）

- menubar 40→**32px**（简报 28-32 档；字号 13px，等宽数据读出 11-12px 豁免）。
- rail-left 132→**80px**（简报 72-88 档；浮岛 left 16px / 垂直居中 / 圆角 20px）。
- rail-right 296px 不变（卡宽 288 在简报 280-320 档内）；右栏节奏 right
  **20px** / gap **16px** / 顶锚 menubar+16=**48px**。
- dock 高 **68px**、新增 `--ag-dock-gap` **20px**（胶囊距底）、图标 **48px**、
  节距 **56px**（σ44 ≤ 1.2×节距仍成立）、圆角 24px。
- 悬停预览/启动器等 fixed 弹层底部锚定统一消费 `--ag-dock-gap`。

### 33.3 组件形态

- **左栏 = Floating System Rail**：icon-first（44px 方钮 + 18px 字形），文字
  标签改自绘 `os-tooltip` 气泡（group-hover/focus-visible 点亮，aria 不进
  可达树）+ 原生 title 双轨；八项彩瓷贴与用户中心/回收站深链全保留；
  active 态 = 既有 hover 瞬态（八项均动作入口，无「当前项」常亮选中语义）。
- **右栏 = 漂浮系统 Widgets**：容器不画材质（pointer-events-none），四卡
  各自独立接针 = 桌面上四个独立漂浮面板；功能（时钟天气含月历/系统状态
  真实指标/最近通知/品牌横幅）零改动。
- **菜单栏 = OS Menu Bar**：五菜单→四菜单 `file/view/window/help`，原
  「编辑」6 项 execCommand 动作整体迁入文件菜单第二分组（能力零删除，
  `menubar.edit.*` i18n 键保留）；右簇 = System 纯指示（Wi-Fi/蓝牙/电池，
  不做假交互）+ **Cloud 同步状态按钮**（三态，点击深链设置账户分区）+
  通知铃 + 用户菜单 + 时钟移最右（macOS 惯例，`menu-bar-clock` testid 不变）。
- **Dock**：几何按 §33.2 精修；波浪/悬停预览 portal 居中/无底色按钮/
  运行中指示点/回收站/常驻契约全部不变。
- **窗口**：16-20px 圆角 + 细边 + 软阴影 + 半透明面 + 聚焦/失焦层级；
  最大化 `inset-0` 真全屏契约（§32.5 修订 12，z-[45]）原样保留。
- **品牌层**：50%x（与 Dock 中线对齐，2026-10-02 裁决，原 44%）/29% 位置基线不变，视觉更轻；文案 AgehaOS +
  「Your Web OS, Your Space.」；无可见窗口才显示的既有语义保留。

### 33.4.1 单栏拉长（2026-10-02 用户三连裁决）

- system-rails 组上下锚定（上 = 菜单栏 +12px、下 = Dock 上 16px）拉长全高；
  今日应用列退役，组内单栏。
- 左栏条目改行式：瓷贴左 + 名称右（13px 常显，气泡 tooltip 退役，原生
  title 保留）；栏宽 Token --ag-rail-left-width 80→150px（viewport 常量/
  启动器锚点随动）。
- 连带 §25：launch 位置兜底升级为「完整落在左右浮轨之间的工作区」——宽度
  钳到工作区内宽、水平居中、y 钳进纵带（Token 实测轨道宽，防 apps→desktop
  循环不经模块导入）。

### 33.4 验收

- 六切片各过完整五门禁（typecheck/lint/test/build/test:e2e 逐切片跑真）；
  终态基线 **847 前端（102 文件）+ 80 后端 + E2E 19/19**。
- 截图取证 7 状态（1920×1080）+ 1280/1366/2560 三视口（横向溢出探针全
  false）；5 名独立评审员并行评审（含与参考图十轴对比）1 轮 2 问题
  （SearchPalette 补挂 `.glass-popover` 弹层独立材质档；AppLauncher 输入
  placeholder/kbd 徽章对比度提升 + 底部锚定改 `--ag-dock-gap`），修复后
  五门禁复验全绿 + 复拍确认。

### 32.5 修订 13（2026-10-02，用户三点裁决：Dock 悬停 / 红绿灯 / 零自动开窗）

- **Dock 悬停只浮起被悬浮的一枚**：§13 波浪引擎（高斯邻位联动）整体删除
  （wave.ts / use-dock-wave.ts 及测试；motion-lab/ 归档保留），改为 index.css
  的 hover 浮起规则（translateY(-3px) scale(1.18) + cobalt 28% 光晕；触屏与
  reduced-motion 不浮起）。零底色 / 悬停预览 / no-scrollbar 契约不变。
- **红绿灯去符号**：窗口左上三灯去掉 ✕/—/⬛ 字形（--ag-wl-*-glyph Token
  退役），纯色圆点；可访问名契约不变（§21）。
- **进桌面零自动开窗**：动态面板自动打开（原 §26/ADR 裁决）与小游戏轮换
  自动弹出整体退役——桌面空闲态回归纯壁纸 + 品牌层；面板经启动器/搜索手动
  打开，游戏手动启动；game-rotation 纯函数保留。E2E：dynamic-panel/
  responsive/widgets 改 helpers.openDynamicPanel 手动开；motion-lab 重钉
  「悬浮浮起 + 邻位不动 + 移开归位」；Desktop 单测钉零开窗。

## 34. Desktop Shell 3.0 · 结构重构（2026-10-04/05，十切片全量落地）

方向：Shell 2.0「Floating OS Environment」（§33）的桌面结构进化为
**Workspace Environment**——左侧从静态动作导航升级为**漂浮 Workspace Rail +
可展开 Workspace Panel**，右侧从组件卡 Dashboard 收敛为**漂浮 System
Center**，中央品牌层从常量降为**桌面状态驱动**；Dock/窗口/启动器/全局搜索
逐面视觉精修；响应式以四档分辨率几何探针收口（§25 末条，STEP 10）。十个
切片各自过完整五门禁（typecheck/lint/test/build/test:e2e）+ 视觉验收后独立
提交（6ad42bf → ad1a07d，另有 bb010b8 通知中心列表定高修复）。本节与
§20-§23 / §26 / §27 / §33.3 / §33.4.1 冲突时以本节为准；横切契约全部延续：
弹层互斥（§0.4）、chrome 不挡应用（§19 零容忍）、真实数据源拒绝装饰性谎言
（§0.5）、组容器禁 overflow（§26 教训）、窗口状态语义与 core 零改动。

### 34.1 Workspace Rail（STEP 1）

左侧 `system-rails` 组容器退化为**单列窄轨**（今日应用列退役，§33.4.1 的
150px 行式栏一并退役）：`fixed left-4 top-1/2 -translate-y-1/2` 垂直居中
浮岛，玻璃面（rounded-xl 20px + border + shadow-float，液态玻璃位移折射
保留）归组容器；内容列恒 `--ag-rail-left-width - 8px` = 72px。**icon-first
八钮**（44px 圆钮 + 20px 字形，hover/active 轻 translucent capsule，禁实心
色块）：品牌钮（= 面板展开 pin 开关）+ 桌面（最小化全部）/ 启动器 / 文件 /
笔记 / 终端 / 设置 / 通知（未读徽标保留）。可访问名由 `aria-label` 承载
（收起态 `os-tooltip` 气泡已退役 2026-10-06 终审遗留清理——hover/键盘聚焦
任一路立即展开面板，气泡在唯一能点亮的两态下都被 `data-expanded` 隐藏，
不可达死代码；展开态名称面板常显）。**窗口钳制仍钉
RAIL_LEFT_WIDTH_PX=80**——312px 展开是纯浮层几何，不改窗口布局。
**2026-10-06 用户裁决：窄轨背景整体退役**——岛底玻璃（glass-raise）/边框/
投影/图标常驻底座（surface-raised）全部删除，条目间隙 gap-1→**28px**（同日
三连加大：gap-4 → gap-5+圆钮 44→40px → 28px；**轨底分隔线 + 收起手柄随
28px 预算退役**——手柄与品牌钮同为 pin 开关属功能重复，开合走品牌钮，
收起路径另有 Esc / 面板外按下 / 鼠标离开宽限；BrandLogo 26→24），图标
直接浮于壁纸（「原本就在桌面上」的原生感）；交互态保留 surface-elevated
轻 capsule，品牌钮渐变 squircle 徽章保留；左侧玻璃只余展开面板岛一岛。
**同日追加裁决：面板幕帘面趋近透明**——新增 `.glass-veil`（白 2.5%，材质
增量区新档）替下 surface-glass 的 chrome 档 8% 白底；**磨砂 backdrop 随即
整体退出**（glass-hint 12px 在展开过渡结束才生效、整块读作乳白毛玻璃——
用户实测「只有展开那一瞬间透明」的根因），现仅存白纱 + 发丝边 + panel 投影
定形；降级环境兜底回实色契约不变（index.css.test 源序钉扎已纳 .glass-veil）。
**三连裁决：底部磨砂渐隐带**——文字衬底方案（.text-scrim）一小时即撤
（git revert cbb18c1），改在面板下段铺 `.panel-frost` 磨砂带（blur sm 档
12px + mask 向上渐隐无硬边界，top-1/3 起铺、内容层绘制其上不被波及）：
「只要一些磨砂、整体保持透明感」。
**再裁决（同日晚）：毛玻璃回归 + 顶透下白**——窄轨 glass-raise（blur 20）
+ 边框 + 投影按原样恢复（裸浮试验 git c77275a 回撤；28px 间隙、40px 圆钮、
手柄退役、气泡退役等加隙/清理裁决全部保持）；面板 veil 升级为**顶透下白
渐变**（复核后定档：顶部白 4% → 底部白 20%——用户复核「不够亮」，底部超
右栏卡片 12% 档一截；「到最下面时变得和右侧卡片一样白，最顶上不要很白」
后追加减裁），panel-frost 磨砂带改全幅铺装（inset-0）且 mask 不落到全透
（顶部保留 40% 强度基础磨砂——「顶部也要有一些毛玻璃」——底部全磨砂）：
毛玻璃质感全域存在、自上而下渐强。**顶栏不在本裁决内，保持裸浮**。
**亮度终裁（对照右栏卡片实测）**：卡片真实配方 = .widget-card 作用域
（--ag-glass-bg 白 80% + 浅纸墨字令牌组）+ Acrylic tint（白 76%→66% 纱），
此前 20% 底档远不可比。veil 改三段渐变，**衰减跨度=整个面板**：顶部
**冷白 15%**（同一亮白的一丝痕迹，非全透——用户复裁）→ 55% 处白 42% →
底部**冷白 88%**（#eef4ff 档，对齐卡片观感）；**面板内容随之切入
`.panel-paper` 浅纸墨字作用域**（并入 .widget-card 同一组令牌声明，零
复制；底部近实白上白字不可读，墨字与右栏卡片同规则；顶部近透区墨字由
壁纸亮部云天承托）。今日空间卡自带图片+遮罩、active 渐变胶囊自带
primary-contrast 白字，均不受作用域影响。

### 34.2 Workspace Panel 展开态（STEP 2）

hover / click pin / 键盘三路触发合并为 `expanded`（`use-workspace-panel.ts`
状态机）：mouseenter 立即展开、mouseleave **240ms 宽限**收起；focusin 展开、
focusout 出界收起（指针来源的焦点经 pointerdown 置位抑制，不令面板对鼠标
用户常开）；品牌钮切换 pin；Esc / 面板外按下 / 启动器或通知中心打开（弹层
互斥）收起，收起时焦点交还品牌钮。轨道 80→**312px**（`--ag-rail-left-expanded-
width`；Shell 3.1 F1 从 324 收敛，280-320 带内、内容列 304px）
宽度过渡，内容列淡入 + 位移。面板是连续 Workspace Environment（不切成一堆
card），自上而下 = 品牌区（BrandLogo + 字标 + 标语）→ 今日空间（真实日期 +
问候引擎时段 + 当前用户称呼）→ **工作空间 selector**（个人/学习/开发/创作，
localStorage 持久化，选中态 = 主色 capsule；架构记录见 ARCHITECTURE.md §3.24）
→ 最近使用（usage-store 真实数据 × 工作空间亲和稳定排序，前 4）→ 底部今日
世界入口（34.3）。**收起态内容列 inert 不进可达树，且首展才挂载**（渲染期
派生重置）——净桌面 reload 预算（PRD §29.1 <3s）不为本面板付费。
**Shell 3.1 STEP 1 减重记录（只减不加）**：岛二材质降档——玻璃 blur 20→12
（glass-raise→glass-hint，窄轨保持 raise 不动）、边框 border→border-subtle
（发丝级）、投影 shadow-float→shadow-panel；今日空间卡黑色渐变遮罩
from-black/55→from-black/40（照片细节更可见，白字由 chrome text-shadow 兜
底）；工作空间 selector 选中胶囊保留 `--ag-capsule-active` 但去 shadow-sm
（未选中项仍 muted + hover surface-raised，无彩底）；最近使用行紧凑档——
h-9→h-8、AppIcon 22→20、行尾箭头删除；分区留白 gap-3→gap-4，分区标题仍
11px muted。

### 34.3 今日世界品牌入口（STEP 3）

Workspace Panel 底部（mt-auto 锚底 + hairline 分隔）：数据零新取数，复用
羽化编排器写入 `eclosion-store` 的世界摘要（headline / apps.length /
worldDate 对 `utcDayKey` 的 fresh/stale 如实标注）。「查看世界 →」经
`launcher-intent.ts` 模块级一次性意图打开启动器并直接落在「今日」分类（不
改 launcher-store 数据结构）。门控：羽化关（默认）→ 整区不渲染；开但世界
未落地（拉取中/503 静默降级）→ 安静空态，不渲染跳转钮（无死按钮）。

### 34.4 Floating System Center（STEP 4）

右栏 `WidgetRail.tsx` 重构为四层漂浮层级 = **时钟日期 → 系统状态 → 最近通知
→ 今日世界**：容器不画材质（pointer-events-none）且不再 bottom 锚 + 贯穿
全高滚动（Dashboard 侧栏形态退役）——高度由内容决定，仅当超出「顶锚
menubar+16=48px + 底部 Dock 区 88px」剩余空间才兜底滚动；定位 right 20px /
宽 `--ag-rail-right-width - 8px` = 288px。四卡：时钟（32px 等宽时间 + 日期
toggle 折叠月历 + 本地时区长名行；壁纸缩略图退役）→ 系统状态（真实指标：
rAF 连续 60 帧实测 fps / performance.memory / connection.downlink，行内细
进度条只来自测量值本身，源不可用显「—」不画条）→ 最近通知（3 条 + 清空 +
「查看更多」复用通知中心面板）→ 今日世界（羽化世界卡，门控同 34.3，替代
原品牌横幅——品牌已由中央层与 Panel 品牌区承载）。≥1280px（xl）显示。
**Shell 3.1 STEP 2 权重分级（F2：Clock > System > Notification > Today
World）**：统一卡材质拆两档——Clock/System 保持全档卡（p-4 + border-subtle
发丝边 + shadow-panel；System 标题降为 11px muted caption，三行指标
label muted + 等宽数值 + h-1 行内细条不变）；Notification/World 降 quiet
档（p-3 + 无边框 + shadow-soft，标题 caption 化）——投影几乎贴桌面、明显
后退。通知默认 2 条（原 3 条，**收纳入口「查看更多」仅 items.length > 2 时
渲染**——视觉评审第 2/3 轮打回修正：无「其余」时入口即死链接；「清空」仅
有通知时渲染，空态隐藏）；空态 = §3 构图（居中半透明铃铛 + `notification.empty`
原文案 + 指向通知中心的弱化链接——链接文案用 `notification.center`
（「通知中心」，**不借用「查看更多」**：0 条通知与「查看更多」同框即折叠
语义自相矛盾，第 3 轮打回修正），i18n 零新增），通知中心弹层空态同构图
（铃铛 + 原文案，无跳转链接——本尊即中心，视觉评审 H-notification-empty
打回后同步）。数据面零新增：系统状态仍只有流畅度/内存/网络三项（禁
GPU/Disk/Battery/进程数），时钟卡无假天气（§0.5）。**Shell 3.1 STEP 3 迁入
记录（F3 顶栏信息减法）**：顶栏「今日桌面由 N 条趋势信号生成」小字及来源
弹层迁出菜单栏——世界卡摘要行下新增弱化信号行（`widgets/WorldSignals.tsx`），
点击展开信号列表弹层（createPortal 至 body +
bottom 定位；`usePopoverDismiss` 槽 'world-signals' 与 branding hidden 档
联动保持；「重新生成今日世界」入口随迁，仍是唯一重生成入口）。门控：羽化关
整卡不渲染；世界 null/跨日陈旧/signalCount=0 → 卡在而信号行不渲染。i18n 键
menubar.worldSignals* → widgets.world.signals*。**终审遗留去重（2026-10-06）**：
信号行文案收敛为「趋势信号来源」（与弹层标题同键）——headline 为生成内容、
已含「由 N 条趋势信号织成」措辞，行内复述计数即同卡冗余，原计数键退役。

### 34.5 中央品牌层状态化（STEP 5）

品牌层从「无可见窗口才显示」的开关语义升级为**四档 opacity 状态机**
（`branding-visibility.ts` 纯函数 `brandingTier`）：`hidden` 0%（任一 chrome
弹层打开：启动器/全局搜索/通知中心 + popover 互斥槽兜住的菜单栏下拉/用户
菜单/世界信号/右键菜单）→ `full` 100%（空闲无可见窗口）→ `dim` 40%（单
可见窗口）→ `faint` 15%（多窗口，桌面已是工作台）。位置/字号/渐变沿用 §31/
§32 修订 7 基线；过渡复用既有 `transition-opacity`（300ms ease-out），无第
二套 motion。**性能契约**：全部 store 订阅取原始值选择器（计数/布尔而非数
组引用）——窗口 move/resize/focus 每次 commit 新数组但档位不变 → 零
re-render；重渲染只发生在档位真正变化时。纯装饰层 aria-hidden +
pointer-events-none 恒成立。**Shell 3.1 STEP 4 精修（铭牌化，档位值复核为
已合规不动）**：容器双层蓝紫投影（0_1px_3px 60% + 0_4px_18px 35%）减弱为
单层低强度（0_2px_10px 35%）——去「营销页悬浮光晕感」；分区留白 gap-4→
gap-3 微收；hidden 档完整性复核——七类遮蔽（启动器/搜索/通知中心/菜单栏
下拉/用户菜单/右键菜单/世界信号弹层）全经 `usePopoverDismiss` 互斥槽由
`popoverActive` 兜底触发 0%，世界信号槽 'world-signals' 在 STEP 3 迁移后
不变；组件测试钉「transition 三件套恒挂 + opacity 类恰一个且阶梯单调」。

### 34.6 Dock 视觉精修（STEP 6）

全 pill 胶囊退役（§20 的 `rounded-full` 形态），改 **24px 圆角矩形玻璃舱**：
新几何 Token `--ag-dock-radius: 24px`（`rounded-[var(--ag-dock-radius)]`），
`dock-sheen` 釉面扫光层经 `border-radius: inherit` 自动随动。active 指示器
从 4px 点（h-1 w-1，§20）改**底部 2px×16px primary 细条**（`h-0.5 w-4`
rounded-full，瓷贴与运行中两处）。几何契约不变：高 `--ag-dock-height`=68 /
离底 `--ag-dock-gap`=20 / 水平居中 / 窗口钮节距 48px；Auto Hide、悬停单枚
浮起（§32.5 修订 13）、悬停预览 portal、单实例激活、回收站语义零改动。
**Shell 3.1 STEP 5 微抛光（禁改运动）**：胶囊细边 strong→subtle（发丝级，
Dock 靠投影浮起不靠描边）、内距 px-2→px-2.5（舱壁呼吸）；胶囊底白 22% 复
核为已柔和保持（§26 优先 opacity 不加 blur，未动）；active 2×16 细条与
几何 token 全部零改动，dock-wave 运动链（applyWave/[data-wave-icon]/σ56）
原样。扩展性实证（§24）：`max-w-[calc(100%-1.5rem)]` + 运行中行
`no-scrollbar overflow-x-auto` 既有实现经 e2e 钉扎——800×600 下 12 个
运行中窗口时 Dock 宽 ≤ 视口−24、图标行 scrollWidth>clientWidth 可滚、
启动器可达（taskbar-autohide.spec 扩展性用例）。

### 34.7 窗口视觉精修（STEP 7）

聚焦/失焦对比拉开（§21 的「细腻五感」升档）：**active 档** = 更高面实度
`--ag-window-face-active`（浅 84% / 深 78%）+ 更强大气软影 `shadow-window-active`
（0 24px 64px 20%，只加深不收窄）+ **中性细边 `border-border-strong`**
（primary/50 蓝描边退役——强调色只留给内容）+ **44px 头部**（h-11，§28 密度
档的 36px 退役）；inactive 档 = 基底玻璃 + `shadow-window-flat` + muted 标题。
radius 20px（rounded-xl）/ 深玻璃 blur 36px（§33.1 window 档）不变；窗口
状态语义、最大化 `inset-0` 真全屏（§32.5 修订 12）、拖出屏幕 ≥80px 可见带
（MIN_VISIBLE_EDGE）全部零改动。

### 34.8 启动器 = 居中 Application Launcher（STEP 8）

弃左侧分类轨的 Windows 开始菜单形态（§22），改**视口居中的大幅玻璃面板**
（`createPortal` 至 body，坑 13 包含块铁律）：宽度档 **600/640/680**（采纳
布局建议三档，560-680 带内），高度档 **560**（`min(560, 100vh-10.5rem)`；
STEP 8 原 520——Shell 3.1 场景 F 修正：分类网格随世界清单扩到两行后 520 档
裁第二行瓦片名称标签，高度抬档 + 瓦片 py-2.5→py-2 + 主区 gap-3→gap-2 同步
容纳），结构自上而下 = **Search → Recent → Pinned →
Categories**（分类降为芯片行 + 6 列瓦片网格，AppIcon 44 + 11px 标签）。
Recent = 真实 usage-store 最近 × 工作空间亲和稳定重排（推荐语义）；Pinned
与 Dock 常驻瓷贴消费同一份 `PINNED_APP_IDS`（单一来源）；搜索跨全应用，
键盘 ↑↓ 高亮 / Enter 启动（与 Ctrl+K 同一键盘模型）、Esc 关闭回焦。羽化
「今日」「我的羽化」动态分类保留。同名瓦片 testid（app-store/sdk-fs-note/
sdk-sticky）收敛进 `launcher-grid` 作用域（E2E 取位修复）。

### 34.9 全局搜索 = Spotlight 形态（STEP 9）

Ctrl+K 面板（§23）精修为 Raycast/Spotlight 比喻：**640px（w-[40rem]）居中
大玻璃面板**（glass-popover 弹层材质档），结构 = Search（大号无边框输入 +
放大镜）→ 结果区（**空查询 = 真实「最近使用」速览**；输入后 = Apps → Files
→ Actions 三段，**想象域落位 Actions 区**——羽化入口/门控/生成全保留，恒排
两域之后）→ 底部 kbd 芯片提示条（装饰性，真实键盘模型在输入框）。三域一屏
键盘全程可达（↑↓/Enter/Esc）；搜索逻辑（rankApps/VFS 搜索）与 testid 契约
不变。

### 34.10 响应式收尾（STEP 10）

见 §25 末条「桌面四分辨率探针」：1280x720 / 1366x768 / 1920x1080 /
2560x1440 四档 Playwright 几何探针全绿（无横向 overflow、窄轨/展开 Panel/
System Center/Dock/窗口拖出可见带全部 boundingBox 实测），证据留
`.tmp/responsive-probe/`（永不提交）；零分辨率特例——几何全走 Token。

**Shell 3.1 STEP 7（2026-10-06）**：四档探针在精修终态复跑全绿（F1 面板
312/304 收敛、STEP 5 Dock 发丝边之后），并补「视觉中心稳定」断言——
desktop-branding 空闲满档中心点须落（视口宽 1/2，高 30%）基线（±1/±2px，
任务书 §30「Central Branding 真正居中」）；四档证据同目录 `<WxH>.json+png`。

### 34.11 验收与基线

- 十切片各自五门禁 + 视觉验收逐片跑真（切片记录：6ad42bf/a34f6ce/6b735c0/
  abaa2c1/6cdddad/bb69bbf/7f62c59/b57e753/ef3cd9d/ad1a07d + bb010b8 修复）。
- 落档时全量基线实测（`npm run test`）：**前端 1217（124 文件）+ 后端 157
  （11 文件）+ 部署库 12** 全绿；Playwright E2E 25 spec / 57 test 块（羽化
  域 26 条）随切片门禁全绿。
- 新几何/材质 Token：`--ag-rail-left-expanded-width`(324；Shell 3.1 STEP 1 收敛为 312)、`--ag-dock-radius`(24)、
`--ag-window-face-active`、`--ag-shadow-window-active`（viewport.ts 常量与
CSS 互指钉扎纪律不变）。

## 35. Mobile Design Contract（双 Shell 移动侧契约，M0 落基 2026-10-07）

> Mobile Shell（`src/mobile`，架构见 ARCHITECTURE.md §3.25）的视觉契约。
> M0 五片只落「骨架与纪律」（Shell 选择 / safe-area / PWA 基础，提交
> 1f7a2e4→7bc494e），本节同时钉住 M1 组件的视觉边界；移动作用域内与
> §0–§34 桌面契约冲突时以本节为准，桌面零接触。M1 六片已于 2026-10-08
> 落地（15d7265→87042df），Home 结构规格见 §35.7。M2 六片已于
> 2026-10-08/10 落地（4a53934→0c6119e），Bottom Sheet 形态语言、控制
> 中心与边缘返回手势规格见 §35.8。M3 六片已于 2026-10-10/11 落地
> （e6a5b29→5d180cb），最近任务覆盖层 / PWA 安装条 / Files 长按操作单
> 规格见 §35.9。M4 五片已于 2026-10-11/13 落地（5e3b1ab→36cc83b），
> 全域搜索分组 / 通知跳转 / 云同步状态 / Terminal 快捷键行规格见
> §35.10。

### 35.1 玻璃克制清单（白名单制）

移动 Shell 的 backdrop-filter 玻璃**只允许五处**——**Header**（状态栏条）、
**Dock**、**Today 卡**（今日世界卡）、**Bottom Sheet**、**Dialog**。清单外
一律实色或轻透明白纱，不引入 blur：M0 已按此纪律执行（两条 safe-area 占位带
只用 `--ag-*` 中性色，`src/index.css` 移动段注释明示「不引入 blur/
backdrop-filter」）。桌面 §33.1 的七面玻璃材质表不在移动作用域内生效。

### 35.2 safe-area 契约（M0-3/M0-4 已落）

- **声明**：`--safe-top/right/bottom/left`（`env(safe-area-inset-*, 0px)`）
  只在 `.mobile-shell` 根类上声明（`src/index.css:1123-1128`），**不进
  `:root`/`.dark`**——桌面根上未声明（E2E 钉住空串，`e2e/mobile-shell.spec.ts`
  desktop context）。无刘海视口 env 恒 0。
- **消费位**（M1 新组件一律走这两类既有消费位，不得自读 env()）：
  ① `.mobile-shell-frame` 只消费 `--safe-left/right` 做左右横屏 padding；
  ② 上/下安全区由两条占位带的 max() 高度承担——`mobile-statusbar-slot` =
  `max(var(--safe-top), 24px)`（M1 状态条最小可读高度）、`mobile-dock-slot`
  = `max(var(--safe-bottom), 12px)`（M1 Dock 最小落点）。frame 再加纵向
  padding 会**双重计入**，禁止。
- **前提**：viewport 带 `viewport-fit=cover`（index.html）——没有它真机
  env 恒 0；`black-translucent` 状态栏（PWA）下内容延伸进状态栏底下，由
  占位带顶开。
- **壁纸例外**：壁纸层 absolute inset-0 挂在**未加 padding 的 shell 根**上
  （padding 盒会内缩 absolute 后代）——壁纸必须全幅铺满，不随安全区裁剪；
  内容才受安全区约束。
- 滚动容器 `.mobile-content-scroll` 预留（`overflow-y:auto +
  overscroll-behavior:contain` 防滚动链传给壳根），M1 的 Home/应用视图挂这里。

### 35.3 touch target 下限 44px

移动作用域内一切可点击目标（图标 / 按钮 / 列表行）**命中区 ≥44×44px**——
视觉尺寸可以更小，命中区不行。桌面密度档（§28 的 28–40px 控件规格）不带进
移动。

### 35.4 壁纸竖屏 object-position 原则（焦点不裁坏）

竖屏视口下壁纸裁剪以 **object-position 保住画作焦点**（揚羽蝶主体）——裁掉
的是边缘不是焦点。M0 壁纸层为全幅横铺（与桌面同一 `WallpaperLayer`），竖屏
裁剪策略归 M1 落地时按本原则实施；届时焦点位偏移必须可测试，不允许「居中
cover 顺手裁掉蝴蝶」。

### 35.5 reduced-motion 承接

`prefers-reduced-motion` 的全局令牌塌缩（§2.5 / §11 / §14）对移动 Shell
**同样生效，不建第二套动效开关**。M1 动效（Bottom Sheet、Dock 弹出、视图
转场等）必须走既有 motion tokens（fast 120ms / base 200ms、transform+opacity
only）+ reduced 归零语义；循环动画照旧走 §2.5 豁免评审。

### 35.6 i18n 双语要求

移动文案与桌面同一条铁律（§3.2、DECISIONS.md A1）：**zh-CN / en 双词典同步、
类型强制键位对齐、禁止硬编码**。首批键 `mobile.shell.heading` /
`mobile.shell.brand` 已随 M0-2 入典（`src/core/i18n/dictionaries.ts`）；
M1 全部新文案照此办理。

### 35.7 Home 结构规格（M1 六片落地，2026-10-08）

自上而下（`src/mobile/home/MobileHome.tsx` 挂 `mobile-content-scroll`，
几何与字号以代码为唯一口径）：

- **状态栏**（`mobile-statusbar-slot` 占位带）：带高 `max(env(safe-area-inset-top),
  24px)`（`src/index.css:1141`）；`MobileStatusBar` 只在其内铺一行 **11px
  等宽**读数（`text-[11px] tabular-nums`，`src/mobile/statusbar/MobileStatusBar.tsx:72`）
  ——左系统时钟，右电池（Battery Status API）→ 网络（onLine +
  connection.effectiveType）→ 用户名。数据源全部真实（§0.5）：某项能力
  探测不到**整项隐藏**，绝不显示示例读数；纯指示器无可点目标，§35.3
  不适用。
- **品牌头**：`px-5 pt-8`，BrandLogo 44 + 品牌名 `text-xl font-semibold
  tracking-tight` + 标语 `text-xs` muted（`src/mobile/home/MobileHome.tsx:38-59`）
  ——一行轻头部，不是 Landing 页式大居中 Hero（M0 中央占位字随本片退役）。
- **时段问候**：`pt-7`，正文 15px（`text-[15px]`）；早/午/晚三档纯函数
  （`src/mobile/home/greeting.ts:19-23`，5/11/17 边界左闭右开、夜并入
  晚档），用户名取 session-store 真实会话（displayName 缺省回退
  username），连接符与用户名 muted 色。
- **今日世界卡**：`mx-5 mt-7 rounded-2xl p-4`，`--ag-surface-raised` 实色
  底 + `border-subtle` 细边——白名单「Today 卡」位（§35.1），M1 沿用
  实色**不引入 blur**；标题行 Sparkle 16 + `text-sm` semibold，统计行
  `text-xs`（新应用数 × 趋势信号数，真实字段不编造计数），「查看世界」
  整宽按钮 `min-h-[44px]`（§35.3）primary 色（`src/mobile/home/TodayWorldCard.tsx:42-81`）；
  **羽化开且世界落地才渲染**（:39），卡缺席即状态。
- **最近使用**：`mt-7 px-5` 轻区块（**玻璃清单外零 blur，不做卡片容器**），
  标题 `text-sm` semibold；usage-store 最新 **4 条**（`src/mobile/home/recent-apps.ts:9`，
  先截取后解析、坏条目跳过不回填）一行四格，AppIcon **44px** = 命中区
  主体 + `text-xs` truncate 标签，整格命中 ≥44×44（`src/mobile/home/RecentApps.tsx:56-62`）；
  recent 为空或前 4 全解析失败时**整块连标题缺席**（:37）。
- **应用网格**：`mt-7 px-5 pb-2`，**4 列** grid；徽章 **56px**（切片带
  52–64px）+ 标签 `text-xs`，整格命中 ≥44×44（`src/mobile/home/MobileAppGrid.tsx:97-106`）；
  排序 = 常量优先序在前、其余按本地化展示名排后（`src/mobile/shared/mobile-app-order.ts:16-24`）；
  注册表空时整块缺席。当前全量直渲不分页（M2-1 已落独立启动器抽屉、
  网格保持全量直渲不变，抽屉规格见 §35.8）。
- **Dock**：坐 `mobile-dock-slot` 预留带（`max(env(safe-area-inset-bottom),
  12px)`，`src/index.css:1147`）**上方**、本体零 env 消费；玻璃口径 =
  §35.1 白名单 Dock 位的唯一玻璃层 `surface-glass` 基底 + `glass-raise`
  （blur 20px 档，`src/index.css:571`）+ `border-t` 发丝边，清单外零 blur。
  固定 **5 位** = Home 复位（44×44 中性瓷贴 `rounded-[24%]` + 白细环、
  House 24——Shell 动作，不进应用徽章体系；M3-2 起长按/上滑兼作最近
  任务入口，见 §35.9）+ Files / Notes / 今日世界 /
  Settings（AppIcon 44，`src/mobile/shared/mobile-dock-slots.ts:15-20`）；
  列内 `px-2 py-1.5 justify-around`，每格命中 ≥44×44（`src/mobile/dock/MobileDock.tsx:92-143`）；
  当前位 2×16px primary 指示条 + `aria-current`（桌面 Dock 同一 Active
  指示语言）；位上应用不在册该位不渲染（禁止死按钮优先于固定 5 位）。
- **空态隐藏原则（全 Home 通用铁律）**：无数据不建可点死元素——今日
  世界卡（羽化关/世界未落地）、最近使用（recent 空或前 4 全解析失败）、
  应用网格（注册表空）、Dock 位（不在册）四处门控全部在组件内部，
  **缺席即状态**，Home 其余区块照常；禁止空壳容器与占位骨架。
- 触控目标收口：以上全部可点元素命中区 ≥44×44px（§35.3）；全屏应用视图
  （AppHost）的返回键同为 44×44（`src/mobile/app/MobileAppHost.tsx:270`）。

### 35.8 Bottom Sheet 形态语言、控制中心与边缘返回规格（M2 六片落地，2026-10-08/10）

三张 Bottom Sheet——启动器抽屉（`src/mobile/launcher/MobileLauncher.tsx`）、
通知中心（`src/mobile/notifications/MobileNotificationSheet.tsx`）、控制
中心（`src/mobile/controlcenter/MobileControlCenterSheet.tsx`）——共用同
一套形态语言（同构实现，动画段集中在 `src/index.css` 移动段）：

- **玻璃口径（§35.1）**：白名单「Bottom Sheet」位的唯一玻璃层 =
  `surface-glass` 基底 + `glass-raise`（与 Dock 同档 blur 20px，
  `src/index.css:577`）+ `rounded-t-2xl` 顶部发丝边；sheet 锚底升出、
  `max-h-[80%]` 给 Home 留呼吸（`MobileLauncher.tsx:123-130`，三张同构）；
  顶部抓手条 `h-1 w-9` 纯装饰（aria-hidden）。backdrop 是**纯色压暗遮罩
  （非玻璃、零 blur）**（`rgb(15 23 42 / 45%)`，`src/index.css:1267`）。
- **开关状态机与退场**：`closed/open/leaving` 三相位——`open→false` 不经
  null 空档、退场帧与原树同一 commit 接续（input 不重挂、关闭回焦触发器
  不被抢），leaving 播完 200ms 再卸载，期间 `pointer-events-none +
  aria-hidden` 不挡底下 Home。关闭路径 = backdrop 点击 + Esc（document
  捕获阶段），关闭回焦入口按钮（桌面弹层关闭契约 §0.4 的移动口径）。
- **动效（§35.5）**：进出场 200ms 只动 transform/opacity（既有 token
  `--ag-motion-base`）；prefers-reduced-motion 由全局 0.01ms 塌缩承接；
  motion-prefs「窗口切换转场」关档 → 根上 `mobile-*-static` 直切（用户在
  控制中心开「减弱动效」时 sheet 当场转直切，所见即所得）。
- **触控 ≥44px（§35.3）**：抽屉搜索框 `h-11`、列表行 `min-h-[44px]`
  （`MobileLauncher.tsx:146/168`）；通知单条清除钮 44×44（
  `MobileNotificationSheet.tsx:86`）、清空钮 `min-h-[44px]`（:181）；
  控制中心选项 chip `min-h-[44px]`、「减弱动效」整行 switch、登出整宽
  44px（`MobileControlCenterSheet.tsx:106/255/282`）——桌面 Settings 的
  h-8 chip 密度档（§28）不带入移动。**状态栏入口特例**：铃铛/调节按钮的
  44×44 盒在最小 24px 高的占位带内居中必然上溢视口被裁，命中区用 `::after`
  自盒中心向下延伸 44px（`MobileStatusBar.tsx:120/145`）——任何占位带
  高度下有效命中 ≥44px。
- **通知中心特有**：打开即 `markAllRead`（徽标语义 =「尚未在中心过目」，
  `MobileNotificationSheet.tsx:116-118`）；清空按钮只在有通知时在场
  （禁止空态死按钮，§35.7 同口径）；未读行 primary 细边 + 圆点，已读行
  中性边——数据源与桌面同一 notification-store（架构 §3.25，桌面
  NotificationCenter 零改动）。
- **控制中心 = 真实能力开关清单（零伪造开关）**：主题/字号/语言三组
  chip（与桌面 SettingsApp 同一 store 入口与同一组词典键）+「减弱动效」
  整行 switch（role/aria-checked 对齐桌面 ToggleSwitch 契约）= motion-prefs
  `windowTilt` **反相呈现**（同一 store 布尔两处呈现，桌面叫「窗口切换
  转场」）+ 登出整宽钮（`session-store.logout`，桌面 UserMenu 同行为：
  无二次确认）。glow/dockSheen/themeGlow/aurora 是桌面指针与画布效果、
  移动 Shell 无消费位，**不摆出来**。
- **边缘返回手势（M2-4）**：判定参数（`src/mobile/gesture/edge-back-decision.ts:34-40`
  默认档）——左缘激活带 **24px** 起点 + 轴向死区 10px（保住缘带内纵向
  原生滚动与点击）；释放时**过半**（向内位移 > 视口宽 × 0.5）**或甩动**
  （≥0.5px/ms ≈ 500px/s，150ms pointermove 滑动窗口求速）即确认；确认 =
  backToHome（与返回键/popstate 同一出口）。跟手 1:1 位移钳一个屏宽
  （rAF 直写 transform，拖动全程零 React render），确认滑出 120ms
  （`--ag-motion-fast` 档 ease-in）、取消回弹 200ms（base 档）；转场关档
  或 prefers-reduced-motion（落下时实时探测）→ 直切。`[data-no-edge-back]`
  标记面 = 横向滚动逃生口（hook 整体豁免 + CSS 对该面及后代重放 pan-x，
  `src/index.css:1187-1190`）。挂载点与系统映射见 ARCHITECTURE.md §3.25。

### 35.9 最近任务覆盖层、PWA 安装条与 Files 长按操作单规格（M3 六片落地，2026-10-10/11）

M3 的三张新面共用 §35.8 的形态语言（`closed/open/leaving` 三相位、退场
不经 null 空档、backdrop 纯色压暗零 blur、200ms 只动 transform/opacity、
motion-prefs「窗口切换转场」关档 `*-static` 直切、关闭回焦触发器）；
架构映射（多 App View 模型 / 手势家族 / PWA 双分支）见 ARCHITECTURE.md
§3.25 M3 段，此处只钉视觉与交互规格。

- **最近任务覆盖层（M3-2，`src/mobile/recents/MobileRecentsSheet.tsx`）**：
  第四张 Bottom Sheet，挂 Shell 根 `fixed inset-0 z-20`（Home 与应用视图
  之上，与状态栏两张 sheet 同层语义）。玻璃口径（§35.1）= Bottom Sheet
  白名席位——`surface-glass + glass-raise`（Dock 同档 blur 20px）+
  `rounded-t-2xl` 顶部发丝边，锚底升出 `max-h-[80%]`、抓手条 `h-1 w-9`
  纯装饰；backdrop 纯色压暗（`src/index.css:1460`）。卡片 = `h-28 w-44
  rounded-2xl` 实色 `--ag-surface-raised` + `border-subtle`（**白名单外
  零 blur**），AppIcon 40 + 名称 `text-sm` + 打开时间 `text-[11px]
  tabular-nums`（`<time dateTime>` 语义标记），呈现序 = 打开序反转
  （新→旧）；横向轨道 `overflow-x-auto + overscroll-contain`，
  轨道与卡片 `touch-action: pan-x`（`src/index.css:1517-1521`）——纵向
  拖拽无原生滚动面可认领、归卡片上滑关闭手势，横向归轨道原生横滚
  （两轴正交，冲突在 touch-action 划界上消解）。**触控 ≥44px（§35.3）**：
  卡片整格可点、右上删除钮 44×44、标题行「全部关闭」`min-h-[44px]`
  （只在有卡片时在场——空态死按钮禁令）。**手势阈值**（卡片上滑关闭，
  `recents-card-decision.ts:21-25` 默认档）：上滑位移 > **64px**（约一个
  卡片高）**或**甩动 ≥ **0.5px/ms**（150ms pointermove 滑动窗口，与
  边缘返回同档）即确认；跟手上移钳 **120px**，确认滑出 120ms
  （ease-in 档 `cubic-bezier(0.55, 0, 1, 0.45)`）、取消回弹 200ms
  （`use-recents-card-dismiss.ts:51-54`）；轴向裁决复用 swipe-up 的
  classifyVerticalDrag（家族同一套轴向语义）。**空态整层不可达**：
  入口档在 Dock Home 位（无已开应用时长按/上滑不分发），兜底档在
  sheet（开着时记录清空立即退场，不留空壳层）。关闭回焦 Dock Home 位
  触发器（`MobileShell.tsx:87-90`，经 testid 定位）。
- **Dock Home 位三动作手势（M3-2 入口）**：短按 = 原生 click 回 Home
  （hook 不拦截不复制）；长按 **500ms** 驻留（位移死区 **10px**，出死区
  取消）或上滑 **24px** 且上滑分量大于横向 → 打开最近任务
  （`dock-home-gesture.ts:35-39` 默认档）。无跟手动画（按钮不位移、
  零逐帧 DOM 工作）；确认后一次性吞 click（50ms 没等到自拆）；Home 位
  带 `data-no-edge-back` + `select-none`——起于 Home 位的手势归本位
  （M3-1 zone 级上滑在该起点让位），长按文本选择 callout 压掉。
- **PWA 安装条（M3-3，`src/mobile/pwa/MobileInstallBar.tsx`）**：Home
  尾部非侵入位（`mx-5 mt-7 mb-2`，随内容滚动、不遮任何入口，应用视图
  不挂载）——**不在玻璃白名单**：Today 卡同款实色卡面（`--ag-surface-raised`
  + `border-subtle` + `rounded-2xl p-4`，§35.1 清单外零 blur，不引入）。
  双分支呈现：**chromium 分支**（捕获到 beforeinstallprompt）= 标题
  `text-sm` semibold + 描述 `text-xs` + 「安装」整宽钮 `min-h-[44px]`
  primary 色（pending 禁用防重复消费；浏览器对话框取消 → 安装钮退场换
  `text-xs` 结果反馈行——prompt 已消费，再点必败是死按钮）；**iOS 指引
  分支** = 两步有序文案（分享 → 添加到主屏幕，`<ol>` 列表），无可点
  安装钮——不摆假按钮。关闭钮 44×44 叠卡片右上角（RecentsCard 删除钮
  同款布局），dismiss 记 localStorage 版本键永不再打扰；hidden 分支
  整条缺席（缺席即状态）。
- **Files 长按操作单（M3-6，`src/apps/files/FileActionSheet.tsx`）**：
  第五张同构 Bottom Sheet，`fixed inset-0 z-[70]`（盖过应用宿主 z-10
  与最近任务 z-20）；玻璃口径 = Bottom Sheet 白名席位同款
  `surface-glass + glass-raise` + 发丝边 + 抓手条，backdrop 纯色压暗
  （`src/index.css:1538`）。面板 = 目标名行（`text-xs` muted，长按后
  浮层盖住原行、让用户明确在操作谁）+ 动作清单（每行 `min-h-[44px]`
  §35.3，Phosphor 图标 18 + `text-sm`；**删除/彻底删除 danger 色**——
  工具栏同语言）+ 分隔线 + 取消行 `min-h-[44px]`（backdrop/Esc 之外的
  第三条关闭路）。动作子集随视图切换（浏览：打开/重命名/删除；回收站：
  还原/彻底删除；根级受保护条目不摆删除——`file-actions.ts:32-37`
  纯函数钉住），执行全走 Files 既有逻辑零新业务；关闭回焦长按行
  （动作关闭不走回焦——重命名 PromptDialog 要 autoFocus）。**手势阈值**
  （`long-press-decision.ts:22-25` 默认档）：驻留 **500ms** 确认 /
  位移容忍 **10px**（超限 = 滚动意图取消，pointercancel 静默复位）；
  与「首击选中、再击打开」共存——阈值内抬起 = 正常点击（click 抑制器
  从未挂上）。仅窄容器分支启用（委托宿主 = 应用根，行上窄容器才渲染
  `data-entry-id`），桌面宽容器此组件永不渲染。
- **共享弹层触控作用域（M3-4）**：`src/components` 共享弹层
  （PermissionConsentDialog 等 Store 安装确认流）不在 `src/apps/**`
  窄容器适配范围，由 `.mobile-shell [role='dialog'] button/label`
  壳作用域把可点目标命中区抬到 ≥44px（`src/index.css:1254-1256`）——
  §35.3「移动作用域内一切可点击目标」的收口条款，桌面无 `.mobile-shell`
  祖先零接触。
- **手势阈值速查（移动 Shell 全家族，判定纯函数各自单测钉扎）**：
  边缘返回（M2-4）左缘 24px / 死区 10px / 过半 0.5 或甩动 0.5px/ms；
  底缘上滑（M3-1）带 72px / 距离 0.15 视口高或甩动 0.5px/ms / 跟手钳
  80px；Dock Home 位（M3-2）长按 500ms / 死区 10px / 上滑 24px；最近
  任务卡片（M3-2）上滑 64px 或甩动 0.5px/ms / 跟手钳 120px；长按操作单
  （M3-6）驻留 500ms / 容忍 10px。共同纪律见 ARCHITECTURE.md §3.25
  M3 手势家族段。

### 35.10 全域搜索分组、通知跳转、云同步状态与 Terminal 快捷键行规格（M4 五片落地，2026-10-11/13）

M4 四个功能面全部嵌在既有形态语言里：启动器抽屉 / 通知中心仍是 §35.8
的白名席位 Bottom Sheet（玻璃口径零新增 blur），Settings「同步」分区与
Terminal 快捷键行在 §35.1 清单外**零 blur**；架构映射（Files 定位通道 /
同步状态服务面 / 性能预算钉扎）见 ARCHITECTURE.md §3.25 M4 段，此处只
钉视觉与交互规格。

- **全域搜索分组结果（M4-1，`src/mobile/launcher/MobileLauncher.tsx`）**：
  抽屉搜索框升为「应用 + 文件」双域——应用域即时过滤（M2-1 的
  launcher-filter 现状不变），文件域 = `systemVfs.search('/')` 名称子串，
  输入防抖 **200ms** 才发起（`LAUNCHER_FILE_SEARCH_DEBOUNCE_MS`，
  `launcher-file-search.ts:12`）；**空查询 = 仅应用单列表，零 VFS 调用**。
  搜索态按组渲染（`groupLauncherResults`，`launcher-file-search.ts:53-61`）：
  **应用组在前、文件组在后**，组标题 `text-xs` muted + `section`
  aria-label（`MobileLauncher.tsx:277-298`）；每组截断到 **8 条**
  （`LAUNCHER_GROUP_LIMIT`，`launcher-file-search.ts:15`），超限组尾随
  **静态截断提示**「共 {count} 条，仅显示前 {limit} 条」（状态文案带全量
  计数与上限两个真实参数，**不是可点元素、不设「展开更多」**——§0.5
  无假按钮，`MobileLauncher.tsx:373-387`）。文件行 = 类型图标 28 装饰位
  （目录 FolderOpen / 文件 FileText，aria-hidden）+ 名称 `text-sm` +
  **完整路径** `font-mono text-[11px]`（`MobileLauncher.tsx:327-339`）；
  点击文件行 = 写所在目录定位意图 + `openApp('files')`（架构 §3.25 M4
  定位通道）。**触控 ≥44px（§35.3）**：应用行 `min-h-[44px]` + AppIcon
  44（`:197/201`）、文件行 `min-h-[44px]`（`:308`）。搜索无命中 =
  状态文案整行（缺席的是结果、抽屉本身在场，§35.7 空态铁律的搜索口径）。
  玻璃口径（§35.1）不变：Bottom Sheet 白名席位 `surface-glass +
  glass-raise` 一层，backdrop 纯色压暗零 blur。
- **通知跳转 affordance（M4-2，`src/mobile/notifications/
  MobileNotificationSheet.tsx`）**：可跳转判定在纯函数
  `notificationNavTarget`（`notification-nav.ts:16-24`）——通知项带
  `targetAppId`（桥从 app.crashed / eclosion.app.failed 载荷存入，
  `notification-bridge.ts:35/61`）**且**目标应用在册可启动才算数；载荷无
  appId 或目标已注销（L2 今日应用跨日 unregister）→ 行保持纯展示整条
  不可点（没有的能力不做按钮，点按不产生死跳）。可跳转行的 affordance
  三件：**行主体整块变按钮**（内容自然高 + `min-h-[44px]` 兜底 §35.3，
  `MobileNotificationSheet.tsx:105-118`）、行尾 **CaretRight 14**
  chevron（`:122-129`，tertiary 色 aria-hidden 纯指示）、sr-only「打开」
  可访问名（词典键 `notification.open`，不做字符串拼接）。点按序 =
  `markRead`（点按即已过目，与打开即 markAllRead 同一徽标语义）→
  `openApp`（最近任务模型：活记录切回既有窗口 / 无记录新开）→ 关 sheet
  （与 backdrop/Esc 同一出口）。`data-navigable` 标记供 E2E
  （`e2e/mobile-notification-nav.spec.ts`）。玻璃与触控口径全部沿用
  §35.8 通知中心段，M4-2 零新增。
- **云同步状态面（M4-3，`src/apps/settings/SyncSection.tsx`）**：
  Settings 新「同步」分区，**桌面与移动窄容器共用同一组件**（M2-6 契约
  自动生效——分区内容零交互控件，无命中区诉求）。真实性铁律（§0.5）：
  同步没有手动触发能力，**不摆「立即同步」按钮**——分区只呈现状态库里的
  真实和解结果：进行中 / 失败（上次失败时刻 + 「上次成功」副行）/
  上次成功 / 尚未同步（`SyncSection.tsx:82-113`）；未登录 / 本地认证
  模式 / 开关关闭等降级行**如实派生展示**（开关关闭行指向「账户」分区的
  既有开关，`:65-80`）；离线读数 = navigator.onLine + online/offline
  事件，读不到按在线算（探测失败不谎报离线，`:13-15`）。视觉 = 纯文本
  分区（`text-xs`/`text-sm` muted 层级 + 状态盒 `rounded-md border`），
  **§35.1 清单外零 blur、无卡面玻璃**。
- **Terminal 快捷键行（M4-4，`src/apps/terminal/terminal-keys.ts` +
  `TerminalApp.tsx:266-290`）**：软键盘缺失的行编辑键——**Esc / Tab /
  Ctrl+C / ↑ / ↓ 五键**（`TERMINAL_KEY_ROW`，`terminal-keys.ts:33-39`），
  仅窄容器渲染（<560 断点，宽容器 DOM 与改前字面等价）；行在输出井下方、
  根的**最后一个流内子元素**——软键盘弹起时根由 M3-5④软键盘避让让高，
  行贴键盘上沿、在输入行之下不遮挡。键帽是通用键名字面（Esc/Tab/Ctrl+C/
  ↑/↓，与 locale 无关），**动作说明走 i18n aria 标签**（词典
  `terminal.keys.*`，zh/en 双典）。**触控 ≥44px（§35.3）**：键
  `min-h-[44px]` + 行内 `flex-1` 五等分（`TerminalApp.tsx:281`）；行带
  `data-no-edge-back`——行首按键起手的拖拽不让边缘返回手势吞掉。busy 期
  整行随输入行一并 disabled（伪 Shell 无进程模型，**不做假中断**；Ctrl+C
  只在提示符处回显 `^C` 清行）。发送通道与物理键盘同一条会话语义：键先按
  wire 契约编码成控制序列（ESC 0x1B / HT 0x09 / ETX 0x03 / CSI A/B），
  会话侧解码复用召回/补全/清行。**玻璃口径（§35.1）**：行在清单外——
  实色轻透明白纱 `bg-surface-raised/60` + `rounded-md`，**零 blur**，
  不进白名单。

## 36. 空间窗口层（Spatial Window System，2026-10-10 五项用户裁决落地）

> 桌面空间的第三层进化：在「Calm Future」玻璃语言（§0）与 Workspace
> Environment 结构（§34）之上，把窗口域升级为**空间化材质与深度语言**。
> 五项用户裁决 2026-10-10 批准，随两个切片落地：窗口空间化（b319611——
> spatial-window 玻璃体系、聚焦/失焦深度档与失焦悬停浮起）→ 环境抛光
> （2f8d068——Dock 弱倒影与右栏 quiet 双卡慢浮动）。实现唯一落点 =
> `src/styles/spatial.css`（`src/index.css:2` 顶部引入、紧随
> `@import 'tailwindcss'`，引入位由 `src/index.css.test.ts:483` 钉扎）；
> 文件内部**自持源序：令牌 → 基规则 → 增量 → 降级兜底**（§0.3 同律），
> `@eslint/css` 接管 src/styles 定向 lint。本节与 §21 / §34.7（窗口
> 20px rounded-xl / 深玻璃 blur 36px 档）冲突时**以本节为准**；窗口状态
> 语义、几何钳制与 core（window-manager）**零改动**。空间视觉效果**仅
> 桌面作用域**（裁决 5），移动端零扩散。

### 36.1 五项裁决（2026-10-10 用户批准，照此执行勿再发挥）

1. **悬停浮起只给失焦窗口**；Dock 域不加悬停浮起（高斯波浪仍是唯一浮起，
   §13 的 2026-10-05 终态裁决不动）。
2. **窗口圆角 20px（rounded-xl）升到 28px**（`--sp-window-radius` 档；
   2026-10-11 用户反馈「效果太克制」再升 32px，见 §36.8）。
3. **常驻环境浮动动画默认开启、可在设置关**（motion-prefs 新布尔
   `spatialMotion`，`src/store/motion-prefs-store.ts:26`，默认 true）。
4. **空间玻璃走独立低透明档位（`--sp-*` 命名空间）**，不消费
   `--ag-glass-bg`、不回调既有 chrome 白玻璃 8% 裁决（§34.1 veil 终裁
   不受影响）；**对比度从不依赖 blur**——两处实色兜底随附（§0 材质铁律
   的空间域重申）。
5. **空间视觉效果仅桌面作用域**；移动端 §35.1 玻璃白名单五处不扩（唯一
   例外：移动控制中心接空间动效开关，属**状态接线非玻璃**，见 §36.5）。

### 36.2 `--sp-*` 令牌表（`src/styles/spatial.css:19-66`）

主题成对纪律：随主题翻转的令牌（玻璃三档/窗口阴影）在 `.dark` 成对重声明；
主题无关几何常量（圆角/深度/透视/浮动参数）只入 `:root`（同红绿灯与
`--ag-tooltip-bg` 先例）。钉扎：`src/index.css.test.ts:492-516`。

| 令牌 | 浅色 / 深色 `.dark` | 消费位 |
|---|---|---|
| `--sp-window-radius` | 32px（仅 :root；§36.8 自 28px 加大） | `.spatial-window` 圆角档（裁决 2） |
| `--sp-widget-radius` | 20px（仅 :root） | 空间小组件面圆角（预留档） |
| `--sp-glass-light` | 白 10% / 冷墨 `rgb(16 23 40)` 20% | 预留低档（无消费位） |
| `--sp-glass-medium` | 白 16% / 冷墨 28% | `.spatial-window` 面底（唯一在用玻璃档） |
| `--sp-glass-heavy` | 白 24% / 冷墨 40% | 预留高档（无消费位） |
| `--sp-lift-near/middle/far` | 80 / 40 / 0px（仅 :root） | 深度三档 translateZ（§36.4） |
| `--sp-perspective` | 1100px（仅 :root；§36.8 自 1400px 加大） | 消费方侧舞台建 3D 上下文（窗口 = `WindowLayer.tsx:44`） |
| `--sp-float-duration/distance` | 7s / 9px（仅 :root；§36.8 自 9s/5px 加大） | `sp-float` 关键帧（§36.5/§36.6） |
| `--sp-hover-duration/ease` | 480ms / `cubic-bezier(0.34, 1.3, 0.64, 1)`（仅 :root；§36.9 五轮调参终档，ease = `--ml-ease-spring-bounce` 回弹档） | 悬停浮起过渡丝滑档（§36.9） |
| `--sp-dock-reflection-height` | 40px（仅 :root；§36.8 自 24px 加大） | `.dock-reflection`（§36.6） |
| `--sp-shadow-window` | `0 24px 72px` 冷墨 14% + `0 6px 20px` 8% + rim / 纯黑 44% + 24%（§36.8 拉陡） | `.spatial-window` 基档（比 `--ag-shadow-window` 0 16px 48px 更大更弥散的漂浮档） |
| `--sp-shadow-window-hover` | 44px/120px 冷墨 26% 递进 / 纯黑 60% 递进 | 失焦悬停浮起加深档（仍低于聚焦档） |
| `--sp-shadow-window-active` | 52px/136px 冷墨 30% 递进 / 纯黑 66% 递进 | 聚焦窗口（flat < hover < active，同 `--ag-shadow-window` 族语义） |

### 36.3 `.spatial-window` 材质与两处降级兜底（`spatial.css:68-92`）

基规则配方：`background: var(--sp-glass-medium)` + `backdrop-filter:
blur(40px) saturate(150%)` + `border: 1px solid rgb(255 255 255 / 24%)`
（深色增量降为白 10%，与 `--ag-glass-border` 深色档同口径）+
`border-radius: var(--sp-window-radius)` + `box-shadow:
var(--sp-shadow-window)`；`::before` 斜向高光装饰层（120deg 白 22% 渐隐至
48%，§36.8；`pointer-events: none` 不截胡交互）。**通用玻璃面壳**
`src/components/spatial/GlassSurface.tsx`：纯展示壳、零 store，props 驱动
depth/float/motionStatic，供后续空间面消费；窗口不走它（走 sp-win 作用域，
§36.4）。

降级兜底（源序即降级，`spatial.css:225-242`）：①
`@media (prefers-reduced-transparency: reduce)` → `background:
var(--ag-surface-popover)` + `backdrop-filter: none`；② `@supports not
(backdrop-filter: blur(1px))` → 同实色。窗口状态档（`.sp-win-focused` 等）
特异性更高，兜底选择器组**同等特异性并列、靠源序取胜**——新增状态档必须
同步并入兜底选择器组。backdrop-filter 只写标准属性、严禁 `-webkit-` 前缀
（构建链剥标准属性根因 A，§35.8 同律）。

### 36.4 深度契约：聚焦 near / 失焦 middle / 最大化与 ghost 无深度

通用深度梯（`spatial.css:96-104`）：`sp-depth-near` = translateZ(80px) +
scale(1.02)、`sp-depth-middle` = translateZ(40px)、`sp-depth-far` = 0；
透视由**消费方侧舞台**以 `--sp-perspective` 提供（translateZ 的视觉位移
依赖祖先透视）。组件契约（`WindowFrame.tsx:114-119`）：聚焦挂 near、
失焦可见挂 middle；**最大化 / 最小化 / ghost 不挂深度类**（ghost 是关闭
退场快照，永不参与空间态）。

**窗口工作面测量契约（红线 10 的消解，`spatial.css:156-207`）**：窗口
section 是 responsive-quad boundingBox 与 window-resize ±2px 的 E2E
测量面——translateZ 在本层 perspective（现 1100px，§36.8）下是**投影型变换**
（z=80 在 1400px 档实测投影 ≈ +6.1% 放大且随离心位移，Chromium
getBoundingClientRect 计入透视），直接挂会实时改变静止渲染盒。故窗口作用域
把深度梯与失焦退后
（`is-tilt-dim`，§32.5 修订 10 windowTilt 域）一律解析为
`transform: none`（特异性压过通用深度梯）——**类照挂（组件契约不变）、
变换归零（测量面契约）**，深度语义改由状态类栈表达：面实度
`--ag-glass-bg`（失焦基档）→ `--ag-window-face-active`（聚焦，只提实度
不加色相）+ 中性细边 `--ag-border` → `border-strong` + 空间阴影基档 →
active 档。`sp-win` 基档同时以 `position: absolute` 抵消基规则 relative
（窗口几何仍由 inline left/top 定位，行为零变化）；`sp-win-max` =
`border-radius: 0`（§32.5 修订 12 真全屏不变，unlayered 同字段覆写）。
钉扎：`src/index.css.test.ts:563` 起整段。

### 36.5 悬停浮起与空间动效开关（motion-prefs `spatialMotion`）

**悬停浮起（裁决 1，`spatial.css:209-223`）**：仅「失焦 + 非最大化 +
非最小化 + 非拖拽中 + 空间动效开档」时组件挂 `sp-win-hover`
（`WindowFrame.tsx:122-125`；ghost 永不浮起），hover 态
`translateY(-12px) scale(1.03)`（§36.8 自 -6px/1.01 加大）+
`--sp-shadow-window-hover` 加深。栈内
唯一 transform 写入者即此 `:hover` 规则（静止态几何探针永不命中）；
transition 挂在类上——拖拽开始即摘类，拖拽进行中天然无过渡（跟手零
延迟）。Dock 域零悬停浮起（裁决 1 后半），高斯波浪（§13）仍是 Dock
唯一浮起。`prefers-reduced-motion` 由 index.css 全局 0.01ms 塌缩接管。

**开关（裁决 3）**：`spatialMotion` 默认开，桌面入口 = 设置 → 外观 →
动效实验室「空间动效」（`settings.motionSpatial` / 说明行
`settings.motionSpatialHint`「窗口深度与悬浮氛围动效」，testid
`motion-spatial-toggle`，`SettingsApp.tsx:288-292`）；移动控制中心同一
布尔**反相呈现**为「减弱空间动效」（`mobile.controlcenter.reduceSpatialMotion`，
`MobileControlCenterSheet.tsx:147/290`）——同一 store 布尔两处呈现、
所见即所得，属裁决 5 的唯一移动例外（状态接线非玻璃）。关档语义 =
组件挂 `sp-motion-static`（`animation: none`）**直切**：与浮动类共存、
同特异性下源序必胜（静态类必须位于浮动类之后，与 mobile 静态类同口径，
`index.css.test.ts:554-560` 钉扎）；WindowFrame 同时摘深度类与悬停类
（`WindowFrame.tsx:114-125`），`WindowFrame.test.tsx:195-259` 钉住整条
类栈门控。

### 36.6 环境抛光：Dock 弱倒影与右栏慢浮动（2026-10-11 切片 2f8d068）

- **Dock 弱倒影**（`spatial.css:125-154`，Taskbar 消费
  `Taskbar.tsx:188-190`）：胶囊正下方 40px 高（`--sp-dock-reflection-
  height`，§36.8 自 24px 加大）的渐变 mask 伪倒影——`top: 100%` 贴胶囊
  下缘、与胶囊同宽、`border-radius: inherit` 随动，峰值白 18%（深色成对
  降档 14%）+ `mask-image` 纵向渐隐至 88%（§36.8 自 12%/9%/82% 加大）。
  **非玻璃件**：零 backdrop-filter，
  两处实色兜底不适用；纯装饰（aria-hidden + `pointer-events: none`），
  absolute 定位不占布局、静止盒零变化。**门控双保险**：空间动效关档 →
  Taskbar 条件渲染整层不挂载（关则整层消失）；`prefers-reduced-motion` →
  spatial.css 内 `display: none` 兜底（覆盖系统偏好路径）。波浪唯一浮起
  裁决（§13）与既有 Dock 几何 token 零改动。
- **右栏 quiet 双卡慢浮动**（`WidgetRail.tsx:93-113`）：仅 quiet 档两卡
  （最近通知/今日世界，§34.4 权重分级）挂常驻环境浮动——**装饰包装层**
  `AmbientFloatLayer` 承载 `.sp-ambient-float`（7s 周期上下 9px，§36.8
  自 9s/5px 加大，只动 transform），卡片 section（E2E 测量面）不挂任何动画类，静止布局盒零
  变化（红线 10）；`0s / -4.5s` 负 animation-delay 错峰反相，两卡不同步
  晃动。包装层不画材质不吃指针，`shrink-0` 接手卡片原防压缩职责；关档
  追加 `sp-motion-static` 直切。**时钟/系统卡稳定不浮**（full 档卡是
  信息锚点）。

### 36.7 E2E 兼容前提与测试钉扎

- **静止布局盒不变（红线 10）三通道**：浮动只挂装饰包装层；悬停变换只在
  `:hover` 态发生；窗口深度在窗口作用域解析为 `transform: none`
  （§36.4）——E2E 几何探针（responsive-quad 四档 boundingBox、
  window-resize ±2px、window-visual/multi-window-visual 实测断言）按
  静止态测量，全部前提成立。
- **core 零改动**：窗口状态语义、焦点/z 序/几何钳制（window-manager）
  与本层无关，空间化全部落在样式与组件类栈；既有 E2E spec 无需知情。
- **单测钉扎**（jsdom 无 ResizeObserver/backdrop-filter，几何归 E2E）：
  `src/index.css.test.ts:483` 起（引入位/令牌双主题/独立 sp 档基规则/
  深度梯与浮动-静态源序/窗口作用域消解/兜底）；`WindowFrame.test.tsx:195`
  起（类栈与 spatialMotion 门控）；`GlassSurface.test.tsx`、
  `motion-prefs-store.test.ts`、`SettingsApp.test.tsx`（开关接线）、
  `dock-reflection.test.ts` + `Taskbar.test.tsx`、`WidgetRail.test.tsx`
  （环境抛光）、`MobileControlCenterSheet.test.tsx`（反相开关）。

### 36.8 振幅加大（2026-10-11 用户反馈「这些效果都太克制了，请再明显一些」）

全部效果只在原架构内放大振幅，**不改任何结构契约**——深度梯窗口作用域
消解（§36.4）、悬停唯一 transform 写入者、浮动只挂装饰包装层、倒影非
玻璃件、双门控、两处实色兜底全部原样。before → after：

| 项 | 原 | 现 |
|---|---|---|
| `--sp-window-radius` | 28px | **32px** |
| `::before` 斜向高光 | 白 12% → 透明 40% | **白 22% → 透明 48%** |
| 玻璃圈口 rim | 无 | **阴影三档尾部 `inset 0 1px 0` 白 25%（深色 12%）顶缘高光** |
| 窗口阴影三档（浅色） | 22% / 25% / 27%（96/104/112px 弥散） | **14% / 26% / 30%**（72/120/136px 弥散——基档让位，档差拉陡） |
| 深色三档 | 55% / 58% / 62% | **44% / 60% / 66%** |
| 悬停浮起 | translateY(-6px) scale(1.01) | **translateY(-12px) scale(1.03)** |
| `--sp-perspective` | 1400px | **1100px**（浮起投影更夸张） |
| 右栏慢浮动 | 9s ±5px | **7s ±9px** |
| Dock 倒影 | 24px 高、白 12%（深 9%）、渐隐 82% | **40px 高、白 18%（深 14%）、渐隐 88%** |

钉扎同步：`index.css.test.ts`（令牌/基档/悬停 transform/阴影三档四组）、
`dock-reflection.test.ts`（高度/峰值成对/mask）、
`e2e/window-visual.spec.ts`（radius 32px、阴影 52px 136px / 24px 72px）、
`e2e/multi-window-visual.spec.ts`（阴影双档）。窗口面实度 72%/84% 与
blur 40px 不动（材质档未变，变的只是空间表达的振幅）。

### 36.9 悬停浮起缓动（2026-10-11 用户反馈二~五调参，终档 480ms + 轻回弹）

浮起过渡自 `--ag-motion-base`（200ms 标准缓动）改为空间域专属档：
**`--sp-hover-duration` 480ms（二 480ms → 三 680ms → 四回调 480ms）+
`--sp-hover-ease` cubic-bezier(0.34, 1.3, 0.64, 1)**（五：对齐 motion-lab
归档 `--ml-ease-spring-bounce`——y2=1.3 轻过冲 ≈8%，升到顶轻回 1px 再稳住
的 iOS spring 手感；离开对称回落同曲线）。transform 与 box-shadow
同步走该档；
**transition 挂在 `sp-win-hover` 类上而非 `:hover`**——鼠标离开时对称回落
同速同曲线，进出皆丝滑。opacity 分量维持 200ms。既有语义不变：聚焦点击即
摘类（浮起立即落定 = 聚焦锁定感）、拖拽开始即摘类（跟手零延迟）、
`prefers-reduced-motion` 全局塌缩、spatialMotion 关档不挂类。钉扎：
`index.css.test.ts` 令牌组 + 悬停类过渡断言。

## 37. Ageha Spaces · Space/Snap/Mission Control 视觉契约（2026-10-11/15）

> Window Management 2.0 九片（W1-W9）的视觉与交互规格。结构契约见
> ARCHITECTURE.md §3.26；窗口材质与深度语言仍归 §36（`--sp-*` 命名空间
> 不动）。全程视觉铁律：**零新 hex、零新 token、零新动效体系**——Space
> 切换与 Mission Control 入场消费既有 `--ag` motion 档（WAAPI +
> `EASE_FLIGHT_LEG2`），Snap 预览与 Dock 指示走既有 token/CSS 档；交互
> 新层级只有一处增补 = **Mission Control z-[60]**（Toast/搜索 z-50 之上、
> 模态 z-[70] 之下，阶梯其他成员零改动）。

### 37.1 Space 切换过渡（W3）

切换 = **容器级进场淡入，无退场动画**：`startSpaceTransition`
（window-motion.ts）对 WindowLayer 容器播 WAAPI——
`translateX(±24px) → 0` + `opacity 0 → 1`，`SPACE_SWITCH_MS` **240ms**
（180-400ms 档）、缓动 `EASE_FLIGHT_LEG2`（cubic-bezier(0.2, 0, 0, 1)）、
`fill: both` 落定后 cancel（终帧压级联，use-window-motion 同律）。方向感
只做进场（forward=+24 / back=−24），离场窗由渲染过滤即时 hidden——
「非常克制」口径；`prefers-reduced-motion` 或 WAAPI 不可用返 null **直切
落定**。容器级不与单窗 open/close/genie 飞行共享元素（ActiveFlight 单槽
不互踩）；非活跃 Space 窗口走 hidden 类（与 minimized 同机制）保持挂载，
iframe 与应用状态存活、退场 ghost 永远可见播完。

### 37.2 Snap 吸附与预览层（W4/W5）

- **缘判定带**：`Math.max(12, Math.round(带宽 × 2%))` 按视口动态（
  `SNAP_EDGE_MIN_PX=12` 保底；320px→12px、2560px→51px 双断言禁 1920
  硬编码）。顶缘优先于左右（角落先触顶）：顶带命中=最大化（「整视口真
  全屏」§32.5 修订 12 语义），左右带命中=半屏方向；带外 null。
- **预览 = 终态几何，像素级一致**：SnapPreviewOverlay 的 rect 直接消费
  `calculateSnapGeometry` 产物（与松手吸附同一单一来源，零二次换算——
  一致性是结构保证而非对齐校验）；E2E 以 `toBe` 探针断言预览盒与落窗盒
  逐项相等。maximize 意图**不显预览**（维持直吸）。
- **Overlay 视觉**：WindowLayer 容器内首子 + `zIndex: 0`（引擎窗 zIndex
  从 1 起恒垫底，最大化抬层 z-[45] 时预览仍在层内最低 z 无需特判）；
  rect=null 零 DOM 零重排；`aria-hidden` + 继承容器 pointer-events-none。
  面样式全走既有 token：`.glass-hint`（blur sm hint，降级环境自然消失）
  + `border-border-subtle`（--ag-border-subtle 明暗双档发丝边）+
  `bg-scrim`（--ag-scrim）+ 圆角 `rounded-[var(--sp-window-radius)]`
  （32px，对齐 §36.8 窗口圆角档）。
- **过渡**：几何属性 `transition-[left,top,width,height]` 挂
  `--ag-motion-fast`（120ms，≤200ms 档）+ `--ag-motion-ease`；
  `prefers-reduced-motion` 全局塌缩直切（CSS media query，不进 WAAPI）。
  WindowFrame 侧：预览与吸附提交共享同一意图判定源；pointerup/cancel/
  blur 全路径清预览防悬挂。

### 37.3 Mission Control（W7）

- **层级与入场**：`fixed inset-0 z-[60]`，层底 `bg-scrim-strong`；入场=
  整体 zoom-out WAAPI（`scale(1.035) → 1` + 淡入，**240ms**，
  `EASE_FLIGHT_LEG2` 贝塞尔，fill:both 终帧随卸载 cancel）——「空间展开」
  气质；reduced-motion / jsdom 直切。退场 120ms 淡出窗口期保持挂载
  （useExitPhase 范式）。开启即 popover 单槽互斥（dismissible:false，被
  顶替即关）；backdrop（非卡片/非胶囊/非按钮区）点击关闭。
- **Space 条胶囊**：每 Space 一枚——name + 「N Apps」派生计数（从窗口
  store 派生，非独立状态）；点击切 Space、「+」新建、双击/回车 inline
  rename（Enter 提交 / Esc 还原，非空 ≤120 引擎校验）；删除钮仅非最后
  Space 显示（**隐藏而非禁用**，与「最后一个拒删」引擎语义一致）。
- **轻量卡 = 拟态窗脸**：卡面 = AppIcon + 标题 + CSS 拟态窗脸——**禁
  渲染应用内容、禁 iframe clone、禁截图**（测试断言无应用挂载点禁
  remount），React.memo；点击卡片=切到该窗所在 Space + restore/focus。
- **跨 Space 拖窗**：4px 阈值 pointer 拖卡到目标胶囊落点 →
  moveWindowToSpace——窗口组件树全程不动、应用零重启；拖拽影挂**层根
  `drag-layer`**（fixed + pointer-events-none + transform-only 跟手），
  原卡拖拽中 pointer-events-none + opacity-40 留位——命中测试不依赖
  卡片区 overflow 裁剪副作用（拖向胶囊途中不被视觉切断）；拖拽期间禁发
  switchSpace（drop 后才动）。
- **确认弹层与 Esc 分层**：非空 Space 删除走迁移确认弹层（默认目标=
  相邻前一 Space；确认后先逐窗迁移、最后一步才 deleteSpace，无半删态）。
  Esc 分层序：弹层开启期 MC 的 registry Esc 条目让位（when 读开启态
  模块级镜像），Esc 仅取消弹层（document 捕获段自理）；弹层不在场后
  再按 Esc 才经 registry 关整层——MC/switcher Esc 条目注册序均在搜索
  Esc 之前（首个命中停止语义）。

### 37.4 Dock 两档空间感知指示（W9）

- **两档判定**（`dock-space.ts` 纯模块，零 DOM 零订阅）：当前 Space →
  既有 **active 条**（底部 2×16px primary 细条，§34.6，语义零变化）；
  其他 Space → **subtle 圆点**（底部同位置 `h-1 w-1 rounded-full
  bg-primary/40` 降不透明度档）+ tooltip「在其他空间」zh/en——无新
  token、无新动效；`null`=无指示（无窗，或当前 Space 窗未聚焦/已最小化，
  与既有「不亮」口径一致）。
- **瓷贴代表窗跨 Space 选取**：一个 app 多窗分居时**当前 Space 最新窗
  优先**（active 判定不被其他 Space 的更新窗顶掉）。
- **点击语义（macOS 惯例）**：点他 Space 瓷贴 = `switchSpace` →
  `restore+focus`（不把窗拉过来自建第三种归属）；点击瞬间读 live
  spaceId 防过期快照。运行行仍列全部窗口（系统级行）但他 Space 行降
  透明 + 标注；悬停主预览只展示当前 Space 窗口。
- **契约不变**：波浪/浮起链（dock-wave 唯一浮起，§32.5 修订 13 与
  §36.1 裁决 1）与引擎层零触碰。

### 37.5 Window Switcher（W6，Alt+W）

面板 = `.glass-popover`（surface-glass 既有钉扎档）+ `shadow-popover`
软影 + `border-border` 细边 + AppIcon（与 Taskbar 同一图标源）；**z-50
档**（与搜索面板同层，popover 单槽互斥保证不并存）。选中态
`[background:var(--ag-capsule-active)]` + `text-primary-contrast`（
「primary 配额=Active/Selected」同族语义）。交互三段：Alt+W 按住出面板
并按 z 序轮转（会话序列稳定，不随焦点跳顶重排）、松开提交（选中为
minimized 转 restore+focus）、轻点=不开面板直接轮转（迁移前肌肉记忆
兼容）；Esc 关面板不切换（注册序在搜索 Esc 前）；面板开启期 window
blur 兜底提交当前选中，不悬挂。

### 37.6 Workspace↔Space 映射副指示（W8）

Workspace selector 主选中样式语义不变（选中 W 档胶囊
`--ag-capsule-active` 不动）；增**Active 副指示**——某 W 档绑定的
Space === activeSpaceId 时，该档显示**小圆点**（`h-1.5 w-1.5
rounded-full` + `border-primary` + `[background:var(--ag-capsule-active)]`
既有 token），随任意路径的 switchSpace（快捷键/Mission Control/Dock
点击）实时移动。四档 1:1 Primary 绑定：personal 首点绑默认 Space
"Desktop 1"（不新播）；绑定指向已删 Space 或无绑定时按需播种回落。
