# 更新日志

本文件遵循 Keep a Changelog 风格，版本号遵循语义化版本。

## [Unreleased]

### UI 全面视觉升级 Slice 1：Design Token 2.0 + 深色默认基线（ADR 24）

- **Token 2.0 扩展（不推翻 v1）**：`src/index.css` 新增 v2 语义层——surface 层级（soft/elevated/popover/modal）、text-tertiary/disabled、border-subtle/strong、brand 语义别名、accent 五色族（数据/徽章专用）、`--ag-info`、阴影五档（soft/panel/popover/modal + 既有 window/window-flat）、blur 三档（12/20/28px）、scrim/scrim-strong、radius 升档（sm8/md12/lg16/xl20/pill）、menubar/dock 几何契约值（pitch 48 = 波浪 σ44 前提）；v1 名（surface-raised/brand 等）保留为别名，新代码用 v2 名
- **玻璃材质按视觉权威图重调**：浅 `rgb(255 255 255/72%)`、深 `rgb(16 23 40/66%)`、blur 24→28px；`.surface-glass` 实色回退改挂 `--ag-surface-popover`
- **默认主题 `light → dark`**（贴合权威图暗曙光彩；存量已保存偏好一律不动，含 light——单测钉住）；壁纸引擎沿用 gradient-field 10 构图不新增
- **桌面图标标签收编主题 Token**：原硬编码白字 + 深投影在浅色池壁纸上实测 3.3:1 不可读，新 `.desktop-icon-label`（`--ag-desktop-label/-shadow` 双主题），修复后浅色 10.7:1+（visual-judge 复审判定）
- **测试**：新增 `src/index.css.test.ts` Token 契约（v2 层级双主题存在性、别名关系、radius 刻度、@theme 映射、玻璃回退、桌面标签主题化）；settings-store +1（存量 light 偏好首载保留）+ 默认值断言更新 ×3 处；前端 95 文件全绿 + 80 后端；E2E 13/13；双主题 6 截图过 visual-judge（暗色 4/4、浅色修复后通过；动态面板滚动折叠线裁切经 git HEAD 复现确认非本片回归，记录 DESIGN.md §17 遗留）

### Files 上传入口：本机文件 → 二进制落盘（Phase 3 第一片 UI 面）

- 工具栏新增「上传文件」（回收站视图隐藏）：隐藏 `<input type="file">` → `writeFileBytes` 落入当前目录，事件驱动刷新（其他窗口即时可见）；input 值每次选择后清空，允许连续重选同一文件
- 防护：同名**先行拒绝**（走既有 `already-exists` 文案——`writeFileBytes` 是创建或覆盖语义，绝不静默覆盖既有文件）；超 8MB 在读取前拦截（免无谓内存复制，不落半成品）
- 测试：FileManager +4（上传字节落盘+input 清空 / 同名拒绝且原文件不动 / 超限先拦截 / 回收站无入口）（782 前端，93 文件）+ 80 后端；E2E 13/13；浏览器烟雾 5/5（真上传 logo PNG → VFS 字节核对（PNG 魔数）→ 同名再传被拒 → reload 经 IndexedDB 仍在 → 双击预览报 is-binary 文案）

### VFS 二进制承载：bytes 双字段直存 IndexedDB（Phase 3 第一片，ADR 23）

- **能力层交付**：`VfsNode.bytes?: Uint8Array` 与 `content` 互斥（二进制节点 content 恒 ''、size 恒为字节长度），经既有 IdbAdapter **结构化克隆**原生持久化——DDS Phase C 原计划的 OPFS 适配器与 base64 文本承载路线均改判出局（ADR 23：第二存储域/37% 膨胀，在全量快照模型下收益为负）
- API：`writeFileBytes`（≤`MAX_FILE_BYTES` 8MB，超限抛 `payload-too-large` 且不留半成品）/ `readFileBytes`（统一字节视图：文本经 UTF-8 编码、二进制返回存储字节，一律隔离副本）；`readFile` 对二进制抛 **`is-binary`** 响亮失败而非返回乱码；文本↔二进制相互覆盖由互斥不变量保证；`copy` 产生独立缓冲
- 错误映射：`is-binary`/`payload-too-large` 进 `vfsErrorMessageKey` → 双语文案（Files 预览二进制即见「二进制文件无法以文本形式打开」）
- **云同步快照跳过二进制**（设备本地语义；对象存储切片为 Phase 3 第二片，届时树中只携带哈希/键）
- 测试：VFS +7（往返/互斥/is-binary/超限/覆盖翻转/独立副本/按名搜索）+ IDB 二进制持久化 + file-sync 排除断言（778 前端，93 文件）+ 80 后端；E2E 13/13；浏览器烟雾 8/8（dev 动态 import systemVfs：写读往返 → reload 后**真 IndexedDB** 字节完好 → Files 列表可见 + 双击预览报错文案）

