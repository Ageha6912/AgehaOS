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
