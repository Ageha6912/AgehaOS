# AgehaOS 交付与部署日志

## 2026-10-02 用户裁决：窗口八向自由拖拽缩放（修复失效的角柄）

- **根因（探针实证）**：旧实现只有右下角一个 16px 角柄，且其外半段被 Shell 2.0 的 `rounded-xl`+`overflow-hidden` 圆角裁剪成命中死区（elementFromPoint 直接穿透到壁纸层）——「不能自由拖动改变大小」实为完全不可用。
- **八向拖拽**：边缘 6px + 角 14px 命中区（n/s/e/w/ne/nw/se/sw，各带方位光标）；西/北缘拖拽带位置补偿（左/上缘跟手）。
- **钳制下沉到手柄层**：manager 的 workspace 钳制假定左上角固定、只向东/南长——西/北缘位置补偿会让「x 右移→上限收窄→再缩」正反馈螺旋（3 步内窗口被挤到 80px 宽钉死，实测）。改在手柄层钳制：最小 320×200 + 不越过屏幕缘（8px 余量），不经 workspace 视口。
- 测试：WindowFrame +4（八向柄存在/SE 收缩精确值/西缘补偿/最大化隐藏）；新增 `e2e/window-resize.spec.ts`（真实鼠标拖拽：SE 向内精确收缩、向外增大、西缘跟手；窗口先拖出浮轨遮盖区再测西缘——视口 1280 下左/右轨遮盖窗口边缘属 z 契约既定语义）。
## 2026-10-03 用户裁决：左栏右侧新增「今日应用」整列