### 举报样本上传：用户同意框 + 服务端分类器 + 匿名复审端点（DDS §8.6 收尾，ADR 22）

- **举报流程补全后两环**（前两环「立即撤下 + 会话 banlist」已于 Phase C 落地）：举报自由文本后弹共享 `ConfirmDialog` 显式同意框（铁律 4/10），同意才上传；取消仅本机撤下、零请求
- **匿名端点** `POST /api/dynamic/samples`：无需登录、不携带任何用户/会话标识（举报者身份不出本地，§8.5）；限流 10/min/IP + 512 字符上限；`GET /api/dynamic/samples` 复审清单仅 admin（与 ADR 20 共用提取出的 `requireAdmin` 门）
- **内容复审 UI（admin 尾巴，2026-09-29 交付）**：设置新增 admin-only「内容复审」分区（`SampleReviewSection`，与「远程目录」并列入侧栏）——样本清单（新样本在前）+ 分类徽标（正常/误导/不适，语义 Token 配色）+ 等宽时间戳 + 计数插值 + 手动刷新；列表走 `ScrollFadeList`（§3 规范）；**删除处置同日交付**：逐行删除按钮 + `DELETE /api/dynamic/samples/:id`（仅 admin，404 幂等边界，审计只记 sampleId），失败行保留 + 行内告警；完整应用审核面留待 §47
- **服务端分类器先行**（Phase B「分类器服务端化」前置落地）：`server/src/classifier.ts` 三类口径与客户端离线兜底同口径、独立演化；`violation` 422 且**不落库**（违规内容本体不入任何存储），`misleading`/`discomfort`/`ok` 落库供复审
- **存储三驱动同扩**：`ContentSampleRecord` + `createContentSample/listContentSamples`；postgres 新表 `ageha_content_samples`（幂等迁移）、file 存储序列化 `samples` 字段、容量 500 淘汰最旧；纯本地模式无服务端，保持纯本机撤下；上传失败经通知中心透明告知
- 测试：分类器 8 项 + 样本路由 9 项（含删除三流路）+ 存储契约/pg SQL 形状扩充（80 后端）+ ConfirmDialog 4 项 + 面板同意框流路 3 项 + 复审分区 7 项（含删除两流路）+ Settings admin 门（769 前端，93 文件）；E2E 13/13；浏览器烟雾 8/8 + 7/7 + 5/5（远程模式真后端：注册→深度增强→LLM 桩自由文本→举报→同意→**真实落库核对**→取消零请求；admin UI 复审列表/徽标/计数/刷新/普通用户无入口；**UI 删除 → 服务端核对已删 → 重复删除 404 → 普通用户 DELETE 403**；真实服务端 violation 422/misleading 201 实测）
- 文档：API.md 两端点 + DDS §8.6 交付状态 + ADR 21（Redis 共享限流，补记）+ ADR 22（本裁决）

### 生成式壁纸 gradient-field：macOS 风分层色场，照片域退役（docs/DESIGN.md §16）

