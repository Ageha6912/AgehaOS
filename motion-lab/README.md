# AgehaOS 动效实验室 · 设计文档

> 本文档是 `motion-lab/` 全部演示模块的**主交付文档**：动效语言的来源与映射、
> 每个模块的效果清单 / 设计动机 / 可调参数 / 无障碍降级行为、两档增强的分级
> 理由与启停方式、三种实现路线的性能对比与推荐档、以及向 AgehaOS 产品代码
> 集成的具体挂载点。
>
> - 动效语言权威规范：[`SPEC.md`](SPEC.md)（实验室内部唯一约定）
> - 共享设计令牌：[`shared/tokens.css`](shared/tokens.css)（`--ml-*`，数值源自产品 `src/index.css` 的 `--ag-*`）
> - 演示中心：[`index.html`](index.html)（双击即看全部模块入口）
> - 浏览器验证：[`verify.mjs`](verify.mjs)（`node motion-lab/verify.mjs`）

---

## 目录

1. [动效语言：macOS Big Sur+ → AgehaOS 的映射](#1-动效语言macos-big-sur--agehaos-的映射)
2. [模块总览](#2-模块总览)
3. [核心动效模块](#3-核心动效模块)
   - 3.1 [boot · 开机启动动画](#31-boot--开机启动动画)
   - 3.2 [window · 窗口生命周期](#32-window--窗口生命周期)
   - 3.3 [dock · Dock 放大波浪](#33-dock--dock-放大波浪)
   - 3.4 [menu-toast · 菜单与通知](#34-menu-toast--菜单与通知)
4. [基础增强档（enhance-basic，5 项）](#4-基础增强档enhance-basic5-项)
5. [进阶炫技档（enhance-advanced，5 项）](#5-进阶炫技档enhance-advanced5-项)
6. [两档增强的分级说明与启停方式](#6-两档增强的分级说明与启停方式)
7. [实现方式三档对比：纯 CSS / JS（rAF·WAAPI）/ WebGL](#7-实现方式三档对比纯-css--jsrafgaapi--webgl)
8. [对接 AgehaOS 的集成指引](#8-对接-agehaos-的集成指引)
9. [验证与验收](#9-验证与验收)

---

## 1. 动效语言：macOS Big Sur+ → AgehaOS 的映射

> 权威细则见 [`SPEC.md`](SPEC.md)，本节是总体说明。

macOS Big Sur 及之后版本的动效气质，本质是 Apple《Designing Fluid Interfaces》
（WWDC 2018）一脉的思想。本实验室把它提炼为**五法则**，并全部翻译为
Web 合成层动画实现：

| macOS 法则 | 本系统的翻译 | 落地位置 |
| --- | --- | --- |
| **空间连续、来源锚定**——东西从触发它的元素长出来，进出场沿同一路径 | `transform-origin` 投影到触发源坐标；退场取进场曲线的镜像（控制点 `(1-x, 1-y)`）；窗口关闭恒短于打开 | window 模块（窗口从 Dock 图标长出、genie 沿原路飞回且 `anim.reverse()` 严格镜像）、menu-toast（菜单浮出 4px 同路返回） |
| **弹性即质量**——默认临界阻尼，过冲只属于真正携带动量的交互 | 曲线令牌分层：`--ml-ease-standard`（强减速日常进场）/ `--ml-ease-spring`（无真过冲的冲劲）/ `--ml-ease-spring-bounce`（约 4% 克制过冲，仅甩入类）；JS 跟随类必须从当前呈现值续动、可半途抓回 | tokens §1、window、dock、menu-toast |
| **距离衰减波浪**——指针是扰动源，图标按距离衰减参与，形成连续波浪 | 高斯公式 `scale = 1 + (max-1)·exp(-d²/2σ²)`，rAF 逐帧计算、1:1 跟随，离开后 200ms 级收敛 | dock 模块 |
| **节奏分层**——退场比进场快；通知「滑入-驻留-滑出」三段；错峰 40~60ms | 进场取 `--ml-dur-base/mid`、退场降一档 + `--ml-ease-in`；驻留期完全静止（仪表不闪烁，DESIGN.md §2.5 不新增循环动画） | window、menu-toast、enhance-basic/stagger-enter |
| **材质真实**——毛玻璃是「材质到达」不是透明度动画 | 玻璃归 chrome、纸面归应用；blur 档只做一次性切换、永不逐帧动画；玻璃浮层入场 blur+scale+opacity 一次到位（materialize） | tokens §4、enhance-basic/glass-panel |

**性能铁律**（SPEC §3，逐条可验收）：

1. 一切过渡 **150~300ms**，唯一豁免是开机动画（须在 PARAMS 注释中说明理由）；
2. 只动 **`transform` / `opacity`**（transition、animation 或 rAF 皆可），禁止过渡任何布局/绘制属性；
3. 指针驱动的连续动效一律 **rAF 节流**：事件回调只记数据，每帧至多一次样式写，且必须可中断、从当前值续算；
4. **blur 不参与逐帧动画**，材质档位一次性切换；
5. **`will-change` 只在动效前挂载、结束后摘除**；
6. CSS transition 天然可中断（保留），rAF 实现必须可反向。

**令牌与 PARAMS 的分工**（SPEC §4）：系统级常量（曲线/时长档/色板/玻璃/阴影/z 层）
一律走 `shared/tokens.css` 的 `--ml-*`，模块禁止散落魔数；模块个性的量
（缩放幅度、位移距离、衰减宽度、驻留秒数）集中在各模块 **JS 顶部唯一
`PARAMS` 常量对象**，全中文注释，调性能只动这里。深色适配 = 给根节点加
`ml-dark` 类，整套语义自动翻转（tokens §8）。

---

## 2. 模块总览

| 分组 | 模块 | 一句话 | 入口页（可双击） |
| --- | --- | --- | --- |
| 核心动效 | `boot/` | 纯黑启动层 + rAF 四段变速进度条 + 淡出放大露出登录卡 | [`boot/index.html`](boot/index.html) |
| 核心动效 | `window/` | 窗口从 Dock 图标弹性长出 / 沿原路收拢 / genie 最小化飞行 | [`window/index.html`](window/index.html) |
| 核心动效 | `dock/` | 高斯距离衰减的 Dock 放大波浪 + 玻璃底座 + tooltip | [`dock/index.html`](dock/index.html) |
| 核心动效 | `menu-toast/` | 右键菜单与下拉菜单同款浮入动效 + 通知滑入-驻留-滑出 | [`menu-toast/index.html`](menu-toast/index.html) |
| 基础增强 | `enhance-basic/` | 毛玻璃面板 / 图标按压 / 错峰入场 / 跟随光晕 / 点击涟漪 | [`enhance-basic/index.html`](enhance-basic/index.html) |
| 进阶炫技 | `enhance-advanced/` | 壁纸视差 / Canvas 流光 / 窗口转场 tilt / Dock 扫光 / 光晕呼吸 | [`enhance-advanced/index.html`](enhance-advanced/index.html) |

全部模块：框架无关（原生 HTML/CSS/JS 三文件）、零外部网络依赖、只动
transform/opacity、`ml-dark` 一键深色、`prefers-reduced-motion` 全量降级。
浏览器冒烟：`node motion-lab/verify.mjs`（12/12 页零报错 + 关键行为断言）。

---

## 3. 核心动效模块

### 3.1 boot · 开机启动动画

**文件**：`boot/index.html` + `boot/boot.css` + `boot/boot.js`
**实现档**：JS rAF（分段变速曲线只有 JS 能表达，见 §7）
**测试**：`boot/boot.test.mjs`（Vitest，含曲线单调性与 API 契约）

**效果清单**

- 纯黑全屏启动层（`--ml-z-boot` 档，一切之上）+ 品牌 Logo（可配置，带三级回退链直至内联 SVG 兜底，双击永不破图）+ 细长圆角进度条；
- 进度条为 **rAF 四段变速**（快-慢-慢-冲刺，禁止匀速线性）：每段独立缓动函数，全程严格单调；后台标签页暂停期间只累计可见帧间隔（单帧封顶 100ms），回前台不跳变；
- 进度只用 `scaleX` 写入（禁 width 布局属性），整数百分比变化时同步 `aria-valuenow`；
- 3.8s 完成后：登录占位卡先以 scale 0.985→1 就位（250ms `--ml-ease-spring`），启动层淡出 + 放大 1.05（400ms `--ml-dur-boot` 豁免档）露出下层；
- 对接接口 `window.AgehaBoot = { onBootProgress, onBootComplete, skip }` + 测试钩子 `data-boot="complete"`；`window.AgehaBootConfig` 可在加载前覆写总时长（钳制 3000~5000）。

**设计动机**：开机是系统唯一一次「全屏独占」的亮相，目标是「品牌亮相 + 可感知的进度」，
而不是炫技。四段变速模拟真实加载节奏（固件自检一把推上 → 内核缓慢爬坡 → 服务就位平台期 → 收尾冲刺），
比匀速进度条可信得多；进度感来自内容本身，不加任何循环动画。

**可调参数**（`boot/boot.js` 顶部 `PARAMS`，原文抄录）

| 参数 | 默认值 | 说明 |
| --- | --- | --- |
| `logoSrc` | `'../public/brand/agehaos-logo-v2-full-512.png'` | Logo 图片地址（v2 透明底、含字标；支持 URL 查询参数 `?logo=<地址>` 运行时覆盖）；自 `motion-lab/boot/` 解析为 `motion-lab/public/brand/…` |
| `logoFallbacks` | `['../../public/brand/agehaos-logo-v2-full-512.png', '../public/brand/agehaos-logo-v2-mark-256.png', FALLBACK_LOGO_DATA_URI]` | Logo 加载失败时的依次回退候选（末项为内联 SVG data URI，永不破图） |
| `BOOT_DURATION_MS` | `3800` | 开机总时长 ms（允许 3000~5000，越界自动收敛）。豁免理由：进度推进是「内容本身的进度感」（SPEC §2 开机行），不受 300ms 铁律约束 |
| `exitDurationMs` | `400` | 退场（淡出 + 放大）时长 ms；开机豁免档，对应共享令牌 `--ml-dur-boot`（400ms） |
| `maxScale` | `1.05` | 退场放大上限（scale 1 → 1.05，macOS 开机同款轻微放大） |
| `revealScaleFrom` | `0.985` | 登录卡露出起始缩放（0.985 → 1；CSS 侧 250ms `--ml-ease-spring`，铁律内） |
| `logoSizePx` | `96` | Logo 显示宽度 px |
| `barWidthPx` | `240` | 进度条宽度 px |
| `barHeightPx` | `4` | 进度条高度 px（约 4px 细长圆角条） |
| `logoBarGapPx` | `44` | Logo 与进度条的垂直间距 px |
| `segments` | `[{to:36, share:0.16, easeOutCubic}, {to:62, share:0.36, easeInOutSine}, {to:80, share:0.26, easeInOutSine}, {to:100, share:0.22, easeInCubic}]` | 分段变速节奏：`share` 为时间占比（合计 1），`to` 为该段结束进度（%），`ease` 为段内缓动。注释：快-固件自检 / 慢-内核与驱动 / 慢-服务就位平台期 / 冲刺-收尾冲线 |
| `reducedMotion` | `false` | 运行时由 matchMedia 检测覆写（不许手填） |

CSS 侧时长（与 PARAMS 注释互指）：Logo 加载完成淡入 200ms（`--ml-dur-base`）、
登录卡就位 250ms（`--ml-dur-mid` + `--ml-ease-spring`）、退场
`--boot-exit-duration`（JS 注入）→ 回落 `--ml-dur-boot`（400ms 豁免档）。

**prefers-reduced-motion 行为**：JS 检测后**进度条照常由 rAF 推进**（功能性反馈），
但一切位移/缩放/淡出动画关闭——退场直接 `hidden` 切换；CSS 侧令牌塌缩 +
`boot.css` 显式斩断过渡双保险；Logo 淡入与登录卡就位呈直接显隐。

**对接接口速览**（详见 §8.1）：

```js
window.AgehaBoot.onBootProgress((pct) => {}); // 每次推进回调 0~100 整数
window.AgehaBoot.onBootComplete(() => {});    // 进度到 100 时触发一次（之后订阅立即补发）
window.AgehaBoot.skip();                      // 立即跳到完成并播退场（幂等）
```

### 3.2 window · 窗口生命周期

**文件**：`window/index.html` + `window/window.css` + `window/window.js`
**实现档**：JS Web Animations API（需要几何锚定与 reverse，见 §7）

**效果清单**

- **打开**：窗口从对应 Dock 图标方向弹性长出——`transform-origin` 投影到图标中心（带限幅防怪异支点），`scale 0.9→1 + opacity 0→1`，200ms `--ml-ease-spring`；
- **关闭**：同一条路径反向收拢（origin 一致），150ms `--ml-ease-in`，**恒短于打开**（退场降一档）；
- **genie 最小化**：读取 Dock 图标屏幕位置，WAAPI 三关键帧飞行——位移 + `scale(0.08, 0.04)` 横缩纵压 + 渐隐，中段偏移制造「先坠后收」弧线，300ms；
- **还原** = 同一组关键帧 `anim.reverse()` 反向播放，时间镜像 → **路径与节奏严格对称**；飞行中点再点一次可半途抓回（反向续动），交叉操作（最小化途中直接关）先快进落定再执行，任何时刻不锁输入；
- 焦点窗口带主题色描边（inset box-shadow 挂在伪元素上做 opacity 过渡），最小化栈 LIFO 还原；3 个可操作窗口（红绿灯 / Dock 图标 / 控制按钮三套入口）+ 深浅色一键切换。

**设计动机**：窗口是桌面 OS 最高频的空间操作，动效必须回答「从哪来、回哪去」。
macOS 的答案是来源锚定 + 路径对称——打开的方向感一旦被反向破坏，空间感瞬间瓦解；
genie 的挤压变形则给了「窗口被收进图标里」这个隐喻以物理证据。

**可调参数**（`window/window.js` 顶部 `PARAMS`，原文抄录）

| 参数 | 默认值 | 说明 |
| --- | --- | --- |
| `openMs` | `200` | 打开时长 ms，`--ml-dur-base` 同值 |
| `closeMs` | `150` | 关闭时长 ms，`--ml-dur-fast` 同值（退场降一档，恒短于打开，SPEC §1.4） |
| `flightMs` | `300` | genie 最小化/还原飞行时长 ms，`--ml-dur-slow` 同值（本模块最大位移取最高档）；还原反向共用此时长 |
| `autoOpenDelayMs` | `400` | 载入后自动演示打开「备忘录」的等待 ms（启动延迟，非过渡时长，不受 150~300 约束） |
| `openEase` | `[0.32, 0.72, 0, 1]` | 打开：`--ml-ease-spring` 同值（弹簧近似、无真过冲的冲劲） |
| `closeEase` | `[0.55, 0, 1, 0.45]` | 关闭：`--ml-ease-in` 同值（加速退场，消失比出现快） |
| `flightEaseLeg1` | `[0.55, 0, 1, 0.45]` | genie 前段（离窗俯冲加速）：`--ml-ease-in` 同值 |
| `flightEaseLeg2` | `[0.2, 0, 0, 1]` | genie 后段（缓收落进 Dock）：`--ml-ease-standard` 同值 |
| `openScaleFrom` | `0.9` | 打开起始缩放（越小弹性感越强） |
| `closeScaleTo` | `0.92` | 关闭终态缩放（路径与打开对称但行程略短） |
| `minScaleX` | `0.08` | 落入 Dock 时横向缩放 |
| `minScaleY` | `0.04` | 落入 Dock 时纵向压扁 = 横向一半，genie 挤扁感 |
| `midOffset` | `0.55` | genie 中段关键帧的时间位置（0~1） |
| `midTravelX` | `0.45` | 中段横向行程比例（<0.5） |
| `midTravelY` | `0.6` | 中段纵向行程比例（>横向 → 先坠后收，飞出弧线） |
| `midScaleX` | `0.5` | 中段横向缩放 |
| `midScaleY` | `0.32` | 中段纵向缩放（压扁开始） |
| `midOpacity` | `0.8` | 中段透明度 |
| `originClampX` | `[-50, 150]` | transform-origin 横向投影限幅 %（防极端远的图标产生怪异支点） |
| `originClampY` | `[100, 140]` | transform-origin 纵向投影限幅 %（Dock 恒在窗口下方，投影 ≥100%） |
| `reducedMotion` | `false` | 运行时由 matchMedia 检测覆写，不许手填 |

**prefers-reduced-motion 行为**：`matchMedia` 实时检测并监听 `change`；reduce 下
**所有状态变化瞬时直达终态**（不启动任何动画）——降级选型为「瞬时切换」，
任务明确要求，覆盖 SPEC §5 的「≤150ms 交叉淡化」选项。几何读取只发生在手势
触发的一瞬间，全程无逐帧布局读取。

### 3.3 dock · Dock 放大波浪

**文件**：`dock/index.html` + `dock/dock.css` + `dock/dock.js`
**实现档**：JS rAF（指针连续跟随，见 §7）
**测试**：`dock/dock.test.mjs`（纯函数：高斯衰减 / 贝塞尔求值 / 单图标 scale）

**效果清单**

- **高斯距离衰减放大波浪**：`scale = 1 + (maxScale-1)·exp(-d²/2σ²)`，d 为指针到图标中心的水平距离——近者放大多、远者趋于 1，连续无跳变；rAF 逐帧写 `translateY + scale`，帧内零布局读取；
- **包络机制**：指针进入时整体幅度 150ms 起势、离开后 200ms 收敛回落；包络满格期间波形严格 1:1 跟随指针，中途进入/离开都从当前包络值续算，可随时反向；
- **按压反馈**：按下瞬间 `pressScale` 压缩，指数平滑回弹（时间常数 `pressTauMs`），触屏点按同样生效；
- **玻璃底座 + 名称 tooltip + 发光 pulse 激活点**（pulse 为 2.4s 低频循环，任务要求的「轻微 pulse」豁免，reduce 下关闭）；图标中心坐标在初始化/resize/pointerenter 一次性实测缓存（scale 以中心为原点，缓存恒定有效）；
- **三路降级**：触屏（无 hover）保留按压缩放反馈、键盘（原生 button + aria-pressed）可达、reduced-motion 关闭波浪；`ml-dark` 深色适配。

**设计动机**：Dock 放大是 macOS 最具辨识度的「指针扰动」隐喻——图标不是各自独立地弹跳，
而是同一片水面上按距离衰减的连续波。实现的关键纪律是**每帧零布局读取**：
事件回调只记坐标，几何在进入瞬间一次性缓存，计算全部在 rAF 帧内完成。

**可调参数**（`dock/dock.js` 顶部 `PARAMS`，原文抄录）

| 参数 | 默认值 | 说明 |
| --- | --- | --- |
| `maxScale` | `1.6` | 波峰放大上限（倍）。波峰上探 ≈ icon-size×(maxScale-1)/2 + liftHeight |
| `falloffRadius` | `68` | 高斯衰减宽度 σ（px）：越大波浪越宽；过宽会使相邻图标在波峰处重叠（本模块只允许 scale + translateY，不能横向推开邻居），建议 ≤ 1.2×图标间距 |
| `liftHeight` | `6` | 波峰处图标额外上浮高度（px），随放大比例线性参与 |
| `enterMs` | `150` | 指针进入 Dock 时波浪起势时长 ms（对应令牌 `--ml-dur-fast` 档；仅作用于整体幅度包络，包络满格后波形 1:1 跟随指针，无滞后） |
| `settleMs` | `200` | 指针离开后收敛回落时长 ms（对应令牌 `--ml-dur-base` 档，SPEC §2 约定 200ms 级） |
| `ease` | `[0.2, 0, 0, 1]` | 起势/收敛共用曲线：与令牌 `--ml-ease-standard` 同值的贝塞尔控制点（rAF 侧无法直接引用 CSS 变量，故同值声明，注释互指） |
| `pressScale` | `0.94` | 按下瞬间图标的压缩倍率（物理按压反馈；1 = 关闭该反馈） |
| `pressTauMs` | `60` | 按压缩放指数平滑时间常数 ms（越小越跟手；≈ `--ml-dur-fast` 档的手感） |

**prefers-reduced-motion 行为**：rAF 波浪/按压/上浮**整体不启动**（JS 检测 +
`change` 实时响应，命中时清空全部 transform 与 will-change）；CSS 侧收尾——
激活点 pulse 关闭、tooltip 取消位移只剩即时显隐；**悬停变色保留**（状态可感知）。

### 3.4 menu-toast · 菜单与通知

**文件**：`menu-toast/index.html` + `menu-toast/menu-toast.css` + `menu-toast/menu-toast.js`
**实现档**：纯 CSS transition（JS 只做定位与节点管理，见 §7）
**测试**：`menu-toast/check.mjs`

**效果清单**

- **菜单动效（右键上下文菜单与顶部下拉共用同款）**：淡入 + 上浮 4px→0（150ms ease-out）；关闭快速淡出 + 反向微移（150ms ease-in，恒不长于打开）；右键弹到指针位置并做视口边缘收拢防裁切；
- **系统通知**：右上角 `translateX + fade` 滑入（250ms）→ 驻留 3 秒（**hover 暂停计时**，离开续走剩余时间）→ 滑出（200ms ease-in）；多条向下堆叠，关闭后下方通知腾位上移走 transform 过渡（与滑出并行）；「连发三条」演示错峰就位；
- **「定位层 + 动效层」双层架构**：定位层（`.ml-pop` / `.ml-toast-slot`）只承担 translate 摆位不挂过渡，动效层（`.ml-pop-card` / `.ml-toast`）只过渡 opacity + transform——换位重开互不干扰、CSS transition 天然可中断、半途反向从当前值续动；
- **计时器纪律**：所有 setTimeout 句柄集中保存，出现/关闭/换位重开前一律先 clear，`pagehide` 统一兜底清理（内存泄漏防线）；键盘：菜单项方向键巡航、焦点归还触发者、`:focus-visible` 环照常。

**设计动机**：菜单与通知是「弹层」的两副面孔，共用同一条浮入动效让整个系统的
弹层语言统一（SPEC §1.1 空间连续）；通知的滑入-驻留-滑出三段节奏里，**驻留期
完全静止**——仪表不闪烁。与 SPEC 的差异均为需求优先并已在代码头注明：
菜单进场 150ms（SPEC 表格默认 200ms）、下拉沿用右键同款上浮（SPEC 建议向下浮入）、
通知驻留 3s（SPEC 建议 5s）、滑入用右上角 translateX（SPEC 顶部横幅为 translateY）。

**可调参数**（`menu-toast/menu-toast.js` 顶部 `PARAMS`，原文抄录）

| 参数 | 默认值 | 说明 |
| --- | --- | --- |
| `menuInMs` | `150` | 进场时长 ms：淡入 + 上浮，对应 `--ml-dur-fast`（需求指定约 150ms ease-out） |
| `menuOutMs` | `150` | 退场时长 ms：快速淡出 + 反向微移，对应 `--ml-dur-fast` + `--ml-ease-in`（关闭恒不长于打开） |
| `menuShiftPx` | `4` | 菜单浮出位移 px：translateY 4px→0（写入 CSS 变量 `--menu-shift`） |
| `menuEdgeGapPx` | `8` | 菜单贴视口边缘时的最小留白 px（防溢出裁切） |
| `dropdownGapPx` | `6` | 下拉菜单与触发按钮下缘的间距 px |
| `toastInMs` | `250` | 滑入时长 ms：translateX + fade，对应 `--ml-dur-mid` |
| `toastOutMs` | `200` | 滑出时长 ms：translateX 回去 + fade，对应 `--ml-dur-base` + `--ml-ease-in`（退场比进场快） |
| `dwellMs` | `3000` | 驻留时长 ms：需求指定 3 秒（SPEC §1.4 建议 5s，按「需求优先」取 3s，特此注明） |
| `stackGapPx` | `10` | 多条通知堆叠间距 px（写入 `--toast-gap`） |
| `toastOverhangPx` | `24` | 滑入/滑出超出通知自身宽度的余量 px（保证完全从屏幕外进出，写入 `--toast-overhang`） |
| `toastTopPx` | `64` | 通知容器距视口顶部 px（避让 52px 顶栏，写入 `--toast-top`） |
| `toastSidePx` | `16` | 通知容器距视口右侧 px（写入 `--toast-side`） |
| `toastWidthPx` | `340` | 通知卡片固定宽度 px（固定宽度 → 高度稳定 → 堆叠位移计算准确） |
| `burstCount` | `3` | 「连发三条」一次创建的通知条数（演示堆叠与腾位） |
| `burstGapMs` | `350` | 连发间隔 ms：大于进场时长，「下方腾位、依次就位」才看得清 |
| `reducedMotion` | `false` | 运行时状态：prefers-reduced-motion 检测结果，由 matchMedia 自动覆写，不许手填 |

**prefers-reduced-motion 行为**：JS 侧 `jsDur()` 把兜底等待归零 + `change` 实时同步；
CSS 侧令牌塌缩 + `menu-toast.css` 显式 `transition: none` + 位移归零双保险——
**直接显隐**；hover 暂停、键盘焦点与焦点归还逻辑不受降级影响。

---

## 4. 基础增强档（enhance-basic，5 项）

**文件**：`enhance-basic/index.html`（可开关组合演示页）+ 每项独立的
`.css`/`.js` 对（`glass-panel` / `icon-press` / `stagger-enter` / `cursor-glow` /
`click-ripple`）+ `demo-page.css`/`demo-page.js`（演示页框架与主题切换）。
**测试**：`enhance-basic/tests/`（静态验收 19 项 + jsdom DOM 行为 37 项，全过）。

每项都是独立效果：只引对应 css+js、页面上出现约定根元素（`data-demo="…"`）
即生效，互不依赖、互不感知。

| # | 效果 | 一句话 | 设计动机 |
| --- | --- | --- | --- |
| 01 | `glass-panel` 毛玻璃拟态面板 | blur 四档一次性切换 + materialize 入场 + 实色兜底开关 | 毛玻璃是「材质到达」不是透明度动画：blur+scale+opacity 一次到位；`@supports` 失败路径与关玻璃开关同观感 |
| 02 | `icon-press` 图标按压微动效 | 按下 scale 0.92、松开 150ms 弹回 | 按压是最便宜的「物理存在感」：CSS transition 合成器接管，JS 只补键盘等价反馈 |
| 03 | `stagger-enter` 进桌面错峰入场 | 多元素 60ms 间隔依次上浮入场，播完落定摘 fill | 进桌面的「一层层就位」秩序感（SPEC §1.4 错峰 40~60ms，禁止超 100ms） |
| 04 | `cursor-glow` 鼠标跟随光晕 | 320px 光斑以 0.18 平滑系数跟随指针 | 桌面「有光」的氛围感：rAF 节流 + 收敛停帧，静置不烧空闲帧 |
| 05 | `click-ripple` 点击涟漪 | 点击点扩散圆（铺满宿主的直径计算），播完自清理 | 触点反馈的坐标证据：直径按「点击点到最远角距离 ×2 ×1.15」保证任意点都能铺满 |

**可调参数**（各 JS 顶部 `PARAMS`，原文抄录）

**01 glass-panel.js**

| 参数 | 默认值 | 说明 |
| --- | --- | --- |
| `materializeMs` | `250` | 入场 materialize 时长 ms —— 与 CSS 侧 `var(--ml-dur-mid)` 同源；铁律 150~300 内 |
| `defaultTier` | `'md'` | 默认模糊档 xs/sm/md/lg —— 对应 `--ml-blur-xs/sm/md/lg`；blur 永不逐帧动画（SPEC §3.4） |
| `liftPx` | `2` | 悬停抬升位移 px —— 注入 CSS 变量 `--glass-lift`（transform 实现） |

**02 icon-press.js**

| 参数 | 默认值 | 说明 |
| --- | --- | --- |
| `pressScale` | `0.92` | 按下缩放（任务指定 0.92）——注入 CSS 变量 `--ip-press-scale` |
| `pressMs` | `150` | 按下时长 ms —— 与 CSS 侧按下态 `var(--ml-dur-fast)` 同源（微反馈最低档） |
| `releaseMs` | `150` | 松开回弹时长 ms —— 与 CSS 侧常态 `var(--ml-dur-fast)` 同源；回弹感来自松开侧 `--ml-ease-spring` 曲线 |
| `keyboard` | `true` | 键盘 Enter/Space 触发同款按压态（可达性：焦点可达即反馈可达） |

**03 stagger-enter.js**

| 参数 | 默认值 | 说明 |
| --- | --- | --- |
| `durationMs` | `250` | 单个元素入场时长 ms —— 与 CSS 侧 `var(--ml-dur-mid)` 同源 |
| `staggerMs` | `60` | 错峰间隔 ms —— SPEC §1.4 规定 40~60（超 100ms 会拖沓）；注入 `--se-stagger` |
| `risePx` | `14` | 上浮位移距离 px（translateY 起点）——注入 `--se-rise` |
| `baseDelayMs` | `0` | 首元素前置延迟 ms —— 注入 `--se-base` |

**04 cursor-glow.js**

| 参数 | 默认值 | 说明 |
| --- | --- | --- |
| `size` | `320` | 光斑直径 px —— 注入 CSS 变量 `--cg-size` |
| `opacity` | `0.5` | 光斑不透明度 —— 注入 CSS 变量 `--cg-opacity` |
| `smoothing` | `0.18` | 跟随平滑系数 0~1：1 = 1:1 瞬时跟随，越小拖尾越长；reduced-motion 下强制 1 |
| `fadeMs` | `150` | 进出舞台淡入淡出时长 ms —— 与 CSS 侧 `var(--ml-dur-fast)` 同源 |
| `blend` | `'auto'` | mix-blend-mode：`'auto'` = 浅色 multiply / 深色 screen（CSS 侧定义）；`'normal'` = 关闭混合 |

**05 click-ripple.js**

| 参数 | 默认值 | 说明 |
| --- | --- | --- |
| `durationMs` | `300` | 涟漪扩散时长 ms —— 与 CSS 侧 `var(--ml-dur-slow)` 同源（铁律上限档） |
| `startAlpha` | `0.4` | 涟漪起始不透明度 —— 注入 CSS 变量 `--cr-alpha` |
| `cover` | `1.15` | 覆盖系数：直径 =「点击点到最远角距离 ×2」× cover，保证铺满宿主 |
| `maxDiameter` | `720` | 涟漪直径上限 px：防止在超大容器里一次生成巨图层拖累合成器 |
| `keyboard` | `true` | 键盘 Enter/Space 在元素中心触发同款涟漪 |

**prefers-reduced-motion 行为**（逐项）

| 效果 | 降级选型（SPEC §5） |
| --- | --- |
| glass-panel | 「短促淡入直接呈现最终画面」：JS 摘除入场动画（直接 `is-materialized`），重播不播；blur 档与实色兜底不受影响 |
| icon-press | 「动效关闭」：CSS 时长档被令牌塌缩为瞬时缩放（状态仍可感知）；JS 不再绑定键盘按压类，反馈退化为原生 `:active` + `:focus-visible` 焦点环 |
| stagger-enter | 「直接呈现最终画面」：全部元素同帧在场、无位移；重播同样瞬时落定 |
| cursor-glow | 「1:1 瞬时跟随」：平滑系数强制 1，opacity 过渡被令牌塌缩为瞬现瞬隐 |
| click-ripple | 「动效关闭」：不注入涟漪；点击反馈退化为宿主 `:active` 瞬时微缩放 |

---

## 5. 进阶炫技档（enhance-advanced，5 项）

**文件**：`enhance-advanced/index.html`（可开关组合演示页，**默认仅开「视差 + 光晕」**）
+ 每项独立子目录（`parallax/`、`aurora/`、`window-tilt/`、`dock-sheen/`、
`theme-glow/`，各含 `index.html` + `.css` + `.js`，可单独双击预览）
+ `style.css`/`script.js`（组合页样式与控制器）。
**测试**：`enhance-advanced/tests/`（静态验收 98 项 + Playwright 运行时冒烟 31 项，全过）。

| # | 效果 | 一句话 | 设计动机 |
| --- | --- | --- | --- |
| 1 | `parallax` 壁纸三层视差景深 | 远山几乎不动、中景轻移、前景明显跟随（10/22/38px 三档位移差） | 让壁纸成为「有纵深的空间」——用三层位移差讲出 Big Sur 式景深 |
| 2 | `aurora` Canvas 流光氛围 | 低透明度极光光斑缓慢漂移，双主题各自配色 | 给桌面铺一层「系统有温度」的氛围：光斑预烘焙成离屏精灵、每帧只 drawImage，半分辨率 + 30fps 上限 |
| 3 | `window-tilt` 窗口切换转场 | crossfade + ≤2° 3D tilt，朝旧窗口方向轻轻让位；失焦窗口降透明度微缩退后 | 焦点切换是最高频的状态变化，让「注意力从 A 移到 B」成为一次可见的小起立 |
| 4 | `dock-sheen` Dock 斜向扫光 | 高光带 -16° 斜向扫过底座，9s 循环（静默期占 76%） | 低频的「釉面反光」暗示玻璃材质真实：只在你不注意时路过一次，不抢戏 |
| 5 | `theme-glow` 主题光晕呼吸 | 主题色大光斑（72vmax）在壁纸深处 9s 缓慢呼吸 | 让主题色从「平面上的颜色」变成「空间里的光」 |

**可调参数**（各 JS 顶部 `PARAMS`，原文抄录）

**parallax/parallax.js**

| 参数 | 默认值 | 说明 |
| --- | --- | --- |
| `farPx` | `10` | 远景层最大水平位移 px（远山几乎不动 = 空间最远） |
| `midPx` | `22` | 中景层最大水平位移 px |
| `nearPx` | `38` | 前景层最大水平位移 px（近景位移最大 = 离观者最近） |
| `verticalRatio` | `0.55` | 垂直位移 = 水平位移 × 该系数（纵向弱化更接近镜头平移感） |
| `dir` | `-1` | 视差方向：-1 = 场景朝指针反方向轻移（镜头转向指针） |
| `lerp` | `0.085` | 每帧向目标插值系数（0~1：越小越「重」越柔，越大越跟手） |
| `epsilon` | `0.0012` | 收敛阈值：与目标差小于它即停帧省电（归一化坐标） |
| `drainMs` | `220` | 关闭效果时从当前位移缓退归零的时长 ms（防跳变，非交互过渡） |
| `reducedMotion` | `false` | 运行时由 matchMedia 检测覆写，不许手填 |

**aurora/aurora.js**

| 参数 | 默认值 | 说明 |
| --- | --- | --- |
| `maxDpr` | `2` | devicePixelRatio 上限（高分屏不按 3 绘制） |
| `renderScale` | `0.5` | 内部渲染分辨率缩放（0.25~1）：0.5 = 半分辨率 + CSS 拉伸，填充率减半 |
| `blobCount` | `4` | 光斑数量（每帧 drawImage 次数 = 此值，开销线性） |
| `radiusMin` | `0.3` | 光斑半径下限（占画面短边比例） |
| `radiusMax` | `0.55` | 光斑半径上限 |
| `coreAlpha` | `0.85` | 光斑精灵径向渐变中心的透明度 |
| `alphaLight` | `0.2` | 浅色主题 canvas 整体透明度（低透明度氛围） |
| `alphaDark` | `0.34` | 深色主题 canvas 整体透明度（深底需更高存在感） |
| `speed` | `0.05` | 流动基准角速度 rad/s（越慢越「呼吸」，太快会抢戏） |
| `orbitMin` | `0.05` | 光斑漂移轨道半径下限（占画面短边） |
| `orbitMax` | `0.14` | 光斑漂移轨道半径上限 |
| `fpsCap` | `30` | 帧率上限：缓慢流动 30fps 与 60fps 观感无差、开销减半 |
| `colorsLight` | `['#2f5fe8', '#7fa4ff', '#9db9ff', '#c9d9ff']` | 浅色主题光斑色（对齐 tokens §3 的钴蓝/蓝白族） |
| `colorsDark` | `['#2f5fe8', '#82a3ff', '#4fd2ff', '#8a7bff']` | 深色主题光斑色（加青/紫两笔极光感，围绕 `--ml-primary-dark` 族） |
| `reducedMotion` | `false` | 运行时由 matchMedia 检测覆写，不许手填 |

**window-tilt/window-tilt.js**

| 参数 | 默认值 | 说明 |
| --- | --- | --- |
| `tiltDegY` | `1.6` | 激活入场 rotateY 幅度 deg（铁律：≤2deg） |
| `tiltDegX` | `0.8` | 激活入场 rotateX 幅度 deg（铁律：≤2deg） |
| `scaleFrom` | `0.985` | 激活入场起始缩放（轻微后仰再立起） |
| `dim` | `0.86` | 失焦窗口透明度（轻微降，内容仍可辨） |
| `scaleUnfocused` | `0.995` | 失焦窗口轻微缩小（景深暗示） |
| `durInMs` | `250` | 激活动画时长 ms，对应令牌 `--ml-dur-mid`（窗口开合主体档） |
| `durOutMs` | `200` | 失焦淡出时长 ms，对应令牌 `--ml-dur-base`（退场更快） |
| `perspectivePx` | `1400` | 3D 视距 px：越大越平缓含蓄，越小透视越夸张 |
| `reducedMotion` | `false` | 运行时由 matchMedia 检测覆写，不许手填 |

**dock-sheen/dock-sheen.js**

| 参数 | 默认值 | 说明 |
| --- | --- | --- |
| `cycleMs` | `9000` | 扫光循环周期 ms（静默期占 76%——低频氛围、不抢戏）。低频氛围循环，非交互过渡，不受 150~300ms 档约束 |
| `angleDeg` | `-16` | 高光带倾角 deg（负值 = 右高左低的斜向扫过） |
| `stripWidthPct` | `30` | 高光带宽度（占 Dock 宽度百分比） |
| `peakLight` | `0.5` | 浅色主题高光峰值透明度（白高光压低不刺眼） |
| `peakDark` | `0.65` | 深色主题高光峰值透明度（深底需更亮才可读） |
| `delayMs` | `1500` | 启用后首扫延迟 ms（让位页面进场，不抢戏） |
| `reducedMotion` | `false` | 运行时由 matchMedia 检测覆写；CSS 侧另有降级：直接关闭循环 |

**theme-glow/theme-glow.js**

| 参数 | 默认值 | 说明 |
| --- | --- | --- |
| `cycleMs` | `9000` | 呼吸周期 ms（缓慢循环；氛围动画非交互过渡，不受 150~300ms 档约束） |
| `scaleMax` | `1.12` | 呼吸放大峰值（transform scale，合成层属性） |
| `minLight` | `0.45` | 浅色主题透明度谷值 |
| `maxLight` | `0.75` | 浅色主题透明度峰值 |
| `minDark` | `0.5` | 深色主题透明度谷值（深底需更高存在感） |
| `maxDark` | `0.9` | 深色主题透明度峰值 |
| `sizeVmax` | `72` | 光斑直径（vmax，铺出「大光斑」氛围） |
| `fadeMs` | `200` | 开关淡入淡出时长 ms，对应令牌 `--ml-dur-base` |
| `reducedMotion` | `false` | 运行时由 matchMedia 检测覆写；CSS 侧另有降级：循环关闭、保留静态谷值 |

**prefers-reduced-motion 行为**（逐项）

| 效果 | 降级选型（SPEC §5） |
| --- | --- |
| parallax | 「整体关闭视差、保留静态三层构图」——背景层不该在降级时仍随指针移动；JS 不绑事件，CSS 再 `transform: none !important` 双保险 |
| aurora | 「极简」档：只渲染一帧静态氛围（`render(7.3)`），不启动 rAF 循环；resize/主题切换时同步重绘静态帧 |
| window-tilt | 「位移与缩放归零，仅保留 120ms opacity 交叉淡化」：JS 跳过倾斜方向计算，CSS 侧 `transform: none` + 入场 keyframes 关闭，仅留 opacity 交叉淡化 |
| dock-sheen | 循环直接关闭（CSS `animation: none` + 高光带归零透明度） |
| theme-glow | 呼吸循环关闭、保留静态谷值透明度（`animation: none; opacity: var(--mlg-min)`） |

---

## 6. 两档增强的分级说明与启停方式

### 6.1 分级原则

| | 基础增强（enhance-basic） | 进阶炫技（enhance-advanced） |
| --- | --- | --- |
| 定位 | **低成本日常质感**，建议默认全开 | **氛围与转场**，按硬件与场景选开 |
| 成本 | 单项开销 ≈ 0（CSS 合成器接管；JS 侧仅 rAF 节流的跟随/注入） | 有常驻成本（视差每帧 3 次 transform 写、aurora 常驻 canvas 30fps、扫光/光晕常驻合成层动画） |
| 风险 | 几乎无——全部是 150~300ms 一次性微反馈 | 与内容渲染抢帧（aurora）、与窗口管理器叠加（tilt）——必须可单独关 |
| 禁区 | — | **不新增任何其他循环动画**（DESIGN.md §2.5）：仅本档四处豁免（dot pulse / 扫光 / 光晕 / aurora）且全部低频、可关、reduce 下关闭 |

### 6.2 基础增强五项：适用位置 / 性能成本 / 启停

| 效果 | 适用位置 | 性能成本 | 如何启用 / 关闭 |
| --- | --- | --- | --- |
| glass-panel | 任务栏、开始菜单、通知中心、窗口标题区等 **chrome 玻璃面**（玻璃归 chrome，纸面归应用） | 静态 blur（合成器一次建立）；materialize 仅入场 250ms 一次性 | 引入 `glass-panel.css/js` + 根元素 `data-demo="glass"`；演示页开关 `data-demo-switch="glass"`（关 = 实色兜底）；`@supports` 不支持时自动实色 |
| icon-press | 桌面图标、任务栏按钮、开始菜单磁贴等一切可按压件 | 零常驻：CSS transition，仅按压 150ms | 引入 `icon-press.css/js` + `data-demo="press"` 容器；开关 `data-demo-switch="press"`；`pressScale: 1` 也可关幅度 |
| stagger-enter | 进桌面后的桌面图标层 / 面板卡片首帧入场 | 一次性：n 个元素各 250ms 动画 + 60ms 间隔，播完摘 fill 归零 | 引入 `stagger-enter.css/js` + `data-demo="stagger"`；开关 `data-demo-switch="stagger"`（关 = 全部同帧到场）；重播按钮 `data-demo-replay` |
| cursor-glow | 桌面画布层（空白区），**不叠在窗口内容上** | 常驻 rAF 但收敛即停帧；一个 320px 合成层 | 引入 `cursor-glow.css/js` + `data-demo="glow"` 舞台；开关 `data-demo-switch="glow"`（关 = 停帧 + 淡出）；`opacity` 调 0 亦等效 |
| click-ripple | 全局按钮类（对话框按钮、菜单项等） | 每次点击一枚 span，播完 `animationend` 自清理 + 兜底超时清理 | 引入 `click-ripple.css/js` + 宿主标记 `data-ripple`；开关 `data-demo-switch="ripple"`；不给宿主加 `data-ripple` 即局部禁用 |

### 6.3 进阶炫技五项：适用位置 / 性能成本 / 启停

| 效果 | 适用位置 | 性能成本 | 如何启用 / 关闭 |
| --- | --- | --- | --- |
| parallax | 壁纸层（`WallpaperLayer`），只在桌面空白可见时参与 | 常驻 rAF 但每帧 ≤3 次 transform 写、收敛停帧；3 个合成层 | 每项独立：`parallax/parallax.js` 自动接管页面上 `[data-ml-parallax]` 根元素；`data-ml-enabled="false"` 初始关闭；运行期 `window.MLAdvanced.parallax.setEnabled(on)` |
| aurora | 壁纸层氛围层，**窗口打开多/低端机建议关** | 常驻 canvas：半分辨率 × dpr≤2 × 4 光斑 @ 30fps | `[data-ml-aurora]` + `data-ml-enabled`；`window.MLAdvanced.aurora.setEnabled(on)`；关 = CSS 淡出后清画布 |
| window-tilt | 窗口焦点切换（`WindowFrame` 层） | 零常驻循环：仅点击瞬间两次 getBoundingClientRect + 两个自定义属性写入 | `[data-ml-windows]` + `data-ml-enabled`；`window.MLAdvanced.windows.setEnabled(on)`；关 = CSS `is-off` 全亮平铺（150ms 过渡无跳变） |
| dock-sheen | 任务栏/Dock 玻璃底座 | 纯 CSS 常驻 keyframes（9s 一扫，静默期 76%） | `[data-ml-dock]` + `data-ml-enabled`；`window.MLAdvanced.dock.setEnabled(on)`；关 = `::after` 150ms 淡出，关键帧终止 |
| theme-glow | 壁纸深处主题色光斑 | 纯 CSS 常驻 keyframes（9s 呼吸，opacity+scale） | `[data-ml-theme-glow]` + `data-ml-enabled`；`window.MLAdvanced.glow.setEnabled(on)`；关 = 包罩 200ms 淡出后再停动画（杜绝中断跳变） |

**组合演示页**（`enhance-advanced/index.html`）把五个开关
（`checkbox[data-ml-toggle]` ↔ `window.MLAdvanced.*` 句柄）排在页面上，
初始态由各根元素的 `data-ml-enabled` 决定——**默认只开「视差 + 光晕」**
（组合页实测标记：parallax `true`、theme-glow `true`、aurora/window-tilt/dock-sheen
`false`），理由见 §6.4。主题切换按钮广播 `ml-theme-change` 事件供 canvas 类
效果重建精灵配色。全部效果句柄都暴露 `setEnabled(on)`，产品侧接入后可直接
对接设置项。

### 6.4 默认组合为什么是「视差 + 光晕」

- 两项都**只作用于壁纸层**，不碰窗口/任务栏内容，与 UI 渲染零争抢；
- parallax 收敛即停帧、theme-glow 是纯 CSS keyframes——静置时近乎零成本；
- aurora（常驻 canvas 绘制）与 window-tilt（改窗口层叠观感）属于「换机器/换场景再开」的档位，
  默认关闭以保证低端设备的桌面基础帧率。

---

## 7. 实现方式三档对比：纯 CSS / JS（rAF·WAAPI）/ WebGL

### 7.1 总体对比

| 维度 | 纯 CSS（transition/animation） | JS rAF / WAAPI | WebGL |
| --- | --- | --- | --- |
| 合成器接管 | ✅ 全程（主线程零占用） | rAF：主线程逐帧；WAAPI：✅ 合成器 | GPU 着色器，主线程最省 |
| 可中断/续动 | transition 天然可中断；animation 需手动处理 | rAF 从当前值续算（本实验室约定强制）；WAAPI `reverse()` 严格镜像 | 中断需自建状态机，成本高 |
| 几何锚定（读触发源位置） | ❌ 做不到 | ✅ 触发瞬间一次读取 | ✅ 但同样要先读 DOM |
| 自由指针 1:1 跟随 | ❌ 只有离散状态 | ✅ rAF 标配 | ✅ |
| 还原度上限 | 中（曲线/关键帧表达力内） | 高（任意数学曲线） | 最高（逐像素光照） |
| 常驻成本 | 常驻 keyframes 占合成层；一次性动画零 | rAF 循环需自律（收敛停帧/降帧） | 初始化、内存、纹理上传全最高 |
| 复杂度/可维护性 | 最低 | 中 | 高，且对 2D UI 绝大多数场景是浪费 |

### 7.2 按效果推荐默认档（含理由，与本实验室实际实现一致）

| 效果 | 推荐默认档 | 理由 |
| --- | --- | --- |
| boot 进度条 | **JS rAF** | 四段变速曲线（分段缓动 + 单调插值）CSS keyframes 表达不了；进度还要对外回调 |
| 窗口开合 / genie 飞行 | **JS WAAPI** | 需要把 transform-origin 投影到 Dock 图标（几何锚定）+ `anim.reverse()` 严格镜像 + 半途抓回；WAAPI 跑在合成器上，兼得 |
| Dock 放大波浪 | **JS rAF** | 高斯衰减 + 1:1 指针跟随 + 从当前值续动；纯 CSS 无法跟随自由指针 |
| 菜单淡入 / 通知三段 | **纯 CSS**（JS 只做定位与节点管理） | 定位层+动效层分离后，过渡全部合成器接管、天然可中断；CSS 完全够表达 |
| 毛玻璃面板 / materialize | **纯 CSS** | blur 档一次性切换 + 预置 keyframes 一次走完；零 JS |
| 图标按压 | **纯 CSS** | 150ms 微反馈，transition 天然可中断 |
| 错峰入场 | **纯 CSS**（JS 注入间隔变量 + 播完计数） | 一次性 keyframes；JS 只负责重播与落定 |
| 鼠标跟随光晕 | **JS rAF** | 平滑插值跟随 + 收敛停帧；CSS 做不到自由跟随 |
| 点击涟漪 | **纯 CSS**（JS 注入节点/变量） | 扩散是固定 keyframes；JS 只在点击瞬间算直径 |
| 壁纸视差 | **JS rAF** | 三层插值 + 归一化指针 + 缓退归零；纯 CSS 无法 1:1 跟随，WebGL 纯属浪费（模块头注结论一致） |
| 流光氛围 | **JS Canvas 2D（精灵烘焙）** | 交叠加色发光 CSS 还原度低、超大 blur 低端机瓶颈；WebGL 还原度最高但对缓慢氛围收益有限（模块头注结论一致） |
| 窗口切换 tilt | **JS 设方向 + CSS 合成动画** | 倾斜方向需要一次几何计算；动画本体交合成器，零常驻循环 |
| Dock 扫光 | **纯 CSS** | 9s 一次的扫光开 JS 常驻循环不值（空转耗电）；伪元素 + transform/opacity keyframes 零 JS |
| 主题光晕呼吸 | **纯 CSS** | 单 div 径向渐变 + keyframes；rAF/WebGL 均无必要 |

**一句话选型**：能用 CSS 表达的非连续动效一律 CSS（合成器接管，SPEC §3.3）；
需要几何锚定、自由跟随或任意曲线的才上 JS，且必须守 rAF 纪律；WebGL 只在本实验室
作为「档位上界」记录对比，不推荐用于 2D 系统动效。

---

## 8. 对接 AgehaOS 的集成指引

> 产品架构规则（`docs/ARCHITECTURE.md`）：`src/core/**` 零 React，依赖方向
> UI → store → core；样式只消费 `src/index.css` 设计 Token（`--ag-*`）；
> UI 文案走 i18n 词典（类型强制中英对齐）；新系统事件先扩展 `SystemEventMap`。
> 集成时把 `--ml-*` 数值归档进产品令牌：产品基线是 fast 120ms / base 200ms
> （`src/index.css:39-40`），实验室铁律 150~300ms，**迁移回产品时以产品性能实测
> 为准归档到 120/200ms 档**（`shared/tokens.css` 头注释原文约定）。
> 全局铁律：每次改动必须编写/更新对应测试，四门禁（typecheck / lint / test / build）全绿。

### 8.1 boot · `window.AgehaBoot` 对接现有 BootScreen

**现有实现**（`src/desktop/boot/BootScreen.tsx`）：`useBootStore` 的 `phase`
（booting → loading）驱动 `BOOT_STEP_MS = 800` 定时器逐步 `advance()`，随后
`finishBoot(sessionStatus === 'authenticated' ? 'ready' : 'login')`（BootScreen.tsx:8-28）。
这是**定时器分步**模型，不是进度模型。

**对接方案**（推荐 A，最小侵入）：

- **方案 A（接管进度）**：在 `BootScreen.tsx` 引入 boot 引擎（把 `boot/boot.js`
  的进度引擎提炼为 `src/desktop/boot/boot-motion.ts`——注意该文件在 `src/desktop/`
  而非 `src/core/`，因其操作 DOM；纯逻辑函数如 `bootCurve` 可放 `src/core/` 便于单测）：
  - `onBootProgress(pct)` → 用 `useRef` 直写进度条 `transform: scaleX(pct/100)`
    并同步 `aria-valuenow`（**绕过 React 状态**，60fps 进度不进渲染路径；只在
    100% 时 setState 一次触发 `finishBoot`）；
  - `onBootComplete()` → 现有 `finishBoot(sessionStatus === 'authenticated' ? 'ready' : 'login')`
    原样挪进来（会话判定逻辑不变），并给启动层挂退场类（淡出+放大 400ms）；
  - `skip()` → 绑定「点击/按任意键跳过」（产品当前无此能力，属新增交互，文案进 i18n 双词典）；
  - `data-boot="complete"` 直接服务 E2E：现 E2E 痛点是「开机动画是定时器驱动，
    networkidle 后立即查会假阴性，必须 waitForSelector」（HANDOFF 坑 46）——
    以后断言 `page.waitForSelector('[data-boot="complete"]')` 即确定开机完成；
  - Logo：复用现有 `src/components/brand-logo` 的 `BrandLogo`，替换演示模块的
    `<img>` 回退链（产品内资产路径确定，无需回退）。
  - 测试：`BootScreen.test.tsx` 增补——fake timers 下 `advanceTimersByTime` 推进
    后断言进度回调序列单调不减、`finishBoot` 恰好一次（HANDOFF 坑 10：用
    `act(() => vi.advanceTimersByTime(ms))`，勿混 RTL waitFor）。
- **方案 B（保留定时器，只搬视觉）**：进度条仍由现有 phase 驱动，仅把 boot.css
  的视觉（纯黑层、细长条、退场 materialize）搬进 BootScreen 的 className。
  改动最小，但丢掉四段变速与 skip 能力。

**时长归档**：3.8s 总时长在产品里建议压到 2.5~3s（真实 VFS/会话初始化远快于演示），
`AgehaBootConfig` 覆写机制保留（联调/测试用）。

### 8.2 window · 窗口生命周期动效

**现有实现**：`src/desktop/window/WindowFrame.tsx`（窗口壳 + 标题栏 + 红绿灯，
`swallowPointerDown` 防指针穿透）、`src/desktop/window/WindowLayer.tsx`（窗口层，
独立层叠上下文 z-30）、`src/store/window-store.ts`（`open/minimize/restore/close`
等动作，底层是 window 引擎）。

**挂载建议**：

- 打开/关闭动效挂 **`WindowFrame.tsx`**：监听自身窗口 `state` 变化（closed→open /
  open→closed），在 effect 中对根元素播 WAAPI（`scale 0.9→1 + fade`，
  `transform-origin` 由 §8.3 的任务栏按钮坐标投影而来）；关闭时长取打开的 0.75 倍
  （200/150ms → 产品归档 120/120ms 档也可，但保持「关 ≤ 开」关系）。
- 最小化/还原（genie）挂 **`WindowFrame.tsx` + `window-store.ts`**：`minimize`/
  `restore` 动作发出前，先读目标任务栏按钮的 `getBoundingClientRect()` 计算位移
  三关键帧；还原用 `anim.reverse()`。注意 HANDOFF 坑 40——WindowLayer 容器是
  `pointer-events-none`，动画层不改变这一结构。
- 中断语义：产品窗口管理器已支持操作排队，WAAPI 的 `reverse()`/快进落定
  （`applyEndState` 模式）可直接移植，勿在过渡期锁 store。
- 测试：`WindowFrame.test.tsx` 增补 jsdom 下「状态变化 → 终态类正确」（jsdom 无
  WAAPI，需 guard：`el.animate` 不存在时直接落定——这也顺便覆盖了老浏览器）。

### 8.3 dock · 放大波浪 → 任务栏/启动器

**现有实现**：`src/desktop/taskbar/Taskbar.tsx`（任务栏主体，自动隐藏 300ms 滑入
/400ms 收起）、`src/desktop/taskbar/AppLauncher.tsx`（开始菜单/图标行）、
`src/desktop/taskbar/WindowPreview.tsx`（悬停预览小窗）。

**挂载建议**：

- 产品任务是**图标任务栏**而非 macOS Dock——波浪建议先挂在
  **`AppLauncher.tsx` 的图标行**（或任务栏图标区）：rAF 引擎原样移植
  （`pointerenter` 一次性实测缓存 + 事件只记坐标 + 帧内只写 transform）；
  `falloffRadius` 需按产品图标间距重调（建议 ≤ 1.2×间距，见 PARAMS 注释）。
- 窗口动效的「来源锚定」数据源也在这里：打开/最小化时读对应任务栏按钮的
  屏幕坐标喂给 §8.2 的 WAAPI 关键帧。注意自动隐藏任务栏的契约（HANDOFF 坑 42）：
  唤出/收起用 `data-state` 断言，波浪引擎不得干扰 `pointerenter/leave` 链。
- 激活点 pulse（2.4s 低频）如迁入产品需走 DESIGN.md §2.5 的循环动画豁免评审。

### 8.4 menu-toast · 菜单与通知

**现有实现**：菜单类弹层有 `src/desktop/taskbar/AppLauncher.tsx`（开始菜单）、
`src/desktop/taskbar/UserMenu.tsx`（用户菜单）、`src/desktop/search/SearchPalette.tsx`
（Ctrl+K 面板）；通知是 `src/desktop/NotificationToasts.tsx`（toast 渲染组件，
渲染期比较 prev props 的官方模式）+ `src/desktop/taskbar/NotificationCenter.tsx`
（通知中心）+ `src/store/notification-store.ts`（`push()` API）。

**挂载建议**：

- **菜单浮入动效**：开始菜单主体用「淡入 + 上浮 4px」150~200ms 档挂
  `AppLauncher.tsx`；UserMenu / SearchPalette 同款类名复用（一套动效语言）。
  定位层+动效层双层架构照搬：React 里对应「外层定位容器（无 transition）+
  内层动效容器（transition）」两个 div，出动画时勿卸载节点再重建。
  现有 `transform` 已被用于摆位的浮层，注意把动效放在内层，避免 transform 冲突。
- **右键上下文菜单**：产品目前**没有**上下文菜单（全仓库 `onContextMenu` 零命中，
  本次核实）——属新增能力：建议新建 `src/desktop/ContextMenu.tsx`，挂
  `Desktop.tsx` 的 `onContextMenu`（`preventDefault` + 指针坐标 + 视口收拢），
  菜单内容按 PRD 另行定义；动效直接复用本模块。
- **通知**：`NotificationToasts.tsx` 接「滑入 250ms → 驻留（hover 暂停）→ 滑出
  200ms + 腾位上移」：堆叠位移用 `transform: translateY`（现有实现按列渲染，
  移植时保持固定宽度卡片以保证高度缓存有效）；hover 暂停驻留计时用
  `performance.now()` 差值法（本模块 `armDwell/pauseDwell/resumeDwell` 原样可搬）。
  注意 HANDOFF 坑 4：effect 内不得同步 setState，计时器清理遵循现有
  NotificationToasts 的模式。
- SDK 侧通知（`public/sdk/ageha-sdk.js` 的 notification API）经
  `notification-store.push()` 汇入同一渲染路径，动效自动生效，无需改动。

### 8.5 增强效果（basic / advanced）挂载与开关

| 效果 | 挂载组件（已核实存在） | 开关建议 |
| --- | --- | --- |
| glass-panel | `Taskbar.tsx`、`AppLauncher.tsx`、`NotificationCenter.tsx`（玻璃归 chrome） | 默认开；`prefers-reduced-transparency` 已在令牌层自动实色兜底 |
| icon-press | `DesktopIcons.tsx`、`Taskbar.tsx` 按钮区 | 默认开（零成本） |
| stagger-enter | `Desktop.tsx` 进桌面首帧 → `DesktopIcons.tsx` 图标错峰 | 默认开；仅首登录/进桌面播一次，会话内重进不重播 |
| cursor-glow | `Desktop.tsx` 桌面空白画布层 | **默认关或低端机自动关**（常驻 rAF + 合成层）；设置项挂 `settings-store.ts` |
| click-ripple | 全局按钮（含 `src/components/PermissionConsentDialog.tsx` 等） | 默认开；触屏设备可关（有原生触感） |
| parallax + theme-glow | `src/desktop/wallpaper/WallpaperLayer.tsx`（三层位移挂壁纸容器；光晕挂氛围层；**照片壁纸模式下光晕建议关**——照片上叠大光斑会显脏） | 默认开（与实验室组合页默认一致）；设置项进 Settings 外观分区（产品 Settings 默认分区即外观） |
| aurora | `WallpaperLayer.tsx` 氛围层（canvas） | 默认关；低端机探测（如 `navigator.hardwareConcurrency` ≤4）强制关 |
| window-tilt | `WindowFrame.tsx` 焦点切换 | 默认关；与 §8.2 的窗口动效二选一或降参共存（避免同屏两套窗口动效） |
| dock-sheen | `Taskbar.tsx` 底座 | 默认关；仅深色壁纸/深色主题下开（浅色下白高光存在感弱） |

**React 接入方式**：各效果 JS 是「根元素存在即接管」的自初始化模式——在组件
`useEffect` 里给容器加 `data-*` 根属性并动态 `import()` 对应引擎，或提炼为
hook（如 `useMotionEffect('parallax', enabled)`）；开关状态走
`settings-store.ts`（记得提供 reset 函数，HANDOFF 架构规则）。
**禁止**把演示模块的 CSS 直接铺进产品全局——先按 §8 开头的令牌归档约定把
`--ml-*` 并入 `src/index.css` 的 `--ag-*` 体系。

### 8.6 验收与回归

- 每次集成改动配套测试（全局铁律）：引擎纯函数（曲线/衰减/分段进度）进 Vitest
  单测；组件行为进既有 `*.test.tsx`；四门禁 + `npm run test:e2e` 全绿后再交付。
- E2E 断言动效终态而非中间态：用 `data-boot="complete"`、`aria-pressed`、
  `data-state` 等钩子（HANDOFF 坑 42/46），勿断言 transform 中间值。

---

## 9. 验证与验收

**浏览器冒烟**（本目录自带）：

```bash
node motion-lab/verify.mjs
```

- 以 `file://` 在 Chromium headless 打开 motion-lab 下**全部 12 个页面**
  （演示中心 + 6 模块组合页 + 5 个进阶单项页）；
- 每页断言**零 `console.error` / 零 `pageerror`**；
- 关键行为断言：boot 6 秒内出现 `data-boot="complete"` 且 `window.AgehaBoot`
  三方法存在；dock 合成指针进入+移动后某图标 `style.transform` 变化；
  menu-toast 触发后菜单可见（另发一条通知冒烟）；window 点开按钮后打开的
  窗口数量增加且新窗口元素在场；
- 全过输出 PASS 清单退出 0；失败输出逐条清单退出 1。
- 最近一次运行结果：**12/12 页通过（结果：PASS）**。

**模块自带测试**：`boot/boot.test.mjs`（Vitest）、`dock/dock.test.mjs`（纯函数）、
`menu-toast/check.mjs`、`enhance-basic/tests/`（静态验收 19 + jsdom 37 项）、
`enhance-advanced/tests/`（静态验收 98 + Playwright 冒烟 31 项）。

**提交前自查**：逐条过 `SPEC.md` §6 验收清单（三文件齐备 / 时长档 / 只动
transform-opacity / rAF 纪律 / PARAMS / 降级 / ml-dark / 中文注释）。