- 新组件 `src/desktop/sidebar/TodayRail.tsx`：与左栏同款玻璃浮岛、固定其右侧垂直居中；羽化开 + 世界就绪才渲染，整列放「今日」分类应用——与启动器「今日」分类同源（世界行 hue 着色 AppIcon），点按走 `launchApp` 按需生成（kind=today）；悬停 tooltip「应用名 · tagline」；<640px 随左栏隐藏。
- **用户追加三裁决（同日返工）**：①两栏**无缝相连**——右栏左缘 = 左栏右缘（92px），自身无左边框、左侧方角，左栏右框线即中缝分隔线；②右栏 tooltip 被裁根因 = `overflow-y-auto` 连带 overflow-x 变 auto 把向右伸出的气泡裁掉 → 去 overflow（应用上限 10 纵向天然放下）；③左栏 tooltip 被右栏玻璃盖住 → Desktop DOM 序 TodayRail 提到 Sidebar 之前（同 z-40 后绘者在上）。
- 测试：TodayRail 单测 ×4（空态不渲染/瓷贴清单/点按开窗/**无缝契约 className 钉扎**）+ Desktop 回归 10 例 + E2E 新用例（今日应用列点按 → kind=today 真实沙箱生成）；DESIGN.md §26.1 契约入册。

## 2026-10-03 用户裁决：移除羽化应用窗口「✦ AI 生成」常驻徽标

- `EclosionTitleExtras` 不再渲染徽标（`eclosion-ai-badge` 退役，i18n 键 `eclosion.aiBadge` 双语删除）；标题栏保留 重新羽化 / 获取 / 举报 与**密码框红色警示**（功能性防钓鱼闸，非来源标识）。
- 原设计 §2/§5.4/§10「不可隐藏」条款作废并在文档中划线注明裁决；SECURITY.md §5 钓鱼行同步（警示保留）。
- 测试同步：app-frame 单测反转（断言徽标不存在）、WindowFrame 单测改钉重新羽化入口、5 处 E2E 徽标断言改钉 `eclosion-regenerate` 在场/缺席。

## 2026-10-02 补充裁决：Dock 名称气泡玻璃化（原生 title 退役）

- Dock 瓷贴/回收站的原生 title 气泡（用户指「没变化」的那颗）升级为与左栏同款玻璃芯片：新增 `.os-tooltip--dock` 变体（图标上方居中 bottom:100%+10px，4px 上滑微动）；有运行中窗口的瓷贴让位给悬停预览（预览头部已含应用名，避免双层重叠）。
- 连带契约更新：瓷贴原生 title 属性退役（aria-label 可达名不变；窗口标题经悬停预览头部呈现，Taskbar P2-7 用例改钉）。
- DOM 探针实证：气泡中心=按钮中心（818=818）、上方间距 10px、blur(10px) 生效。
## 2026-10-02 用户四点打磨（Dock 丝滑 / 红绿灯悬停 / 光标 / tooltip 精致化）

- **Dock 浮起丝滑化**：非对称过渡——入场 380ms easeOutQuint（cubic-bezier(0.22,1,0.36,1)）软减速浮起，回落 220ms 常规收拢（index.css 两个状态各写 transition）。
- **红绿灯悬停反馈**：圆点轻微上浮 1px + 放大 110%（group-hover/light，150ms ease-out），不显字形；光标十字（cursor-move）退役，拖动区保持默认箭头。
- **tooltip 精致化**：玻璃冷墨芯片——blur(10px) + 白/14% 细描边 + 顶缘高光 + 分层软影 + 圆角 10px；浮现带 4px 右滑微动（基态 translateX(-4px) → 亮起归位）。
- 测试：index.css 非对称过渡/tooltip 芯片新钉 +2；WindowFrame 红绿灯悬停类/cursor 默认 +2 组断言。

## 2026-10-03 羽化模式 P2–P4：E2E 验收补齐（对照设计 §12，26 用例 3 连跑全绿）

- 全部真浏览器 + dist 产物 + `page.route` 桩驱动。**P2**（`e2e/eclosion-world.spec.ts`，8 用例）：①首次今日世界落位——通知中心「今日世界已就绪」留档、顶栏「今日桌面由 N 条趋势信号生成」可展开来源列表、启动器「今日」分组 6 瓦片落位；②双主题质量门——世界 accent 写入 inline `--ag-primary` 后浅/深两态页面内实算 WCAG 对比度均 ≥3；③降级两分支——空数据纯想象（degraded、signalCount=0：世界照常、顶栏小字不渲染）与世界接口 503（静默放弃：今日分组空、桌面照常、worldHits≥1 证明走过拉取）；④今日应用生成——点按第 3 个瓦片（避开前 2 预取）断言 kind=today 请求契约（worldDate=今日/slug/theme/无 hint）+ 真实沙箱 iframe 破茧与点击交互。**P3**（`e2e/eclosion.spec.ts` 新增，含 stubEclosionApi 额度档覆写）：429 quota-exceeded → L3 错误卡带「今日生成额度已用完（20/20）…重置」+ 重试入口。**P4**（2 用例）：蝶谱时间线（世界留档 → Settings 展示日期/headline →「回到那天的主题」恢复甲日 accent 且今日应用不换，同日用「世界甲 → 重载换世界乙 → 回放甲」等价观测）；举报同意流程（先取消不上报/窗口保留 → 确认后 POST /api/dynamic/samples 载荷 source=eclosion + 应用名 + HTML 前 2KB 摘要 → 本地关窗 → 重开呈封禁卡）。回归：羽化关（默认）世界/生成接口零请求、「今日」分组空、accent 不接管。
- **E2E 抓出真实产品 bug 并修复**：举报同意框 createPortal 到 body，其 pointerdown 经 React 树冒泡到达窗口标题栏拖拽处理器（`WindowFrame.tsx` onTitlePointerDown），setPointerCapture 把后续 pointerup/click 重定到标题栏，弹层取消/确认按钮 onClick 永远收不到（真实浏览器中举报流程完全不可用；fireEvent 单测发现不了）。修复 = 标题栏只劫持物理命中自身的按压（`contains(target)` 守卫），配 jsdom setPointerCapture 探针单测（移除守卫必红、加回必绿），记入 docs/PITFALLS.md 坑 74。另加固既有 SSE 用例的重开帧定位（关窗退场 ghost 挂旧 iframe 致 `page.frame({url})` 偶发撞错帧，改锚定重开窗口自身 iframe 的 `contentFrame()`，坑 75）。
- 门禁：`npx playwright test e2e/eclosion-world.spec.ts e2e/eclosion.spec.ts e2e/eclosion-runtime.spec.ts`（11+7+8=26 用例）连续 3 轮各 26 passed；`npx vitest run src/desktop/window/ src/components/eclosion-app-frame.test.tsx src/apps/settings/EclosionSection.test.tsx` 74 passed（WindowFrame 单独 22 passed）；`npx tsc --noEmit`、eslint（4 个改动文件）、`npx prettier --check` 全清洁；dist 已 `npx vite build` 重建，临时调试脚本与预览服务器已清理。

## 2026-10-03 羽化模式 P4：治理与蝶谱（设计 §10/§8）

- **举报**：标题栏「举报」→ ConfirmDialog 显式同意（createPortal 至 body，坑 67）→ 编排器 `reportApp` 走既有匿名样本链路 `POST /api/dynamic/samples` 扩体 `{text≤512（应用名+tagline+query 组合摘要）, source:'eclosion', detail≤2048（HTML 前 2KB 客户端截断）}`；上传成功后本地立即关窗 + 会话封禁（编排器内存级 Set，登出/stop 清空不持久化；封禁 appId 开窗即封禁卡、无重试、ensureSession 拒绝）+ `eclosion.app.reported` 事件（预留键转正）。
- **服务端**：SAMPLE_BODY_SCHEMA 扩 source 枚举/detail 长度（violation 仍 422 不落库，分类只跑 text）；ContentSampleRecord 加 `source?/detail?`，postgres `ALTER TABLE ADD COLUMN IF NOT EXISTS` 两列（坑 23）+ INSERT/SELECT/行映射，memory/file 存整条记录自动透传；admin 复审新增「羽化应用」来源筛选 + 来源徽标 + 摘要呈现（客户端过滤，服务端面零扩展）。
- **蝶谱**：EclosionSection 时间线（ScrollFadeList：日期/headline/配色条/应用名单）+「回到那天的主题」= `world-theme.applyReplayTheme`（seed=hash(那日 worldDate+headline)，accent Token + 经 applyOutcome 的壁纸计划；只动主题与壁纸，世界摘要/kept/今日蝶谱不动；动效走 WallpaperLayer 既有交叉淡入的 prefers-reduced-motion 降级）。密码框警示与 AI 徽标为 P1 既有实现零改动（回归测试确认，含缓存路径 passwordInputSeen）。
- 门禁：前端针对性 244 测试（eclosion 42/frame 27/EclosionSection 12/SampleReview 10/world-theme 12 及牵连 141）、服务端 stores+samples 25/25、`npm run typecheck` 与 `npm run lint`（0 错误，2 警告均为未触碰既有文件）全部通过；全量四门禁按约定留给工作流脚本。

## 2026-10-03 羽化模式 P3：想象搜索（设计 §7）

- **服务端** `POST /api/eclosion/generate` 开放 `kind=imagine`：query trim 后 1–60 字（空白→422 invalid-query、schema>60→400 invalid-body）、先过 `classifyContentText`（violation→422 content-rejected，照 samples 模式不落任何存储）、包裹固定模板「用户想要一个应用：\<query\>。按应用生成契约输出。」（空白折叠防逃逸，系统契约不可改写）、恒个人版本不读不写全局缓存且不参与单飞锁、imagine 档每日 20 次、审计带 queryHash 但 query 原文零入日志。
- **客户端**：spec.ts 新增 `normalizeImagineQuery`（trim+空白折叠+小写）与 `imagineAppIdForQuery`（sha256 前 8 位，与服务端同口径、两侧同批字面量钉死）；编排器 `ensureImagineSession` 三道门禁（开关+登录、客户端 filterContentText、≥2 字）——同会话同（规范化）query 复用同一 appId/会话零新请求，HTML 只存会话内存（§8），登出整体清理；keepApp 扩想象分支（内存全文→kept≤30 LRU，名称=query，跨重启 restoreKeptApps 秒开，可卸载），权限恒空。
- **SearchPalette** 第三域「想象」恒排应用/文件后（「✦ 想象一个『<query>』应用」），键盘三段化，Enter/点击开窗即生成；帧 imagine 亦显「获取」；错误卡对 quota-exceeded 按 imagine 档展示已用/上限与重置时间（§12 P3 验收「额度耗尽提示清晰」）。
- 门禁：客户端 82（hash 字面量钉死/域序门控/违规不显示/会话复用/kept 往返/额度卡）+ 服务端 70（422 两类/模板注入钉死/个人版两次真生成/20 档 429/审计不含 query 原文）+ Playwright 1（Ctrl+K→生成窗口可用+违规词无想象项，route 桩 SSE）全绿；typecheck/lint 干净。

## 2026-10-03 羽化模式 P2：今日应用（按 2026-10-02 落位裁决：启动器承载，不复活桌面图标层）

- **分域**：spec.ts 加 `eclosionAppKind`/`ECLOSION_RUNTIME_DEFAULT_WINDOW`（720×480）/imagine 前缀预留；L2/L3 恒零权限。
- **运行时注册**：app-store 新增 `registerRuntimeApp`/`unregisterRuntimeApp`——与 installApp 同一 manifest 校验（schema 冻结），但不进 INSTALLED_KEY（runtimeIds 过滤持久化）；世界就绪时 `syncWorldApps` 增量同步当日清单、跨日/登出整体注销防陈旧。
- **编排器泛化** `EclosionTarget{basic/today/kept}`：kind=today 按需流式生成（body 含 worldDate+slug）、当日内重开走 today 缓存秒开、重新羽化绕缓存且覆盖本地；kept 只读快照（跨重启秒开、无网络）；登录时 `pruneTodayBefore` 次日清理 + kept 恢复注册；空闲预取恰前 2 个（每 worldDate 一次）。
- **「获取」基础设施**：`keepApp` 把当日缓存快照写入 kept（≤30 LRU、hue 随档）+ 注册「我的羽化」清单；`unkeepApp` 卸载。
- **启动器**：「今日」「我的羽化」两分类，今日瓦片按世界行 hue 色相旋转确定性徽章（AppIcon 新 hue prop，只转色相保明度差），kept 瓦片悬停 ✕ 卸载；宿主容器 L2/kept 终态失败渲染错误卡（重试=重新羽化）绝不落原生兜底、标题不标「已回落经典版」，标题栏新增「获取」（L1 不出现，成功翻转为已获取）；通知桥按域分流措辞（L2 NoFallback 文案键）。
- 门禁：针对性 15 文件 225 例全绿（另回归 497+282 例全绿、tsc/eslint 干净）。

## 2026-10-03 羽化模式 P2：主题落地（设计 §6.3）

- **world-theme.ts**（新）：seed=sha256(worldDate|headline)、世界 paletteId 按色相映射当前主题 gradient-field 构图（ACTIVE_STYLES 只剩 gradient-field，2026-09-27 裁决；不另起渲染层、不新建调色板）、照常过 evaluateQuality+applyOutcome 写历史；accentHue→`--ag-primary/--ag-focus-ring/--ag-brand-strong` inline Token（`--ag-brand/soft` 经 var() 自动跟随；只改色相，双主题 ≥3 对比度门不过不落 inline，校验层已回落调色板默认）。
- **编排器**：`refreshWorld`（登录/开关开触发，当日缓存命中不重发请求只重播就绪事件）/`regenerateWorld`/蝶谱 replay 写入（每世界日一条、≤60 LRU、不存 HTML）；`eclosion.world.ready` 由 dynamic-desktop 订阅应用主题（壁纸与 Token 管线所有者），themeFollow 关时不改主题。
- **接线**：顶栏「今日桌面由 N 条趋势信号生成」小字 + 来源弹层（`WorldSignals.tsx`，usePopoverDismiss 互斥；signalCount=0 纯想象降级与跨日陈旧世界均不渲染）；Settings「主题跟随今日世界」ToggleSwitch（默认开、总开关关时置灰，重开时重拉世界接回主题）。
- **附带**：额度扩 basic/today/imagine 三档、IndexedDB DB_VERSION 升 2 一次建齐 today/kept/replay 三 store（避免两次迁移）、world.ready 通知每世界日一条（去重态会话级）。
- 门禁：针对性 17 文件 230 例全绿（另回归 7 文件 71 例 + 服务端一致性 32 例 + tsc/eslint 全部通过）。

## 2026-10-03 羽化模式 P2：服务端今日世界（设计 §6.1/§6.2/§9.2）

- **trending.ts**（新）：可插拔 `TrendingSource` + GitHub Trending RSS 默认源（`AGEHA_ECLOSION_TRENDING_*` 可配）；清洗 ≤120 字/≤12 条/去 HTML/控制字符/URL、violation 条目剔除、内存+DataStore 双层缓存 TTL 6h、失败用上一次成功数据、全无 → 纯想象降级（世界照常生成）。
- **world.ts + world-data.ts**（新）：JSON Lines 逐行严格校验——theme 行 + 6–10 个合法 app 行；slug/名称撞名/icon Phosphor 白名单/hue/paletteId 抽象调色板白名单（24 组，shanshui-* 不入）/accentHue WCAG 双主题门+调色板默认回落/category 六枚举/内容过滤；invalid 整段重试一次；`ensureWorldForDay` 单飞锁保持坑 73 次序（acquire 后再补读缓存）。
- **scheduler.ts**（新）：启动检查一次 + 每 10 分钟查 UTC 日跨日即生成（`AGEHA_ECLOSION_WORLD_SCHEDULER*` 可配，默认开）、定时器 `unref`、onClose 清理；多实例复用 DataStore 单飞锁。
- **客户端同构** `src/core/eclosion/world.ts`（新）：公开载荷纵深防御校验（hint 永不下发——ADR 27），白名单/色相门全值域一致性由服务端测试动态引入客户端模块钉死。
- **路由**：`GET /api/eclosion/world`（全局按日缓存+懒触发、个人版优先）与 `POST /api/eclosion/world/regenerate`（个人版、耗 today 档、只写个人键绝不回写全局）；`POST /generate` 扩 `kind=today`（当日/世界成员校验 422、`(worldDate,slug,model)` 全局缓存命中不耗额度、权限恒空、今日额度 30）。热点以 JSON 数据块进 user 消息、系统提示词明示不可信不执行（注入测试钉死热点内指令只出现在数据块）。
- 门禁：`npx vitest run --config server/vitest.config.ts`（11 文件 142 测试）+ `src/core/eclosion/world.test.ts`（26 测试）+ eslint 改动文件 + 双侧 `tsc --noEmit` 全绿。

## 2026-10-03 羽化模式：AgehaOS SDK 客户端全链路（设计 §4.1 第 4 条收口）

- **runner 侧**（`eclosion-runner.js` 源文件 + `eclosion.html` 内联副本，字节一致由既有测试钉死）：power-on 时按宿主下发的 capabilities 声明安装**冻结的** `window.AgehaOS`——未授予的命名空间**不存在**而非「存在但被拒」，生成代码可特性检测分支（`if (window.AgehaOS && AgehaOS.storage)`）；实现 `files{read,write,list,mkdir,remove}`/`storage{get,set,remove,keys}`/`theme.get`/`window.setTitle`/`notification.show`，经既有 `agehaos:sdk` 白名单信封 postMessage 委托宿主、reqId 关联回执、5s 超时（`sdk-timeout`）、宿主错误码经 `Error.message` 传播；`agehaos:sdk-result` 消费不再是 no-op，且不暴露 post/pending 等内部原语。
- **宿主侧**（`eclosion-app-frame.tsx`）：SDK 权限恒来自规格表（L1 按各自 permissions、spec 查无即 L2/L3 恒空 → 一律拒绝，不读 permissionManager 运行时授予），power-on 随信附 `sdkCapabilitiesForPermissions` 推导的能力清单。
- **协议侧**（`runner-protocol.ts`）：power-on 信封 `{ scripts }` 扩为 `{ scripts, capabilities }`（capabilities 必填，宿主发送/协议解析/runner 校验/测试四处同步）+ 新纯函数 `sdkCapabilitiesForPermissions`（恒含免许可只读 theme）。
- **提示词侧**（server `prompts.ts`）：`capabilityLine` 重写为与实际 API 逐项对齐——files 的 `/Apps/<appId>/` 目录钳制与 invalid-path、storage 键规约与「已存值或 null」、特性检测范例、Promise reject 必须 catch、防抖 800ms；零权限规格明示只剩 theme。
- **安全铁律全程未动**：CSP `connect-src 'none'` 不变、sandbox 属性不变、消息类型不增（仍恰四类）、`<script>` 截留不变。坑 70 说明：eclosion.html 内容有变但 `public/apps/runtime/` 全部为未提交新文件（从未发布过带 `?v=` 的旧副本），runner 与 `?v=` 方案同变更集首发、无旧缓存可破，故未 bump package.json 版本。
- 门禁：`npx vitest run`（runner-protocol/eclosion-runner/eclosion-app-frame 三文件，44 passed）；`npm run test:server -- eclosion.test.ts` 30 passed（含新增 capability 文案回归）；`npx tsc --noEmit` 与 eslint 九个改动文件清洁；`npm run build` 后 `npx playwright test e2e/eclosion-runtime.spec.ts e2e/eclosion.spec.ts` 16 passed（新样本 sdk-storage.html 在真实 Chromium 的 SDK 往返 + 时钟 storage 桌面全链路端到端 + 未授予时 NO-STORAGE-CAPABILITY 降级分支）。

## 2026-10-02 羽化模式 P1：Playwright 端到端（切片五）

- 新增 `e2e/eclosion.spec.ts`（4 用例，全部真浏览器 chromium @ 干净本地认证构建）：①默认关回归——启动器「计算器」瓦片恰一枚（三件套隐藏）、原生组件可算 1+2=3、无 iframe 无 AI 徽标；②Settings「羽化」区——分区在场、总开关默认关且本地认证置灰+原因提示、三件套子开关联动置灰、额度探测优雅降级（无后端 →「暂无法获取额度」）；③开启态+503 桩（page.route 桩 /api/eclosion/generate → `ai-not-configured`）——羽化计算器接管入口、确定性失败不重试、回落原生可算 7×6=42、标题栏「已回落经典版」、AI 徽标与重新羽化按钮在场；④开启态+SSE 桩——完整真浏览器管线：真实 dist 内沙箱 iframe（sandbox=allow-scripts、src 带 ?v=）、破茧脚本在沙箱内真实执行（#result 文本 + 事件绑定点击）、进度条收起、关窗重开走 IndexedDB 缓存秒开。
- **开启态进入方式**：按用户分键持久化偏好（登录后以真实 userId 写 `agehaos.eclosion.prefs.v1.<id>` 再 reload 让装配链 hydrate）——本地认证下 UI 无法开启是 §9.3 准入裁决，e2e 测的是开启后的运行路径；服务端交互以 route 桩驱动（真 LLM 上游流式属 P0 spike 手工口径，见 docs/PITFALLS.md）。
- **沙箱本身不重复覆盖**：CSP 禁网（fetch/XHR/WebSocket/sendBeacon/EventSource 五路阻断 + 零出网 + 无 CSP 对照组）、不透明 origin（父 DOM/localStorage/cookie 不可达）、增量挂载+破茧+伪造来源忽略已在切片一 `e2e/eclosion-runtime.spec.ts`（9 用例）。
- **覆盖口径**（真浏览器 vs 单测）：真浏览器 = 默认路径/置灰/503 回落/SSE 流式+秒开/沙箱禁网；仅单测（jsdom）= 并发排队、AbortController 取消、重试恰好一次、SDK Default Deny、密码框警示、事件载荷（切片三/四 77 文件 635 用例）。
- 门禁：干净构建（删 dist、无 VITE_AUTH_BACKEND——.env.deploy 非 Vite 约定名不被读取）+ `npx playwright test` 全套 **32 passed（28 既有用例零改动全绿 + 4 新增）**；spec 经 eslint/tsc 零告警。

## 2026-10-02 羽化模式 P1：接线与设置（切片四）

- **AppRegistry 注册三件套**：`builtin-manifests.ts` 由 `BASIC_ECLOSION_SPECS` 派生 `com.ageha.eclosion.calculator/notes/clock` Manifest（entry 统一 `/apps/runtime/eclosion.html`、permissions/window 取自规格表，Manifest schema 不扩）；`registerBuiltinApps` 静默 grantAll，builtin 过滤使其不落 localStorage 安装表（与 IndexedDB 缓存双源解耦）；app-badges 补三枚精选徽章（字形同原生、青蓝族配色示「AI 生成版」）；窗口横版裁决豁免表补羽化计算器（300×440）与羽化时钟（420×560，设计 §5.2 表格钉死）。
- **展示名统一**：`launch.ts` 新增 `appDisplayName`（内置组件 → APP_UI_META；羽化 → 规格 titleKey；其余 → manifest.name），launch/启动器瓦片/推荐行/设置权限清单共用；launch 单测钉三件套标题与几何（300 被 MIN_WINDOW_WIDTH=320 抬到下限，与原生计算器同款行为）。
- **启动器呈现过滤**：`filterLauncherAppIds` 纯函数（开关开 + 默认羽化 → 三件套接管 calculator/notes 入口；关 → 仅原生；每应用可单独选「经典版」换回原生入口；时钟样本 com.ageha.samples.clock 维持现状不随开关隐藏；未知 `com.ageha.eclosion.*`（imagine 域预留）仅开关开时可见）；`eclosion-store` 扩 `modes`（按 userId 分键持久化，脏数据逐字段回落）；AppLauncher 新测试文件（纯函数 5 用例 + 点击启动行为 3 用例，e2e 断言依据）。
- **Settings「羽化」区**：`EclosionSection`（总开关/三件套生成方式子开关 `disabled={!enabled}`/额度展示/清除羽化数据）+ SettingsApp 三处登记（SectionId/sections/条件渲染）；总开关置灰逻辑——本地认证（§9.3 准入，提示「远程认证模式下可用」）或额度快照 `configured:false`（提示「服务端未配置 AI」，同时是 GET /api/eclosion/quota 的展示位）；开启即安排空闲预取；清除数据走编排器按用户清 IndexedDB。组件测试 6 用例（置灰两因/可开路径+预取触发/子开关联动/清除确认/打开即拉额度）+ SettingsApp 注册用例。
- **装配**：`main.tsx` 装配链尾追加 `systemEclosion.start()`（登录联动/额度拉取/空闲预取；任何 AI 环节失败静默降级原生兜底，不阻塞桌面）；通知桥 `eclosion.app.failed`（重试后仍失败）切片三已接。
- **文档**：ARCHITECTURE §2 依赖表登记 `core/eclosion` 与 services→store 既有先例、新增 §3.23 羽化模式、ADR 25/26/27；SECURITY 新增 §5 生成代码威胁模型（外传/越权/脚本偷渡/钓鱼/提示词注入/成本滥用/失败兜底 七闸门表）；PRD §8.1 新增 Type D 羽化应用 + L0–L3 软件分层表。
- 门禁（本片）：vitest 针对路径全绿（apps/store/desktop/services/components/core）+ `tsc --noEmit` + eslint 触碰文件零告警；全量四门禁与 E2E 由工作流脚本统一执行（切片五补 e2e/eclosion.spec.ts）。

## 2026-10-02 羽化模式 P1：前端核心（切片三）

- **① 规格表**（`src/core/eclosion/spec.ts`）：`EclosionSpec` 类型 + `BASIC_ECLOSION_SPECS` 三件套（appId/permissions/window/specVersion/titleKey/原生兜底映射）——刻意**不含 hint**（ADR 27：提示词只在服务端），服务端一致性门 `server/test/eclosion.test.ts` 随本片激活并通过（此前 it.skipIf 显式跳过）。
- **② 缓存**（`src/services/eclosion-cache.ts`）：独立 IndexedDB 库 `agehaos.eclosion`（不进 VFS），按 `userId:specId:vN` 分区，含「清除羽化数据」，不可用时静默降级。
- **③ 编排器**（`src/services/eclosion.ts`）：fetch+ReadableStream 解析 SSE（POST，非 EventSource）；html-stream 边流边切分（script 截留）；缓存命中秒开；并发 2 排队；AbortController 取消 + attach/detach 关注者计数（关窗中止、预取持有不打断）；requestIdleCallback 顺序预取；regenerate；重试一次→回落（ai-not-configured/quota-exceeded 等非重试错误直落）；额度快照；`eclosion.*` 与 `ai.decision.performed` 事件。
- **④ 状态**（`src/store/eclosion-store.ts`）：总开关（默认关、按 userId 分键持久化）、生成状态镜像、额度。
- **⑤ 宿主容器**（`src/components/eclosion-app-frame.tsx` + `src/services/eclosion-theme.ts`——主题映射拆独立文件因 eslint react-refresh 禁止组件文件导出非组件）：sandbox=allow-scripts iframe（src 带 ?v=）；event.source 严格相等 + runner-protocol 白名单；主题 Token 子集（--ag-* 映射 --ageha-*）随握手 seq0 下发；流毕 power-on；「结茧中…（思考 N 字）」/排队提示；5 秒无 rendered 或 eclosion:error 重试一次→原生兜底+标题栏「已回落经典版」；AI 徽标不可隐藏+重新羽化+密码框红色警示（EclosionTitleExtras）；SDK 桥复用 handleSdkRequest。
- **⑥ 事件**：SystemEventMap 扩五事件（world.ready/app.reported 为 P2/P4 预留）+ 发送处 + 通知桥只接 `eclosion.app.failed`（重试后仍失败）+ i18n 双词典新键；⑦ WindowFrame `com.ageha.eclosion.` 前缀分支先于 allowlist 判定。
- 门禁：vitest 60 文件 502 用例 + `npm run test:server` 108 用例 + `tsc` + eslint 全绿。

## 2026-10-02 羽化模式 P1：服务端生成管线（切片二）

- 新增 `server/src/eclosion/`（L1 规格表+提示词 `spec.ts`/`prompts.ts`、OpenAI 兼容 `stream:true` 上游客户端 `upstream.ts`、流式结构闸 `html-gate.ts`、额度域 `quota.ts`）与 `server/src/routes/eclosion.ts`：`POST /api/eclosion/generate`（登录 + 本期只开放 kind=basic + SSE `meta/think/delta/done/error`、断开与超时经 AbortController 中止上游、`AGEHA_ECLOSION_TIMEOUT_MS` 默认 240s）、`GET /api/eclosion/quota`（剩余额度 + UTC 重置时间；未配置 Key 时 200 `configured:false` 供 Settings 探测，generate 仍严格 503）。
- **结构闸四件套**：剥围栏与 `<!doctype`/`<html` 之前的一切前缀；60KB 截断标 `invalid-output`；外链（src=/url(/@import）跨 chunk 安全移除并记审计；流末围栏不下发。
- **成本护栏**（设计 §9.3）：`AGEHA_ECLOSION_*` 逐项回退 `AGEHA_AI_*`、Key 全空 503、个人每日 basic 10 次（admin 只计全局）、全局日 token 预算、6/min/用户限流、`(specId,specVersion,model)` 全局缓存命中不耗额度、单飞锁去重并发。
- **存储面**：DataStore 接口扩羽化面并 memory/file/postgres 三驱动同步（postgres 三张新表、file 持久化计数与缓存、锁一律不持久化）。
- **测试中抓到两个生产级 bug 并修复**：① Node ≥16 里 `request.raw` 在请求体读毕即发 close（inject 测不出、真 socket 才暴露）——断开检测改挂 reply.raw 且 writableEnded 判定（坑 73）；② 单飞锁 check-then-act 竞态——改为 acquire 成功后补读缓存。
- 门禁：`npm run test:server` 107 passed / 1 skipped（skipped 为客户端 spec.ts 一致性闸，切片三落地自动激活）+ server typecheck + eslint 清洁；修复后 27 连跑全绿。

## 2026-10-02 羽化模式 P0：沙箱运行时 Spike（切片一）

- **`public/apps/runtime/eclosion.html`**：自带设计 §4.1 第 2 条**逐字 CSP**（`connect-src 'none'` 为关键），挂载根 `#eclosion-root`；版本化契约（宿主 `?v=`）以注释 + 坑 70 记录。
- **`eclosion-runner.js`**：实现 §4.2 全协议（ready → chunk 增量 `<template>` 挂载 + pop 动画（reduced-motion 降级）→ power-on 按序 textContent 注入 → rendered/error 回报）；生产形态内联进 html，源文件与内联副本逐字节一致由单测钉死。**§4.3-1 内联裁决**：Chromium 下 CSP 'self' 能匹配外链 runner（无 Refused-to-load 违规），实测拦截发生在其下的网络层（opaque origin→loopback 触发 PNA）；外链受环境支配故维持内联。
- **`src/core/eclosion/` 四件**：`sse.ts` 纯函数帧解析（跨 chunk/CRLF/CR/event/data/BOM/close）；`html-stream.ts` 流式切分（script 内容与元素整体截留、style/骨架先行、仅闭合构造成片、残缺标签留缓冲、引号内 >/CSS 子选择器/注释内假 script/a<b 全覆盖）；`runner-protocol.ts` 双向恰四类白名单（多余字段丢弃、未知类型拒绝、SDK 委托 sdk-bridge）；runner 源文件/内联副本逐字节一致性单测（`eclosion-runner.test.ts`）。
- **`web-app.ts`**：新增 `ECLOSION_RUNNER_ENTRY` 精确判定，`/apps/sites/` allowlist 不放宽（测试钉死）。
- 验证：`npx vitest run src/core/eclosion src/core/apps/web-app.test.ts` → 64 passed（5 文件）；干净构建（无 VITE_AUTH_BACKEND、端口无残留）后 `npx playwright test eclosion` → **9 passed**（CSP 逐字断言、五 API 禁网+零出网+无 CSP 对照组、不透明 origin 三路 blocked、'self' 结论、event-counter/canvas 两样本真实切分器驱动的增量渲染与破茧、破茧抛错回 boom、伪造来源 power-on 被拒）；eslint 零告警。坑 72 入 docs/PITFALLS.md；上游模型选型与延迟对照待真实 Key 手工 spike（坑 72⑤）。

## 2026-10-02 用户三点裁决（Dock 悬停 / 红绿灯 / 零自动开窗，18:xx 工作区提交）

- **Dock 悬停只浮起被悬浮的一枚**：§13 波浪引擎（wave.ts / use-dock-wave.ts 及测试）整体删除，改为 index.css hover 规则（translateY(-3px) scale(1.18) + cobalt 28% 光晕；触屏与 reduced-motion 不浮起）；motion-lab E2E 重钉「悬浮浮起 + 邻位不动 + 移开归位」（DESIGN.md §13 重写、DECISIONS A21）。
- **红绿灯去符号**：✕/—/⬛ 字形与 --ag-wl-*-glyph Token 退役，纯色圆点；可访问名契约不变（DESIGN.md §21、DECISIONS A22）。
- **进桌面零自动开窗**：动态面板自动打开与小游戏轮换自动弹出退役（A5/A6 标记被取代 → A23）；Desktop 单测钉零开窗；dynamic-panel/responsive/widgets/menu-bar 四条 E2E 改 helpers.openDynamicPanel 手动开。**连带修 §25 缺口**：launchApp 无显式几何时级联起点（x=80）在窄视口横向溢出（375px 下 80+359=439，自动开窗时代传显式几何从未暴露）——右缘收进视口（8px 余量），launch 单测 +2。
- **连带修部署 env 污染**：.env.production 命名撞 Vite env 约定被 vite build 自动读取，VITE_AUTH_BACKEND 泄进客户端 → E2E 干净构建 19/19 全挂；改名 .env.deploy + 防回归测试（根部 Vite 约定 env 文件禁含 VITE_ 变量）。

> 自 v0.2.0（tag d460774，2026-09-23）起的逐切片日志，自 HANDOFF.md 迁入（2026-10-02 评审 P1-5）。更早历史见 git log 与该 tag。

## 2026-10-02 UI 评审修复（docs/UI-REVIEW-2026-10-02.md，部署 ㉖）

- 用户裁决「外壳可读性照参考图」后指令「直接根据 UI 评审清单优化」，完成清单 P0-1/P0-2/P1-3/P1-4/P1-5（开机字标）/P2-7/P2-8 与 DESIGN.md 收敛；现行规则写入 **DESIGN.md §0**（与下文冲突以 §0 为准）。
- **材质**：弹层与小组件改纸面（白玻璃 + 墨字 / 深色冷墨玻璃 + 浅字，`.chrome-paper,.popover-panel,.glass-popover,.widget-card` 重声明整套 Token）；菜单栏压暗 `rgb(18 30 66/50%)`；双色焦点环；widget blur 3→8px；品牌标语全强度字色。`.desktop-chrome` 补声明别名 `--ag-surface-raised`/`--ag-brand`（:root 别名声明处求值、子树不重算——菜单栏 hover 曾落成近白实色）。
- **弹层契约**：`usePopoverDismiss` + `popover-store` 互斥槽——Esc（document 捕获）/外部按下/焦点进 iframe 关闭，Esc 回焦触发器；启动器自动聚焦搜索；通知中心 ≥1280px 停靠右栏左侧。窗口 blur 判定只认「焦点落进 iframe」（jsdom 与浏览器在焦点离开 body 时也发 window blur，曾导致启动器打开即关）。
- **tooltip**：`index.css` 未分层压过 Tailwind `@layer utilities`，改为 `.group:hover .os-tooltip` 点亮（浏览器实测 opacity 1）。
- **真实性**：删示例天气（改真实时区名）/ Wi-Fi·蓝牙示意图标；「CPU」改「流畅度」rAF 实测帧率；商店仅在目录验签失败时告警；示例应用与动态面板去术语；设置提示去裁决日期；Files 系统目录中文显示名。
- **可达性与快捷键**：DOM 序 = 视觉序（菜单栏 z-[41]）、`h1`/`main`/命名 `nav` 地标、Dock 瓷贴名恒为应用名、交通灯 focus-visible 显字形、11px 下限；`core/platform` 按平台写快捷键；菜单项快捷键提示 + `aria-keyshortcuts`；「帮助 → 键盘快捷键」面板；「窗口 → 切换到下一个窗口」。用户菜单去掉不合法的 menuitem/aria-haspopup（`<menu>` 的 ARIA 角色是 list）。
- **开机屏**：mark + CSS 文字字标（full 资产深色字标在深色开机底上只剩「OS」）。
- **未落地（待产品裁决，DESIGN.md §0.7）**：左栏与 Dock 重复入口、编辑菜单独立、首登自动开面板与小游戏、深色壁纸、动效默认项。
- 门禁：typecheck / lint（2 条既有 warning 不在改动文件）/ **890 前端（106 文件）+ 80 后端 + 部署库** / build / **E2E 19/19**。本机可用内存约 4GB 时 vitest 默认 worker 数会 OOM，用 `--maxWorkers=2`；E2E 构建须 `vite build --mode e2e`（`.env.production` 会开远程后端，坑 46）。截图 `.tmp/ui-verify/`。

## 2026-10-02 Desktop Shell 2.0 高保真精修（4f25d9a，部署 ㉔ 已上线）

- 用户以 `/workflow` 点名工作流交付「Floating OS Environment」精修（17 条简报：浮动左栏/漂浮右栏 Widgets/OS 菜单栏/浮动 Dock/玻璃体系/冷白蓝靛紫青调色板/桌面负空间/窗口 OS 质感；禁止重写引擎、删功能删测试、新框架、Dashboard 风）。六切片工作流交付后用户验收「确认，提交部署吧」→ 同日提交部署上线。
- 拓扑：3 摸底员并行 → 设计规范（撰稿人 + 独立评审两轮，规范文件 `.tmp/shell2-design-brief.md`）→ 常驻精修师六切片串行 × 每切片五门禁 → 截图取证（7 状态 @1920×1080 + 1280/1366/2560 三视口，`.tmp/shell2-shots/`）→ 5 评审员并行（含与仓库根参考图十轴对比）+ 修复闭环。
- **六切片全部五门禁全绿**（typecheck / lint / test / build / test:e2e 逐切片跑真）：①**地基**：玻璃七面材质表 blur 阶梯 token 化且逐格互异——menubar 12（.glass-hint）/ widget 3（Acrylic）/ rail 20（.glass-raise）/ dock 28（.dock-glass 白22%）/ window 36（.glass-deep）/ popover 44（.popover-panel,.glass-popover → --ag-glass-bg-strong 白86%·墨84%，chrome 作用域 remap 白26%）/ modal 唯一实色；新增 --ag-shadow-float/-dock 双主题；几何 Token menubar 40→32px、rail-left 132→80px、dock 68/gap 20/icon 48/pitch 56；viewport.ts 常量同步 + CSS↔TS 互指钉扎扩到双栏。②**左栏浮岛**：left-4 垂直居中 rounded-xl glass-raise，icon-first（44px 方钮、文字改自绘 os-tooltip 气泡 + 原生 title 双轨），八瓷贴与用户中心深链全保留，active=既有 hover 瞬态（八项均动作入口无「当前项」语义，规范裁决）。③**右栏漂浮卡**：right-5(20px)/gap-4(16px)/top 48px/卡宽 288，四卡数据源零改动，容器不画材质=四个独立漂浮面板；E2E 加右缘 20px±0.5 与顶锚 48px±0.5 真实 boundingBox 钉扎。④**菜单栏**：MENU_IDS 五→四（file/view/window/help），原编辑菜单 6 项 execCommand 动作整体迁入文件菜单第二分组（能力零删除）；右簇 = System 纯指示（Wi-Fi/蓝牙/电池，不做假交互——规范裁决）+ **新增 Cloud 同步状态按钮**（三态，点击深链设置账户分区）+ 通知 + 用户 + 时钟移最右；glass-hint 材质 + 13px 字号。⑤**Dock 精修**：高 68/radius 24/图标 48/gap 20，波浪/悬停预览/回收站/常驻契约不动。⑥**窗口+品牌**：窗口圆角/细边/软影/聚焦层级（像 OS 窗口）；品牌层更轻；最大化 inset-0 真全屏契约（修订 12）原样保留。
- **视觉评审 1 轮发现 2 问题，已修复并由主代理复验**：①high——SearchPalette 补挂 `glass-popover`（弹层独立材质档，SearchPalette.test 钉扎）；②low——AppLauncher 输入框 placeholder/kbd 徽章对比度提升（text-text 墨字 + bg-surface-elevated）+ 启动器底部锚定改 `--ag-dock-gap`。修复后**五门禁复验全绿：847 前端 + 80 后端 + E2E 19/19**，04/05 复拍确认修复可见。
- **坑（工作流层）**：修复轮 `npm run test` 门禁一次环境性抖动失败（复跑全绿，代码无问题）——工作流按「失败就停止」中止后由主代理收尾补跑门禁 + 复拍复验。Windows 下工作流 world.run 无法直接 spawn npm（`spawn npm ENOENT`/npm.cmd 引号损坏），须用 `node C:/Program Files/nodejs/node_modules/npm/bin/npm-cli.js run <script>`。
- **提交与部署（2026-10-02，用户「确认，提交部署吧」）**：DESIGN.md 新增 **§33 契约节**（玻璃七面材质表/几何 Token 重定档/组件形态/验收，本轮为权威）→ 提交 `4f25d9a`（24 文件 +725/-177，显式列文件提交）→ 钉扎清洁构建（先删 dist）新包 `index-O0VyL329.js` + `index-zmcm6SfU.css`（本地预检 pin/glass-popover/ag-dock-gap 标记全在）→ 服务器旧 dist 备份 `dist.old-prev7-1002` → tar 上传（`--exclude=server/data` 前置）→ **六点核验全过**（keyId 082ff6625c72e40b=pin / pin 在 live bundle / Caddyfile os 块 + no-cache 头生效 / HTTPS 200 / index.html 引新包 / 特征标记在 live bundle）→ **src/server 零改动未重启**。隧道线上冒烟：注册→桌面→壁纸 ✓、菜单栏四菜单（文件/视图/窗口/帮助）+ 编辑已并入 ✓、左栏浮岛 x=16 垂直居中（box y323 h434 中心=540 精确居中）✓、Dock 瓷贴 ✓、**搜索面板 glass-popover 独立材质档 ✓**、右栏右缘留白 20px 精确 ✓、Files 窗口 ✓；控制台唯一 401 = 登出态 /api/auth/session（正常）。截图 `.tmp/deploy-smoke/`。
- **部署坑（环境）**：本机 TUN 代理环境下 SSH 到 VPS 会偶发连接超时（备份命令成功后 30 秒内上传即超时一次）——tar 上传套 `ConnectTimeout=15` + 3 次重试循环即可；`ssh -f -N -L 18443` 隧道复用时要先查 18443 是否仍被上一条命令的隧道占着（bind 报错但旧隧道仍可用，冒烟照跑）。
- 工作流产物：报告 + 看板 + 5 张关键截图（工作流 artifact 卡片）；全部 10 张截图在 `.tmp/shell2-shots/`；取证脚本 `.tmp/shell2/capture.mjs`（可复用）。lint 现存 2 条既有 warning（motion-lab domcheck 无用 disable 指示器 + use-window-motion exhaustive-deps），均不在本轮改动文件内。

## 2026-10-02 最大化整视口真全屏（1a44a83，部署 ㉓ 已上线）

- 用户反馈（附图）：最大化后仍被上下组件阻拦（菜单栏带/Dock 带可见）——修订 9 的「上贴菜单栏下界/下贴 Dock 边界」语义不满足「覆盖整个屏幕」。
- **修订 12**：最大化 = `inset-0` 整视口真全屏——窗口层 z-[45] 盖过菜单栏/Dock/左右浮层栏全部 z-40 chrome；还原走窗口标题栏（还原钮/双击标题栏）。菜单栏与 Dock 在最大化期间不可达（macOS 全屏同语义），全局快捷键（Ctrl+K/Alt+W）仍可用。
- 测试：单测几何契约改 inset-0 断言；E2E window-maximize.spec 改 y≈0/高≈视口高 + Dock 带内取点必须命中窗口（elementFromPoint 探针从组件栏扩展到 Dock 带）。基线 841+80+E2E 19/19；部署 ㉓ index-CmII7Gb_.js 六点核验全过（inset-0 rounded-none 标记在 bundle）。DESIGN.md §9/§19/§32.5 已同步修订 12 语义。

## 2026-10-01 Dock 运行中行滚动条隐藏（86fece3，部署 ㉒ 已上线）

- 用户报告：悬停动态面板图标闪现带箭头滚动条。根因：运行中行 `overflow-x-auto`（overflow-y 计算值 auto），波浪把 48px 图标放大到 1.5×（72px > 行高 64px），变换后边界计入可滚动区域 → 滚动条随悬停出现。
- 修复：`.no-scrollbar` 工具类（scrollbar-width:none + ::-webkit-scrollbar display:none）挂运行中行（新 testid `dock-running-row`）——滚动条 UI 隐藏、滚动能力保留（多窗口滚轮横滚，scroll 事件照常驱动波浪重测）。
- 测试：Taskbar 单测类契约 + motion-lab E2E computed scrollbar-width === 'none'。基线 841+80+E2E 19/19；部署 ㉒ index-ZY7ViS5-.js 六点核验全过。

## 2026-10-01 动效实验室集成（1f6c5b8，部署 ㉑ 已上线）

- 用户四项裁决：①Dock 波浪没有了 ②菜单/通知动效没看到 ③加鼠标跟随光晕 ④加进阶炫技档勾选的四项。
- ①**波浪域根因**：`useDockWave` 只挂在运行中窗口行（§9 时代全任务栏都是运行项），§32 后 Dock 主体是瓷贴而瓷贴图标无 `data-wave-icon`——形同消失。修复：瓷贴图标 span 挂 `data-wave-icon`，波浪引擎容器（waveRowRef）上移包住瓷贴+运行中两行；回收站/启动器不参与。
- ②菜单/通知动效 §8.4 早已集成（os-pop-in 进场 + useExitPhase 退场；toast 滑入 200ms/驻留 hover 暂停/滑出 120ms）——本轮核验在位，未改动。**若用户系统开了「减弱动态效果」（prefers-reduced-motion），全部动效会被抑制**——已向用户说明。
- ③指针光晕（use-cursor-glow，§15 已归档）原默认关 → **默认开**。
- ④进阶炫技档四项（原裁定缓办，本轮按裁决接入）：**aurora** 流光渐变氛围（canvas 精灵烘焙，30fps 上限/半分辨率/document.hidden 暂停/reduced 静态帧，`use-aurora.ts`+`aurora-engine.ts` 纯函数可测）；**window-tilt** 窗口切换转场（`use-focus-tilt.ts`：焦点迁移 false→true 一次性 WAAPI 小起立 ≤2deg，方向=朝上一焦点让位，`Math.sign(dx||1)` 兜底；失焦 `.is-tilt-dim` 微退后——仅 CSS 类不碰 §12 inline pose）；**dock-sheen** 高光滑过（纯 CSS 9s 循环，`.dock-sheen` 独立覆盖层内裁剪——不能挂胶囊本体，overflow:hidden 会裁掉波浪放大的图标）；**theme-glow** 主题光晕（CSS 呼吸 `.ambient-glow`）。
- `motion-prefs-store` 扩五开关 {glow,aurora,windowTilt,dockSheen,themeGlow} 设备本地默认全开 + `reloadMotionPrefsStore()`（reload≠reset，reset 才清存储）；设置「外观」动效实验室五开关组（testid motion-*-toggle）；i18n zh/en 五词条。
- 测试：新增 store 3 例 + 引擎纯函数 5 例（布局确定性/轨道包络/tilt 方向与 ≤2deg 铁律）+ WindowFrame is-tilt-dim + Taskbar 波浪域/扫光层 + SettingsApp 五开关；E2E `motion-lab.spec.ts`（三层挂载/瓷贴波浪 transform/开关即时生效）；基线 **841 前端 + 80 后端 + E2E 19/19**。
- 部署 ㉑ index-PBBiik6D.js 六点核验全过（aurora-canvas 标记在 bundle）。src/server 零改动未重启。

## 2026-10-01 窗口最大化全幅 + 盖过桌面浮层（cde5875，部署 ⑳ 已上线）

- 用户报告两个问题：①最大化窗口只占屏幕中间、四周被组件阻拦；②桌面组件（右栏小组件等）叠在窗口之上。根因：最大化几何还是 §19/§26「避开左右栏」旧契约（`sm:left-[rail-left] xl:再扣右栏`），而 §30/§32 已把左右栏改成浮层；且窗口层恒 z-30 < 浮层栏 z-40。
- **几何**：最大化 = `left-0 top-[var(--ag-menubar-height)] w-full h-[calc(100%_-_var(--ag-menubar-height)_-_var(--ag-dock-height)_-_0.75rem)] rounded-none`——横向全幅贴屏幕边缘、上贴菜单栏下界、下贴 Dock 边界（footer 高 = 68+12=80px），不留空白边框。普通窗口拖拽钳制（getWorkspaceViewport 扣栏）不变。
- **层级**：WindowLayer 存在最大化窗口（含退场 ghost）时整层 z-30→**z-[45]**（盖过左栏/组件栏 z-40）——层叠上下文内单窗口 z 无法逾越容器，必须抬整层；ghost 计入避免关窗退场期间层闪。菜单栏/Dock 与最大化窗口几何无重叠，照常可用；最大化时左右栏被窗口覆盖（交互窗口需先还原，macOS/Windows 同语义）。
- 测试：WindowFrame 单测（几何类+层级类契约）；新增 `e2e/window-maximize.spec.ts`（几何 ±1px、elementFromPoint 组件栏区域必须命中窗口、层 computed z=45、还原回落）；DESIGN.md §9 重写为常驻契约 + §19/§27 契约更新 + §32.5 修订记录（补记 Dock 常驻/预览锚定/无底色三裁决）。
- 基线 831 前端 + 80 后端 + E2E **18/18**；部署 ⑳ index-DqaThM8M.js 六点核验全过（z-[45] 标记在 bundle）。src/server 零改动未重启。

## 2026-10-01 Dock 图标白边去除（f6db3ad，部署 ⑲ 已上线）

- 用户裁决：Dock 图标四周的白边去掉。根因 = 图标按钮的 `bg-surface-raised`（desktop-chrome 作用域 = 白 16%）：44px 徽章坐在 48px 按钮里，hover/active 浅底在玻璃胶囊上显成图标四周的白框。
- 修复：瓷贴/运行中/启动器触发/回收站四类按钮全部不画底色——悬停反馈走悬停预览（350ms），激活态只剩底部指示点（macOS 模式）。弹层内部（预览关闭钮、启动器菜单项、通知中心）的 hover 底色保留——它们在弹层面板上，不产生白边。
- 测试：单测钉瓷贴/回收站按钮 className 不含 bg-surface-raised；E2E 悬停态 computed backgroundColor === transparent 断言。
- 基线 830 前端 + 80 后端 + E2E 17/17；部署 ⑲ index-87pf6B_S.js 六点核验全过。src/server 零改动未重启。

## 2026-10-01 Dock 悬停预览锚定修复（b6ecbea + 3aaf7bd，部署 ⑰⑱ 已上线）

- 用户报告：Dock 图标悬停预览跑到屏幕右缘。根因（**坑 13 再变体**）：玻璃胶囊 `surface-glass` 的 backdrop-filter 使胶囊成为 fixed 后代的包含块——`WindowPreview` 用视口坐标 `left: anchorLeft`，被加上胶囊左缘偏移后钳到 `innerWidth-272`，整体贴右缘。
- 根治与启动器同路径：`createPortal(document.body)` + `bottom-[calc(var(--ag-dock-height)+1.25rem)]` 显式锚定（≈旧 footer-CB 下 bottom-full+mb-2 几何，悬在胶囊上方）。UserMenu/NotificationCenter 用 absolute 相对包装块，不受此坑影响。
- **二次反馈（3aaf7bd，部署 ⑱）**：portal 后 left 仍取图标左缘，256px 卡片从图标向右展开视觉偏右——改为 `anchorLeft + 24 - 128` 以图标中心居中锚定（PREVIEW_WIDTH/DOCK_ICON_SIZE 常量），出屏钳制不变。portal 后 bottom-full 相对视口=屏顶，**portal 的 fixed 弹层必须显式 bottom**。
- 测试：Taskbar 单测加 portal 断言（parentElement===body、不在 footer 子树、恒 fixed）；e2e/taskbar-autohide.spec 新增「悬停预览锚定图标上方」契约并升级为**居中断言**（|预览中心−图标中心|≤2px）。
- 基线 830 前端 + 80 后端 + E2E **17/17**；部署 ⑰ index-Pux3b43A.js / ⑱ index-DBuiETZ6.js，六点核验均全过。src/server 零改动未重启。

## 2026-10-01 底部 Dock 常驻（64aa7cb，部署 ⑯ 已上线）

- 用户裁决「底部 dock 栏设为常驻」：**自动隐藏机制整体移除**（§9/§20 行为退役）——唤出区/收起定时器/reveal 状态机删除，footer 恒 data-state=revealed；波浪/悬停预览/瓷贴契约不变。
- **坑（坑 13 变体）**：常驻改造移除 footer 内联 transform 后，启动器弹层（fixed）的包含块落到带 backdrop-filter 的胶囊上（被钳制居中），375px 下弹层右缘溢出 388——根治 = 弹层 createPortal 至 body（包含块恒视口），Esc 契约移至弹层自身。
- taskbar-autohide.spec 重写为常驻契约；Taskbar 单测自动隐藏三例改常驻断言；helpers.revealTaskbar 保持兼容（立即通过）。
- 基线 830 前端 + 80 后端 + E2E 16/16；部署 ⑯ 新包 index-DkUcEaqP.js（核验 bundle/HTTPS ✓）。

## 2026-10-01 组件 Acrylic 六轮调淡（ed81335，部署 ⑮ 已上线）

- 用户裁决再淡两档：--ag-widget-blur 20→12px、--ag-widget-tint 6/10%→3/6%（近乎纯透，可读性靠文字投影）。钉扎同步。
- 基线 832 前端 + 80 后端 + E2E 16/16；部署 ⑮ 样式包 index-GAG3TxgY.css 核验（blur12 ✓ HTTPS ✓）。

## 2026-10-01 组件 Acrylic 五轮调淡（1e1d716，部署 ⑭ 已上线）

- 用户裁决再淡：--ag-widget-blur 32→20px、--ag-widget-tint 10/16%→6/10%（hex 7891c81a→3c50821a 系）。index.css.test 钉扎同步 20px。
- 基线 832 前端 + 80 后端 + E2E 16/16；部署 ⑭ 样式包已上线核验。

## 2026-10-01 壁纸换蓝调原片 v5 + 品牌层对齐（9bf4694，部署 ⑬ 已上线）

- 用户提供第三张无 UI 原片（蓝调蝴蝶+新月，2176×1152，会话缓存文件）：ageha-dreamland.jpg?v=5（仅转码 502KB）满屏 cover；时钟缩略图重裁（城市+日辉，?v=5，91KB）。
- 品牌层块中心 46%→30% y——按既定「文字与蝴蝶同高」裁决随新图蝴蝶位置更新（新片蝴蝶在 ~32% y 高度带）。
- **坑（本地探针）**：带 VITE_AUTH_BACKEND=1 的部署构建在本地跑截图探针时必须同时起 dev 后端（AGEHA_DATA_DIR=.tmp/dev-data npx tsx server/src/index.ts，:8787）——远程模式注册要真后端，否则桌面永远出不来（widgets-clock 30s 超时假象）。
- 基线 832 前端 + 80 后端 + E2E 16/16；部署 ⑬ 新包 index-DRFmXZ7z.js，五点核验全过。

## 2026-10-01 壁纸换新原片（0a1267e，部署 ⑫ 已上线）

- 用户提供第二张无 UI 原片（更亮版，1721×914，**D 盘下载目录文件永不提交**）：ageha-dreamland.jpg?v=4（仅转码 350KB）满屏 cover；时钟缩略图重裁 ?v=4（88KB）。
- **修订 5 的内容缩小方案随新片移除**（用户裁决此图不适用缩小）：PhotoSurface 回归满屏 cover 单层，--ag-wallpaper-content-scale Token 退役，衬底/mask 结构删除。若未来要恢复缩小方案，git 历史 1d0d9f3 可考。
- 基线 832 前端 + 80 后端 + E2E 16/16；部署 ⑫ 新包 index-C0Aisvpk.js，五点核验（bundle v4/壁纸/缩略图/keyId/HTTPS）全过。

## 2026-10-01 壁纸满屏 + 内容等比缩小（1d0d9f3，部署 ⑪ 已上线）

- 用户裁决推翻修订 4 的「居中浮层 + 留白」方案：壁纸必须**始终满屏**、无浮层无留白边框；改为「满屏前提下班面内容等比缩小至 80-85%（默认 85%）」。
- 落地：壁纸层双结构——①衬底 = 同素材 cover 满屏 + blur(64px)+brightness(0.9)+saturate(1.15)+scale(1.06)，负责屏幕边缘自然衔接补足（模糊仅用于边缘）；②内容层 = 同素材等比缩至 `--ag-wallpaper-content-scale`（Token，80-85 可 5% 步调）居中、全清晰（无模糊无圆角无边框），四周以双向线性渐变软 mask（mask-composite: intersect）渐进融入衬底。旋钮在 :root，微调改一个值。
- 壁纸静止（视差已移除）→ 动效缩放同步问题自然消解。
- 基线 832 前端 + 80 后端 + E2E 16/16；部署 ⑪ 新包 index-DFDW1geV.js + index-DpIlpKEp.css。

## 2026-10-01 组件 Acrylic + backdrop-filter 根因修复（0f9a75f + 间距/收窄 2a73d82/e9dbc0f，部署 ⑨ 已上线）

- 用户裁决①「左栏导航间距拉大」：gap 2→12px、行 py 6→8px（2a73d82）。
- 用户裁决②「右栏组件太宽」：--ag-rail-right-width 336→296px（卡片 328→288），Token/viewport 常量/钉扎/E2E 同步（e9dbc0f）。
- 用户裁决③「组件背景毛玻璃」（0f9a75f）揪出**两个沉默多时的根因**：
  - **根因 A（影响全应用）**：源码同时写标准 + -webkit- 的 backdrop-filter 时，Tailwind 4 的 Lightning CSS 会剥掉标准属性只留 -webkit-，而目标浏览器不认 -webkit-backdrop-filter（CSS.supports false）→ **玻璃模糊自构建链切换后一直整体失效**（只剩浅染色）。修复=源码删除全部 4 处 -webkit-backdrop-filter 行，标准属性完整入产物（Lightning 之后自己会补 -webkit- 且标准在后）。**新写 CSS 带 backdrop-filter 时一律只写标准属性。**
  - **根因 B（§32 材质）**：.widget-card/.menubar-glass 源序位于 .surface-glass 之前，被同权重后者覆盖——遮罩从未生效。已移至其后；降级兜底升特异性（.desktop-chrome .widget-card 实色）。
- Acrylic 旋钮（:root，用户可按壁纸复杂度微调）：`--ag-widget-blur`（32px，建议 20-40）+ `--ag-widget-tint`（深蓝渐变遮罩 40%→50%，白字配深遮罩，建议 30-50%）；.widget-card 消费双旋钮；降透明/无 bf 环境回落实色 #2c3a63；index.css.test 钉扎。
- 基线 832 前端 + 80 后端 + E2E 16/16；部署 ⑨ 新包 index-BdjA-0Fm.js + index-klH8HT0W.css（服务器每次部署前 rm dist 再传，历史备份 dist.old-prev1..6-* 待清理）。

## 2026-10-01 原版壁纸上墙（05fd301 + 1f313a3，部署 ⑧ 已上线）

- 用户提供**无 UI 原版画作**（仓库根 原版背景图.png，1721×914，**永不提交**）——此前「只有一部分壁纸」的根因是参考图成品图里壁纸被烘焙面板盖住约一半；原片到位后全构图上墙。
- 落地：ageha-dreamland.jpg?v=3（仅 PNG→JPEG 转码 345KB，全构图）；时钟缩略图改从原片净裁 (700,300,280,280)→2x 560×560（ageha-clock-thumb.jpg?v=3 41KB；首版裁切把 2x 坐标用在原生画布上越界出黑块，1f313a3 修正）；**DesktopBranding 恢复**（壁纸无文字了，字标/标语回 DOM 层 44%/29%，含 drop-shadow 修正版）。
- **外壳滚动锁**：html/body `overflow: clip`（OS 满视口应用禁止文档滚动；clip 才真正不可滚动，hidden 仍可被 scrollIntoView 滚动）——375px 下 absolute 底座随文档滚动致 chrome 错位的根治。
- **坑（环境级）**：Chromium 4-worker 高负载 + 375px 仿真视口会现「absolute 底座相对包含块整体偏移 -33px」的反盒模型布局态（探针实证：画布 x=0/w=375、无滚动无变换，footer left:0 right:0 却 -33；单跑/成对永不复现、视口扰动不愈）——responsive.spec 加 `retries: 2` 吸收，注释留档。
- 基线 831 前端 + 80 后端 + E2E 16/16；部署 ⑧ 新包 index-DzmKkYsS.js（旧 dist 备份 dist.old-prev6-*），六点核验 + 隧道冒烟（bgV3/branding/thumb v3 解码 560×560）全过。

## 2026-10-01 壁纸视差移除（25857d5，部署 ⑦ 已上线）

- 用户裁决「去除鼠标移动壁纸跟着动」：`useWallpaperParallax` hook + 照片/场两层调用全链删除（§15 视差项退役），壁纸静止；motion-prefs `parallax` 字段与设置「壁纸指针视差」开关退役（光晕开关保留），i18n 键清理。
- responsive E2E -21 偶发根治：开窗弹性飞行会**重放**（rerender 重启动画），旧守卫「x≥0」会在飞行穿越时误判落定——判据改为「frame 内联 transform 已清除（clearInlinePose 落定标志）+ x≥0」。
- 基线 829 前端 + 80 后端 + E2E 16/16；部署 ⑦ 新包 `index-DQyyDGGo.js`（旧 dist 备份 dist.old-prev5-*），核验 + 隧道冒烟（指针两角移动壁纸 transform 恒空、设置无视差开关）全过。

## 2026-10-01 壁纸对齐修订（a40b531，部署 ⑥ 已上线）

- 用户「壁纸与图片对齐」：湖景裁切无蝴蝶被否。几何结论——参考图中蝴蝶+品牌文字+完整湖景在任一 16:9 裁切内不可兼得（蝴蝶/文字/湖纵向跨度 770px，16:9 视口在 850px 宽裁切下只能容 ~470 行）；wallhaven/Openverse 无同风格替代、图片搜索插件不可用、无生图工具。
- 落地：壁纸换为**含蝴蝶与品牌文字的净空裁切**（参考图 x530-1380/y40-810 @2x，244KB JPEG，左界外扩 30px 使字标避开侧栏——560 起裁则字标 A 被侧栏压住），**顶部锚定**（bg-top：宽屏裁底不裁顶，超宽 2.38:1 内字标/蝴蝶完整）；**DesktopBranding DOM 层退役**（壁纸自带品牌文字，DOM 层重影——组件/测试/接线删除，i18n 键保留）。
- 代价（声明）：湖面/日辉构图让位天空/蝴蝶；烘焙文字为固定中文（壁纸画作属性）；竖屏 Portrait 下文字右半被裁（位置居中，侧栏隐藏场景，待办候选）。
- 验证：833 前端 + 80 后端 + E2E 16/16 全绿；部署 ⑥ 新包 `index-CJ9ryijN.js`+`index-Bsfi-CyY.css`，六点核验全过，服务器备份 dist.old-prev4-*；隧道冒烟 photo/bgTop/brandingGone/imgOk 全 TRUE 零错误。
- **坑（坑 50 变体）：node -e 双引号 JS 里的反引号/转义会被 shell 吃掉——HANDOFF 写入一律用 Edit 工具。**
- **坑（部署 ⑥ 热修 7f35dd1）：同名换内容的静态资产会被用户端浏览器陈旧缓存吞掉**（壁纸 URL 不变→用户「没看到更改」）——静态资产内容更新必须版本化 URL（现为 `ageha-dreamland.jpg?v=2`，常量 DEFAULT_WALLPAPER_SRC）；下次换壁纸记得再 bump 版本号。另：用户账号若持久化开启过「动态桌面」，field 场会盖住照片壁纸（设计行为）——排查「壁纸不对」先问这条。

## 2026-10-01 生产部署 ⑤ · §32 像素级还原上线（2c6bf8d）

- 钉扎清洁构建（本地 dist 先删再建）：新包 `index-BRdXxeZ7.js` + `index-BGtYpmW8.css`；壁纸资产随 public 入 dist（/wallpapers/ageha-dreamland.jpg 89715B + clock-thumb 22271B）
- 服务器旧 dist 备份 **dist.old-prev3-10011322**（rm 后原子替换；更早回滚点 dist.old-prev2/dist.old-prev 并存待清）；src/server 零改动 → **未重启**；tar exclude=server/data 前置
- 六点核验全过：① catalog keyId 082ff6625c72e40b = pin ✓ ② pin 在线上 bundle ✓ ③ index.html 引新包 ✓ ④ Caddyfile os 块 ✓ ⑤ HTTPS 200 ✓ ⑥ 两壁纸资产 200 ✓（全部 --resolve SNI）
- 隧道线上冒烟 12/12 全 TRUE + 零 console 错误：sidebar8 / 照片壁纸基底+URL / 无场 canvas / 壁纸图真实解码 / 右栏四卡 / 五菜单 / menubar 暗条 / 品牌层 / Dock 瓷贴+回收站 / 启动器分类+网格≥6；截图 .tmp/shots-s32-live/
- 冒烟账号 s32live-*（时间戳唯一）；线上截图确认：照片壁纸+瓷贴左栏+四卡右栏+品牌渐变字标+瓷贴 Dock 全部呈现

## 2026-10-01 §32 · 参考图像素级还原（本轮，已提交并随部署 ⑤ 上线）

- 用户指令升级为「像素级还原」（推翻 §31 不追清单）：照片壁纸基底常驻
  （public/wallpapers/ageha-dreamland.jpg = 参考图净空区裁切 2x）+ 动态桌面
  出厂默认关（enabled false，双门控：计划+开关）+ 出厂主题浅色；chrome 白字
  玻璃作用域 .desktop-chrome（Token 子树重映射，apps 窗口不受影响）+
  .menubar-glass 暗条 + .widget-card 蓝紫渐变；几何 Token menubar 40 /
  rail 132·336 / dock-icon 44（viewport.ts 同步）。
- 组件：左栏八项瓷贴（+用户中心）、五菜单（+编辑 execCommand）、右栏四卡
  （时钟天气/系统状态真实指标/最近通知/品牌横幅；月历收拢进时钟卡、壁纸卡
  退役）、启动器左锚定双栏 410px 七分类、Dock 常驻瓷贴+回收站（20 窗压力
  改按应用聚合语义）。
- 新模块 src/apps/app-deep-link.ts（Settings 账户/Files 回收站深链，模块级
  一次性意图，不动 window-store）。
- 测试：835 前端 + 80 后端 + E2E 16/16 全绿；E2E 右键点迁 (935,660)/
  (200,400)（§32 几何）、dynamic-desktop 重写（照片默认 opt-in 场）、
  widgets 重写（四卡）、desktop-stress 瓷贴聚合断言、responsive 面板等几何
  落定再读（waitFor 可见 ≠ 动画完成）。
- visual-judge 对照参考图 A/B 两页 pass；已知声明差异：壁纸为同源画作净空
  裁切（蝴蝶/顶部天空不可恢复）、天气行示例数据、通知空态、Dock 只含真实
  应用、右栏在壁纸亮部存在感弱（蓝紫玻璃补偿）。
- **未部署**（等用户验收）。**未跟踪资产：仓库根参考图 PNG 永不提交。**

## 2026-10-01 生产部署 ④ · Round 2 参考图对齐（93a016f，§31）

- 用户「继续吧」确认部署：钉扎构建新包 `index-BjcZZmRi.js` + `index-DVWBhHZ_.css`，原子替换（旧 dist 备份 **dist.old-prev2**；dist.old-prev 为横版 ③ 的回滚点）；前端-only 未重启
- 五点核验全过（keyId 082ff6625c72e40b = pin ✓ / pin 在 bundle ✓ / index.html 引新包 ✓ / Caddyfile os 块 ✓ / HTTPS 200 —— 服务器本机 curl 必带 --resolve SNI）
- 隧道线上冒烟六项全 TRUE：左栏 rounded-2xl 玻璃卡 / 右栏容器穿透+卡片玻璃 / 品牌层开窗隐藏 / 最小化全部后回归 / Dock 胶囊 h-16+图标 40px / 启动器 left-1/2 居中 36rem。**截图坑：最小化后立刻截图会抓到精灵飞行首帧（窗口看似未收起）——store 先提交、动效后行，断言以类名为准，截图要等 ≥400ms**
- 冒烟账号 r2live-*（时间戳唯一）；本轮 dist.old-prev（横版）/ dist.old-prev2（竖版+旧 Dock）两级回滚点并存，确认稳定后服务器可清理

## 2026-10-01 Round 2 · 参考图对齐四片（3aa2c67..93a016f，§31，已随部署 ④ 上线）

- 用户重申参考图=Visual Source of Truth +「Reference → Current → Diff → Implement」迭代法（提示词 §39 改为「直接开始不要再 Audit」）。基线三态截图对照出差异表：左右通顶贴边栏（Web Sidebar 感）/右栏整块面板（Dashboard 感）/中央无品牌焦点/Dock 22px 存在感弱/启动器左下角弹出
- 四片：R2-1 左栏圆角玻璃悬浮卡 + 右栏容器 pointer-events-none、四卡独立浮卡（**几何契约零改动**：带区 80/232 只占位）；R2-2 DesktopBranding 中央品牌层（aria-hidden+pointer-events-none，无可见窗口才显示，全最小化后回归）；R2-3 Dock token 68/52/40（σ44 ≤1.2×节距仍成立）；R2-4 启动器 left-1/2 居中 36rem 6 列（三档 36/40/42.5rem）
- **连带修复**：启动器本来就没有 Esc 关闭（旧锚定在左下角所以从没暴露）——居中后遮住商店「打开」按钮，app-store E2E 超时抓出；Esc 挂触发器+菜单共同 wrapper（焦点在按钮时 keydown 不经过 menu，挂 menu 上收不到——两版都试过错了一版）
- 不追清单（对照差异表显式放弃）：拟真壁纸/天气通知品牌卡/第五菜单/用户中心/空桌常驻 Dock/桌面图标
- 测试 101 文件 828 用例 + 80 后端 + E2E 16/16；visual-judge 对照参考图 4/4 PASS；**未部署**（等用户验收，本轮 dist 已是无环境变量构建）；遗留妆造备注：左栏标签图标下排（参考图右排）、云同步禁用态低对比

## 2026-10-01 生产部署 ③ · 应用默认窗口一律横版（3206f88，§30）

- 用户裁决「软件默认不要竖版排版，而要横版」：**三笔提交** 53554e2（lint 修复：react-hooks 7.1.x 把编译器系规则 refs/set-state-in-effect 捆进 recommended 与 recommended-latest 两预设，对 MenuBar 方向键遍历等「事件回调读 refs」模式整批误报且 HEAD 即红——钉回经典两条 rules-of-hooks + exhaustive-deps 显式启用）/ 72df727（Slice A：动态面板 360×520→680×420 + 卡片 ≥560px 双列网格）/ 3206f88（Slice B：目录 6 竖版全迁横版——时钟 480×360、便签 480×380、贪吃蛇/2048/记忆翻牌 560×420、扫雷 600×420；游戏页 ≥500px「棋盘左+右 160px 控制栏」（app 内媒体查询作用域=iframe 视口=窗口内容区，拉窄回落竖排）、时钟 ≥440px 双卡并排、便签列表天然适配零 CSS 改动；**计算器豁免**=手持计算器物理隐喻 300×440 不变）
- 契约：`src/apps/window-orientation.test.ts` 钉内置+目录两清单零竖版（豁免显式列举）；E2E 面板/时钟/便签/2048 四处「宽>高」断言；**空白右键点契约随面板新覆盖区迁移**：面板现占 344-1024×52-472，(400,400) 落进面板 → context-menu/dynamic-desktop 改 (200,400)（面板左侧、左栏 80px 右边）
- 前端-only 未重启；新包 `index-BTTfM1Zq.js` + `index-CSNoLbJs.css`（本地 dist 先重建再打包，本次无旧包累积）；五项核验全过——**坑：Caddyfile 实际在 /etc/caddy-tsuki/Caddyfile；服务器本机 curl 必须带 SNI（--resolve os.ageha.cn:443:127.0.0.1），裸 -H Host 会 SSL 握手失败（exit 35）**；隧道实测面板 677×418 横版、2048 横版（boundingBox=0.9×目标值是开窗动画中的瞬时值，waitFor 可见≠动画完成）
- 测试：100 前端文件 822 用例 + 80 后端 + E2E 16/16；visual-judge 6+1（四游戏行布局/时钟双卡/双列面板过；「Dock 缺席」为给评委的预期文案笔误——出屏常驻是 §11 既定行为，非缺陷）

## 2026-10-01 生产部署 ② · 桌面图标层移除（b4405b7）

- 用户裁决「删除桌面图标」：入口收敛至侧栏+Dock+启动器（权威图布局），桌面回归纯壁纸；DesktopIcons 组件/测试/spec、--ag-desktop-* Token、.desktop-icon-* 类、os-stagger、desktop.iconsLabel 键全链清除（DESIGN.md §29）
- 前端-only 未重启；新包 `index-Dlr8Lfxh.js`；核验 keyId/pin/index/bundle/200 全过 + 隧道确认线上无图标层、侧栏/小组件/壁纸在；E2E 16/16（17-1 删 spec）；judge 1/1 零残留
- 坑：删除「安装上桌面」契约后 app-store spec 改为断言启动器网格；context-menu 就绪信号改 sidebar-files

## 2026-10-01 生产部署 · 密度收紧档 + 涟漪移除（478837a）

- 用户裁决「组件太臃肿」：全局密度收一档（顶栏 28/图标 44/窗口头 36/Dock 56/右栏 232/卡片收紧），**48px 节距=σ44 波浪前提不变**；点击涟漪整体移除（§15/§28）
- 前端-only，未重启；新包 `index-CMZYy9kA.js`；五项核验 + 密度 CSS 线上可见（ag-menubar-height:28px）+ 隧道冒烟全过（401=登出态正常）；旧包备份 `dist.old-prev`
- 冒烟脚本坑：固定用户名二次注册会撞已存在——live-smoke 改时间戳唯一名

## 2026-09-30 生产部署 · Calm Future 视觉升级（Phase 1 + Phase 2，16 提交上线）

- **范围**：a325e1a..c017e0c（Token 2.0/氛围层/顶栏/悬浮 Dock/图标/窗口交通灯/启动器/搜索/弹层/响应式/左导航栏/右小组件栏/箭头键/Recent/92% 纸面）——纯前端，`server/` 零改动 → **未重启服务**
- **构建**：`VITE_AUTH_BACKEND=1 VITE_STORE_CATALOG_PUBLIC_KEY=c48lL/vODieWM/d/zNolkSBpa/AbAbTnUgbRtfal2SE=`；新包 `index--uHWuhVY.js` / `index-xN5NQieJ.css`
- **上传**：tar 整目录替换 `/opt/agehaos/dist`（原子 mv，旧目录备份为 `dist.old-*` 留回滚——确认稳定后可清）
- **核验**：① catalog keyId `082ff6625c72e40b` = pin ✓ ② pin 在服务端新 bundle 内 ✓ ③ index.html 引用新包 ✓ ④ Caddy os 块在 ✓ ⑤ https 200 + CSP ✓；register 400 探针/新 CSS 200 ✓
- **线上冒烟**（SSH 隧道 + host-resolver-rules，TUN 劫持期间）：登录/五层 shell（menu-bar/sidebar/widget-rail/atmosphere/wallpaper）/Dock 唤出/默认 dark 全过；唯一 console 401 = 登出态 /api/auth/session（正常）
- **§33 终审**：visual-judge 对生产截图十项全过（像 OS/有品牌/高级/克制/融合/漂浮/空间/活跃态/不像五类/无故障）
- 测试账号：calmfuture-live（冒烟注册，可留可清）