- 用户裁决（2026-09-27，grilling）：「不要风景图了，参照 macOS 自行设计与现有主题相关的壁纸」——推翻 2026-09-24「要真实风景照」；诊断共识：原「不搭」根因是色相冲突与高饱和而非题材
- 新引擎 `gradient-field.ts`：10 款固定构图（5 亮 5 暗，晨白/青屿/紫岚/樱曙/琥晓 + 夜幕/极光/绯暮/紫曜/琥珀夜，用户目视裁决全保留）+ seed 微变体（曲线相位/倾斜/振幅），「换一张」主结构恒定永不翻车；决策引擎/质量门/安全过滤/内容卡/面板全链路切到 field 域
- **照片域整体移除**：目录 + 测试 + 16 张图 + CREDITS + 渲染分支 + i18n + recentPhotoIds 管线（改 recentFieldIds）；上轮拍板的协调层（scrim/降饱和）随照片取消——生成即同语系；AI 生成徽标按裁决移除（面板归属行保留）
- 沿用：轮换档位/换一张节流/反馈回路/交叉淡入/默认开/视差光晕设置；视差改挂生成 canvas
- **池子扩充（2026-09-28）**：用户从预览工作台 8 款候选全保留——亮池 +翡翠/蜜桃/冰川/盐青、暗池 +翡翠夜/酒红夜/石墨/铜夜，至 **9 亮 + 9 暗**（FIELD_ENGINE_VERSION 2）；池深 > recentFieldIds 缓冲（6）后防重复机制才真正生效；生产实测 6 次换一张出 5 个不同构图
- 测试：gradient-field 6 项新增 + decision/safety/gate/store/WallpaperLayer/Desktop 六套重写；754 前端（91 文件）+ 58 后端 + E2E 13/13 全绿；浏览器目检（紫岚上屏）+ 已部署生产并实测

### 桌面右键上下文菜单（docs/DESIGN.md §14 遗留项落地）

- 空白画布右键弹出（目标判定与涟漪同源：画布根或壁纸层）；指针位置 + 视口边缘收拢 8px（layout effect 实测尺寸 pre-paint 钳制，无闪烁）；动效复用 §14 弹层语言（os-pop-in 进 / 120ms 退场 / 重开中断续动）
- 菜单项：更换壁纸（`systemDynamicDesktop.refresh()`，5s 节流在服务侧）/ 打开应用商店 / 打开设置；关闭语义 = 项点击 / Esc / 菜单外按下（capture）/ 视口尺寸变化；窗口与图标上不出菜单（元素级菜单留待后续）
- 测试：ContextMenu 7 项（定位/视口收拢原型尺寸 mock/三种关闭/三动作/重开周期）+ E2E context-menu.spec（收拢断言 + 动作 + Esc）；756 前端（91 文件）+ 58 后端 + E2E 13/13 全绿；已部署生产并过隧道实测（菜单弹出收拢 + 动作关闭）

### motion-lab 增强档接入：壁纸视差/图标错峰/点击涟漪/指针光晕（docs/DESIGN.md §15）

- **壁纸指针视差**（默认开，设置 → 外观可关）：照片单层平面化 ±22px（纵向 ×0.55、反向、lerp 0.085、epsilon 收敛停帧）+ scale 1.03 掩边；仅照片计划激活层参与，交叉淡入下层不错位（`use-wallpaper-parallax.ts`）
- **桌面图标错峰入场**（默认开，每页面会话一次）：250ms 上浮 14px 淡入 + 60ms 错峰；模块级标记防会话内重播
- **点击涟漪**（默认开）：仅桌面空白画布与壁纸层；直径按点击点到最远角 ×1.15（上限 720px），300ms 扩散 animationend 自清理 + 兜底；reduced 不注入
- **指针跟随光晕**（默认关 + 设置项）：320px 主题色光斑（浅 multiply/深 screen）、平滑 0.18、收敛停帧、进出淡入淡出；z-5 压壁纸垫窗口、pointer-events-none；移动兜底点亮（桌面内跨元素移动不触发 pointerenter）
- 开关走新增 `motion-prefs-store`（设备本地 localStorage，不进同步）；裁定不接入：glass-panel/icon-press（产品已有等价）、theme-glow（照片上显脏无挂载面）、aurora/dock-sheen（默认关缓办）、window-tilt（与 §12 二选一）
- 测试：新增 motion-engines 9 项（视差插值/收敛停帧/指针离开归零/降级、光晕点亮与清理、涟漪注入与自清理/子元素豁免/reduced 惰性）；749 前端（90 文件）+ 58 后端 + E2E 12/12 全绿；浏览器烟雾 9/9（错峰 7/7 图标、涟漪自清理、视差矩阵、开关持久化、光斑点亮）

### motion-lab 菜单/通知动效接入 AgehaOS 本体（docs/DESIGN.md §14）

- 弹层统一动效语言：进场保留 `animate-os-pop-in`（200ms），新增 120ms 退场（`--ag-motion-ease-in` 新令牌，关闭恒不长于打开）；`useExitPhase` 退场相位——open 翻 false 后节点多存活 120ms 播完过渡，重开即中断续动；接线开始菜单（双形态）/用户菜单/通知中心面板/Ctrl+K 搜索面板（含遮罩淡出）；无 WAAPI 运行时（jsdom）保持旧即时卸载语义
- 通知三段节奏重写（NotificationToasts）：右上滑入 200ms（translateX 24px 过冲 + 淡入）→ 驻留（normal 4.5s/critical 8s，hover 暂停、离开续走剩余时间，performance.now 差值法）→ 滑出 120ms；**栈 ≤3 条**（原只显示最新一条，按演示形态放开）：最新 3 条可见、第 4 条排队等位，槽位固定宽度 + 实测高度 translateY 排布，腾位上移与滑出并行；点击 = 已读 + 滑出
- 测试：新增 pop-motion 7 项（退场相位/中断续动/双降级）+ NotificationToasts 4 项重写（TTL 退场相位/hover 暂停/堆叠排队/点击退出）；740 前端（89 文件）+ 58 后端 + E2E 12/12 全绿；浏览器烟雾 8/8（退场中 opacity 渐隐、重开恢复、hover 暂停 6.5s 仍在）

### motion-lab Dock 波浪接入 + 窗口关闭 ghost 化（docs/DESIGN.md §13、§12 修订）

- 任务栏窗口按钮图标接入高斯距离衰减放大波浪（motion-lab/dock）：波峰 1.5× + 3px 上浮、σ 44px（≤1.2× 图标间距）、enter 120ms/settle 200ms 归档到产品档；纯数学 `src/core/dock/wave.ts`（cubic-bezier 同语义求值 + 高斯波形）+ rAF 引擎 `use-dock-wave.ts`（事件只记坐标、帧内零布局读取、**收敛停帧**——悬停静止即停表省帧，pointermove 唤醒）；触屏与 reduced-motion 不启动，仅悬停变色/原生按压保留；激活点 pulse 不迁入（任务栏已有静态下划线，循环动画需豁免评审）
- 任务栏图标行 `self-stretch` 抬高 `overflow-x-auto` 隐式裁剪盒到 48px，波浪不出框；波浪只写 `[data-wave-icon]` 包裹层 transform，自动隐藏 reveal/hide 链不受影响（E2E 固化）
- **根除一处真实竞态（sdk-fs-note E2E 素因 + 产品缺陷）**：窗口关闭原「退场飞完才提交 store.close」让将死窗口在 store 里多活 120ms，期间紧随的重开点击会撞可达树（strict-mode/旧 iframe 错配，~50% 复现）。改为 **store 立即提交 + ghost 快照续播退场**（`closing-ghosts.ts`：同 key 组件实例与 DOM 存活、内容连续；aria-hidden + pointer-events-none；飞完即卸载 + 600ms 兜底）。另修 WindowLayer 改按 id 稳定序渲染（z 序本来由 zIndex 样式决定，focus 提交不再 insertBefore 移动节点打断点击事件序列）与退场即 `pointer-events:none`（垂死窗口不再吃掉指向下层 UI 的点击）
- 测试：新增 wave 9 项 + use-dock-wave 7 项（mock 几何 + fake-rAF 确定性驱动）；WindowFrame 关闭语义测试重写（即时提交/ghost 可达树隔离/重开唯一可寻址）+ window-motion 修订；731 前端（88 文件）+ 58 后端 + E2E 12/12 全绿（sdk-fs-note 连跑 6 次稳定）；浏览器烟雾 9/9（波峰矩阵 1.5×、收敛清空、autohide 链、genie 回归）

### motion-lab 窗口动效接入 AgehaOS 本体（docs/DESIGN.md §12）

- 窗口打开从任务栏按钮方向弹性长出（scale 0.9→1 + fade，200ms 弹簧曲线）；关闭沿同一路径反向收拢（120ms，恒短于打开，**飞完才提交卸载**）；genie 最小化/还原沿「窗口中心 → 任务栏按钮」位移三关键帧飞行（300ms，横缩纵压 + 先坠后收弧线），还原 = 同一组关键帧 `anim.reverse()` 时间镜像
- 架构：纯数学 `src/core/window/motion.ts`（锚定投影限幅/三关键帧/常量，零 DOM）+ DOM 层 `src/desktop/window/window-motion.ts`（任务栏锚点钳制、WAAPI/reduced-motion 降级返回 null 直落定）+ 编排 `use-window-motion.ts`（track/reverseTo/settleActive）
- 中断语义移植：最小化↔还原（及打开↔关闭）飞行中点反操作走 `anim.reverse()` 半途抓回；交叉中断先落定再继续；任何时刻不锁 store——窗口状态由 store 先行提交，最小化飞行可见性用 inline display 反压 React `hidden` 类（落定交还）
- 测试：新增 motion 9 项 + window-motion 8 项 + WindowFrame WAAPI 路径 6 项（可控替身驱动 finished/reverse），既有降级路径用例全保留；710 前端（86 文件）+ 58 后端 + E2E 12/12 全绿；浏览器烟雾 10/10（getAnimations 证据 + genie 中途矩阵 + 截图）

### motion-lab 开机动画接入 AgehaOS 本体（docs/DESIGN.md §11）

- `BootScreen` 由 motion-lab/boot 引擎驱动（用户验收的演示 1:1 落地）：rAF 四段变速进度（分段缓动纯曲线入 `src/core/boot/boot-curve.ts`）、深色揭示画布（`--ag-boot-*` 主题无关 token）+ 全尺寸含字标 logo（96px，v2-full-512，`BrandLogo` 新增 full 变体）+ 细长进度条（scaleX 合成层推进，整数百分比同步 aria）
- 完成即按会话状态落桌面/登录：目的界面先挂载下层，开机层退场（淡出+放大 400ms 豁免档 `--ag-motion-boot`）后由 App 卸载（`boot-store.layerExitDone`）；进度直写 transform 绕过 React 渲染路径，状态文案/完成判定经 `store.getState()` 免陈旧闭包
- 新增交互与钩子：点击/任意键跳过（幂等，i18n `boot.progress`/`boot.skipHint` 双词典）；E2E 完成钩子 `data-boot="complete"`；`window.AgehaBootConfig` 联调覆写保留（钳制 1000~10000/150~5000）；reduced-motion 下进度照常、退场直接切换
- 时长归档 2.2s（实验室 3.8s → 产品压缩；PRD §29.1「3s 内恢复可交互桌面」含加载时间，需求优先，测试钉扎）；`revealTaskbar` 先等开机覆盖层卸载（退场中覆盖层吞指针，静止指针不再触发 hover 链）
- 测试：新增 `boot-curve` 9 项 + `boot-motion` 14 项（手动帧驱动注入 rAF）+ BootScreen 重写 8 项 + App 3 项重写 + brand-logo/boot-store 增补；685 前端 + 58 后端 + E2E 12/12 全绿；浏览器烟雾 8/8（开机层视觉/进度推进/完成钩子/退场露出/skip）

### 品牌 logo v2：全系统换装透明底揚羽蝶主视觉（用户裁决）

- 用户提供 v2 成品插画（同主视觉重构图：纯黑底 + 渐变字标）；黑底经边界泛洪转为透明（延续白底透明化的用户裁决，图片仅缩放裁切）
- 双资产策略：`v2-full-512`（图形+字标，开机动画用，黑底上完整亮相）/ `v2-mark-*`（纯图形方形稿，字标分离点按「不透明像素最少行」自动检测——18px 小尺寸下字标不可辨）
- 换装范围：BrandLogo 四站点（开机 72/登录 56/开始按钮 18/设置关于 40·14）+ favicon 三档（64/192/180）；motion-lab boot 演示与回退链、boot 测试断言、README 参数表同步；v1 全部资产退役删除（v2 母版入库为权威源）
- 门禁：656 前端 + boot 套件 16 + 浏览器 verify 12/12 + E2E 12/12 全绿；生产站部署并截图验收

### 品牌 logo 全面替换为用户提供的揚羽蝶主视觉（docs/DESIGN.md §10）

- 用户成品插画（玻璃蝶 + 桌面窗景 + AgehaOS 字标，1254²）入库为唯一权威源 `agehaos-logo-master.png`；**铁律：图片只缩放裁切、不做任何像素修改**——像素级检测出方块本体 `(100,100,1054,1059)` 后等比缩放生成 512/256/192/180/64 五档资产
- `BrandLogo` 组件（img + CSS `rounded-[24%] object-cover`）替换 `AgehaMark` 全部四个用点（开机 72/登录 56/开始按钮 18/设置关于 40·侧栏 14）；圆角贴合走展示层，源图不动
- favicon/apple-touch-icon 全部改指新 logo PNG（64 为标签页主力尺寸）；旧 AgehaMark 组件与 SVG/PNG 资产退役删除
- 测试：BrandLogo 组件套件（资产路径/尺寸/圆角贴合/装饰与可访问模式）；套件 656+58、E2E 12/12 绿

### AgehaOS 品牌标：几何化揚羽蝶（docs/DESIGN.md §10）

- **Ageha（揚羽）即凤蝶**：白色棱角燕尾蝶（前翅后掠 + 后翅外伸尾突）落在钴蓝渐变圆角底上，与应用徽章同族几何（24% 圆角、150° 渐变）
- 资产：master SVG（`public/brand/agehaos-mark.svg`）+ Chromium 渲染 PNG（512/192/180，透明圆角）；favicon / PNG 回退 / apple-touch-icon / theme-color 全部接线（此前无 favicon）
- 界面内 `AgehaMark` 组件替换 🦋 emoji 的全部四个用点（开机屏 72、登录屏 56、开始按钮 18、设置关于 40 + 侧栏 14）——emoji 品牌豁免条款由真实品牌标接替
- 测试：组件套件（几何/渐变/装饰与可访问模式）；套件 656+58、E2E 12/12 绿

### 修复：刷新页面后壁纸丢失（os.ageha.cn 用户报告）

- **根因**：远程模式刷新页面时会话经 `reconcile()`（Cookie → `/api/auth/session`）恢复，它把用户写回 store 但从不广播 `user.login`——壁纸生成与文件同步的登录拉取都订阅该事件，于是每次刷新都落在裸渐变桌面上；动态桌面的冷启动兜底也救不了（session store 在远程认证 provider 装配前初始化，启动时读到的恢复用户恒为 null）
- **修复**：`reconcile` 在「匿名 → 已认证」转变时补广播一次 `user.login`（与登录/注册同语义）；已认证态的重复 reconcile 保持静默，本地恢复路径不会把登录钩子跑两遍
- 新用户注册路径此前已由 174174d 覆盖（注册即有壁纸）；本次修复后**刷新同样恢复壁纸与同步拉取**。测试：广播恰一次 + 已认证不重复广播；套件 654+58、E2E 12/12 绿；远程模式演练验证注册/刷新两条路径壁纸均在

### 四个小游戏应用 + 每次进桌面轮换打开（2026-09-26 用户裁决）

- 新增 4 个 Type B 沙箱小游戏（零权限、单目录 HTML/CSS/JS，AgehaOS Games）：**贪吃蛇**（canvas 街机，方向键/WASD，禁 180° 掉头，得分/最高分）、**2048**（4×4 合并，键盘+屏上方向键，冷色数字梯度）、**记忆翻牌**（4×4 配对，彩色数字对，步数统计）、**扫雷**（9×9/10 雷，首击安全 + BFS 洪泛 + 右键插旗）
- 全部进商店目录（AgehaOS Games 作者）→ 有专属精选徽章（Joystick/GridFour/Brain/Bomb × 各异冷色渐变）→ 安装后自动上桌面 → 卸载即消失
- **进桌面轮换**：`game-rotation.ts`——已安装游戏里随机打开一个且与上次不同（`pickGameId` 纯函数 + 注入 rng，上次选择持久化 localStorage），窗口居中弹出；未安装任何游戏则静默跳过
- 测试：轮换纯函数（排除上次/唯一候选/rng 映射/空集）+ openRandomGame 集成（安装→打开→记录→不重复）+ Desktop 自动开游戏 + 商店 8 条目覆盖；商店滚动渐隐 E2E 适配（8 条目默认尺寸即溢出）；套件 653+58、E2E 12/12 绿

### 全应用徽章覆盖 + 商店安装应用上桌面（docs/DESIGN.md §8，用户裁决）

- 徽章系统三层来源：精选（内置 7 + 商店样本 5 手工配色）→ 确定性生成（未知应用按 appId djb2 哈希选「12 冷色色板 × 10 中性字形」组合，同一应用恒同一徽章，未来任何新应用零人工获得设计图标，精选始终优先）
- 商店列表弃用遗留线形图标映射，与桌面/任务栏统一渲染 AppIcon 徽章（36px）
- 桌面图标层动态化：内置固定顺序常驻 + 商店安装的应用（含远程目录发布）自动追加，卸载即从桌面消失；名称回退 manifest name
- 测试：新增徽章套件（精选覆盖/确定性/分布度/精选优先）、桌面安装-卸载生命周期（act 包裹 zustand 写入）、商店徽章渲染、app-store E2E 断言安装后桌面出现时钟图标；套件 645+58、E2E 12/12 绿

### 动态面板默认开启：进桌面自动打开（2026-09-26 用户裁决）

- 登录进入桌面后动态面板自动打开一次（停靠桌面右侧、避开左侧图标列；`launchApp` 新增可选几何参数），已打开不重复，StrictMode 双挂载有 ref 防护；用户关闭后本会话不再弹出，刷新/重登录重新出现
- E2E 适配：面板的「应用到开始菜单」按钮会撞 `/开始/` 正则——开始按钮定位统一收敛为任务栏作用域（`helpers#taskbarStartButton`）；两处无作用域「关闭窗口」点击限定到各自窗口区域；dynamic-panel spec 重写为直接验证自动打开行为（右半停靠 + 卡片 + AI 归因 + 刷新）。套件 639+58、E2E 12/12 绿

### 修复：远程认证模式下登录钩子失效（壁纸/同步不触发）+ 照片壁纸默认开启（os.ageha.cn 部署反馈）

- **根因**：`user.login`/`user.logout` 事件只有本地 `AuthService` 会广播，`RemoteAuthClient` 从不发——远程模式（生产站）下动态桌面与文件同步的登录钩子全部失效：新账号壁纸从不生成（除非整页刷新撞上冷启动恢复路径）、同步登录拉取不跑。`RemoteAuthClient` 注册/登录/登出现在与本地同语义广播（登出保持同步、服务端调用 best-effort），新增总线间谍测试 2 项
- **照片壁纸出厂即开**：动态桌面主开关默认值 `false → true`——照片引擎是系统唯一主动壁纸域，新账号开机即生成照片壁纸，主开关退化为「想要纯色渐变桌面」的退出项；显式保存过偏好的用户不受影响（hydrate 只补缺失字段、persist 只在显式操作时写入）；`clearAllData` 恢复的出厂默认随之变为开启
- 测试：store/设置区/面板共 4 个测试文件的默认值断言翻转，dynamic-desktop E2E 重写为「默认开 → 关闭退场」契约；套件 637+58、E2E 12/12 绿

### 列表滚动可见性打磨（docs/DESIGN.md §3 增补，HANDOFF §6.3 销项）

- 新增 `.scroll-thin` 工具类：常驻 6px 主题色细滚动条（透明轨道、圆角 thumb、Firefox `scrollbar-width: thin`）——Windows「自动隐藏滚动条」下悬浮条悬停前不可见，末行截断时无从判断可滚（视觉审查两次提出）
- 新增 `ScrollFadeList` 组件 + `useScrollZone` 钩子（`useSyncExternalStore` 订阅 scroll/子树变更/元素尺寸，快照为原始字符串引用稳定）：「有溢出且未到底」时在可视底缘渲染 28px `from-surface` 渐隐遮罩，滚到底退场；纯谓词 `scrollZoneKey`（±1px 容差）独立单测
- 接入商店列表（默认窗口尺寸本就轻微溢出——即当初视觉审查看到的末行截断）与通知中心历史；E2E 覆盖「最大化无遮罩 → 拖小出现 → 滚到底消失」全链
- 测试：use-scroll-edge 5 项 + StoreApp 新测试文件 3 项 + NotificationCenter 1 项；套件 635+58、E2E 12/12 绿

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
