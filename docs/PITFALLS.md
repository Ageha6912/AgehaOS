# 踩坑清单（绝对不要再踩）

> 自 HANDOFF.md §7 迁入（2026-10-02 评审 P1-5）。**编号保持原 ID 不重排**——HANDOFF/DESIGN.md/记忆中的「坑 N」引用以此为准；已退役条目在原位标注。历史编号 62 排在 66/67 之间（乱序系迁移前即存在），保持原样。


### 工具链 / 配置

1. **TS 6 禁 `baseUrl`**：路径别名只用 `paths` 相对写法。
2. **eslint-plugin-react-hooks v7**：flat config 必须用 `configs.flat['recommended-latest']`。
3. **no-unused-vars 没有 `_` 豁免**；**管道会吞 npm 退出码**——门禁脚本必须 `set -o pipefail` 再接 grep/tail。
4. **`set-state-in-effect` 规则**：effect 里不能同步 setState。标准解：`useEffect(() => { const t = setTimeout(fn, 0); return () => clearTimeout(t) }, deps)`；派生重置用 React 官方「渲染期比较 prev props setState」模式（见 NotificationToasts）。
5. **(async () => {...})() 少写尾部 `()`**：typecheck 抓不到，测试全挂。
6. **JSX 测试文件必须 `.tsx`**——`.ts` 里写 JSX 直接解析错误。
7. **heredoc 生成的 JS 会静默损坏**（`)]}`序列）——用前先 `node --check`。
8. **`git add -A` 会卷入故意不跟踪的 HANDOFF.md**——提交时显式列文件或 `git add -A ':!HANDOFF.md'`。

### 测试

9. **Zustand 单例跨测试污染**：每个 store 必须 reset；auth 用户表/会话在文件内共享——用户名每用例唯一；**`register()` 不建会话**，测资料类操作要先 `login` 再 `seedSessionForTests`。
10. **fake timers 与 RTL waitFor 会死锁**：用 `act(() => vi.advanceTimersByTime(ms))` 后直接断言。
11. **窗一级派发的 keyDown 不会经过 input 的 onKeyDown**——在目标节点上 fireEvent。
12. **zustand 在 act 外 setState 不触发 RTL 重渲染**——包 `act()`。
13. **`overflow-x-auto` 容器会裁剪 absolute 子元素**（overflow-y 隐式 auto）——溢出任务栏的浮层用 `fixed` 定位（注意 footer 的 backdrop-filter 使其成为 fixed 包含块）。
14. **IndexedDB**：jsdom 没有，用 `fake-indexeddb/auto`；本项目 VFS 探测失败自动落 MemoryAdapter，测试可直接种数据。
15. **ARIA 角色**：`<menu>` 的角色是 `list`；`<section aria-label>` 是 `region`；先看测试库报错列出的真实角色树。
16. **vitest include glob 相对 CWD 解析**，不是配置文件位置（server 配置里写的是 `server/test/**/*.test.ts`）。
17. **setState 时序**：`register()` 远程模式即登录（服务端已发 Cookie），本地模式走 login——别用 `getSession()` 探测（会撞上单例残留会话），用 `isRemoteAuthActive()`。

### 后端（Fastify / Node）

18. **插件封装**：兄弟插件不共享钩子——origin-check 这类全局钩子要直接在根实例上调用，不能 `register` 成兄弟插件。
19. **scrypt N=2¹⁵/r=8 需要显式 `maxmem: 64MiB`**：128·N·r 恰为 32MiB，Node 默认上限直接抛错。
20. **空 body + `content-type: application/json` → Fastify 400（FST_ERR_CTP_EMPTY_JSON_BODY）**：客户端只在确有 body 时声明 content-type（backend-client.request 已如此）。
21. **CSRF origin 校验依赖代理转发 `X-Forwarded-Host`**：Vite 代理已配 `xfwd: true`；换代理时要保留。
22. **Windows 防火墙静默丢弃知名端口（如 :9）的包**——「不可达」测试用「起服→取端口→关服→复用端口」确定性触发 ECONNREFUSED。
23. **CREATE TABLE IF NOT EXISTS 不会给旧表补列**——新字段用 `ALTER TABLE ... ADD COLUMN IF NOT EXISTS` 迁移。
24. **Git Bash 的 curl 把 UTF-8 中文按 GBK 发送**——测中文载荷时用 node 写文件 + `--data-binary @file`，或直接 node fetch。

### 真实浏览器 / UI

25. **标题栏 pointer capture 会吞按钮点击**：标题栏按钮必须 `onPointerDown={stopPropagation}`（WindowFrame 的 swallowPointerDown）。
26. **杀 dev server**：TaskStop 杀不死 vite 子进程，`netstat -ano | grep :PORT` 找 PID 后 `taskkill //PID <pid> //F`。
27. **窗口层（WindowLayer）必须有独立层叠上下文（z-30）**：否则窗口 zIndex 参与根层叠，第 40 个窗口会盖住任务栏（z-40）/toast 与搜索面板（z-50）。浮层一律 `fixed` + 显式 z。
28. **全局焦点环豁免用属性选择器规则**（如 `[data-testid='terminal-input']:focus-visible { outline: none }`），Tailwind 的 `focus-visible:outline-none` 工具类挡不住全局 `:where()` 规则的实际渲染。
29. **动态桌面是时间相敏感功能**：E2E/截图验证时注意时段（夜间建议池曾是空的导致 E2E 晚间必挂——现在每池都含默认安装应用）。
30. **IAB/坐标点击不稳定**：应用逻辑验证用合成点击（`el.click()` / `fireEvent.change`——`userEvent.upload` 对隐藏 input 无效），视觉用截图；可疑「bug」先用 `evaluate` 读真实 DOM 判断是不是自动化问题。

### 产品 / 流程

31. **UI 文案零硬编码**：新文案同时加 zh-CN/en（类型强制对齐）；样式只消费 Token。
32. **PRD §9 vs §10.1 已裁决**：权限白名单以 §10.1 为准，裸 `filesystem` 直接拒绝（有测试固化）。
33. **`writeFile` 是创建或覆盖语义**：新建入口必须先查重（Notes 踩过）。
34. **VFS 变更必须广播 `file.deleted` 等事件**，否则打开中的视图不刷新。
35. **用户裁决不要「修」回去**（现行裁决总表见 docs/DECISIONS.md）：①任务栏只显示图标（悬停预览出标题）；② ~~壁纸演进至真实照片~~（**已退役**：2026-09-27 裁决改 gradient-field 生成壁纸，照片域整体移除）；③终端输入无焦点环；④每个时段建议池必须含默认安装应用；⑤照片壁纸上不显示「AI 生成」徽标；⑥ 设计方向 = 蓝白渐变「精密仪表」（已被 ADR 24「Calm Future」及 §32 壁纸系列取代，DESIGN.md 仍为唯一权威）；⑦ ~~照片壁纸默认开~~（**已退役**：§32.1 出厂默认关，照片基底常驻）；⑧**动态面板进桌面自动打开**；⑨ ~~任务栏透明+自动隐藏~~（**已退役**：修订 8「Dock 常驻」）；⑩**4 个小游戏进桌面轮换打开**；⑪**品牌 logo = 用户的揚羽蝶插画 v2（透明底）**，🦋 emoji 豁免条款已随之退役；⑫**图片资产只许缩放/裁切**，背景转透明是用户逐次明确批准的例外（白底/黑底各批过一次），其余像素操作禁做。
36. **质量门亮度口径**：山水天空 stop 必须避开中间亮度带（RGB 均值 ~0.3–0.5 会同时不过深/浅墨色对比）——新调色板直接跑 `landscape.test.ts` 的门禁用例验证。照片计划不受此口径约束（走目录成员 + mood 门）。INK 常量已随 2026-09 方向翻新换冷墨值（#18202c/#e6ecf7），口径不变。
37. **烟雾脚本点「换一张」会被 5s 节流**，且交叉淡入期间新旧两层 `<img>` 并存——取 `querySelectorAll('[data-testid=wallpaper-surface-photo]')` 的最后一个，节流未过就等 4s 重试；Playwright 全新上下文没有旧用户，重新注册即可。
38. **VFS 根级目录（Desktop/Documents/…/Trash/System）在 v0.1 全部受保护**：`remove()` 对 parentId=root 一律抛 `root-protected`（`requireNotRoot`）。云同步的「清除快照外条目」对它们退化为清空内容、保留外壳。后端 file 存储落盘在 `server/data/agehaos-auth.json`（联调重置 = 杀进程 + 删 data + 重启）。
39. **设计翻新的实现契约**：渐变只上大面（`.surface-panel`/`.surface-canvas`），控件实色；数据元素（路径/计数/版本）走等宽层；开关一律 `ToggleSwitch`（role=switch 契约）；新文案双词典同步；改 Token 后质量门 INK 常量要跟着动。
40. **透明覆盖层会静默拦截指针**：WindowLayer 容器（z-30 全屏 div）曾挡住其下一切可点元素（桌面图标层被新 E2E 抓获才暴露）——纯层叠上下文用途的容器必须 `pointer-events-none`，子元素再 `pointer-events-auto`。同理 jsdom 会把内联样式的十六进制色规范化为 `rgb()`（断言渐变要断 rgb 形式）。
41. **应用视觉身份单一来源**：内置应用徽章在 `src/apps/app-badges.ts`（数据）/`app-icon.tsx`（渲染），`APP_UI_META` 已无 icon 字段——新内置应用必须两处同步登记（app-icon.test 有完整性测试卡门）。
42. **Dock 指针链契约（DESIGN.md §9；现行 = 修订 8 后 Dock 恒驻，自动隐藏机制已整体退役，`revealTaskbar` 仅为兼容立即通过）**：教训本体仍然通用——指针静止时滑入的元素不会收到 pointerenter（浏览器 hover 链只在指针移动时刷新），任何「 enter 唤出 / leave 收起」式交互都要在 move 上兜底；弹层（菜单/预览）是 footer 的 DOM 子孙，pointerleave 天然覆盖。断言用 `data-state` 属性（translate 的元素对 Playwright 仍是 visible，`toBeHidden` 会假绿）。E2E/冒烟凡任务栏交互前必须 `revealTaskbar(page)`（`e2e/helpers.ts`）；断言用 `data-state` 属性（translate 的元素对 Playwright 仍是 visible，`toBeHidden` 会假绿）。窗口层/视口不再预留任务栏高度。
43. **server 套件必须从仓库根 `npm run test:server` 跑**（在 server/ 目录直接 `npx vitest` 会拿到根配置报 No test files found）。另：Node 脚本里写 Git Bash 风格路径（/e/...）不生效，用相对路径。
44. **滚动列表一律 `ScrollFadeList`**（DESIGN.md §3）：jsdom 无布局，测溢出行为要 `Object.defineProperty` 伪造 scrollTop/scrollHeight/clientHeight 后 `fireEvent.scroll`（useSyncExternalStore 会重读快照）；真实浏览器里商店默认窗口尺寸本就轻微溢出——E2E 断言「无遮罩」前先最大化。RTL `getByRole` 的 options 没有 `exact` 字段（字符串 name 默认全匹配）；React 19 类型无 `UlHTMLAttributes`，用 `HTMLAttributes<HTMLUListElement>`。
45. **远程认证模式的登录钩子靠 `RemoteAuthClient` 广播的 user.login/logout**（174174d）：新增远程侧登录后动作挂 systemBus 监听即可，不要另起轮询；本地/远程都必须发（本地在 AuthService，远程在 RemoteAuthClient，两处语义一致）。
46. **`npx playwright test` 不构建，直接服务当前 dist**（webServer reuseExistingServer）——跑 E2E 前必须：①用**不带** `VITE_AUTH_BACKEND` 的干净构建（带 env 的 dist 会让 E2E 走远程模式而全灭）；②杀掉 :8787/:4173 残留演练进程。带 env 构建只用于部署上传。开机动画是 ~1.6s 定时器驱动——断言登录页/桌面必须 waitForSelector，networkidle 后立即查会假阴性；未登录时 /api/auth/session 401 是正常控制台错误。
47. **品牌图片资产的加工契约（DESIGN.md §10）**：母版 `public/brand/agehaos-logo-v2-master.png` 永不动；抠背景用 Playwright + canvas 泛洪（**file:// 会污染 canvas，图像必须经 vite 伺服后同源加载**）；裁切必须从**抠好透明的画布**取（从原始 img 取会把底色带回来）；阈值放宽会从玻璃白框漏进画面内部（保守全局 + 带限/局部补清是安全组合）；字标分离点 = 内容高度 62%~94% 间「不透明像素最少行」。
48. **双资产分工**：`v2-full-512`（含字标）只给开机动画等大尺寸位；`v2-mark-*`（无字标）给一切小尺寸（18px 下字标不可辨）。`BrandLogo` 组件单一来源 `BRAND_LOGO_SRC`；favicon 在 `index.html`。
49. **motion-lab boot 的回退链测试契约**：logoSrc 失败后恰好两级回退（仓库根 public → 内联 SVG data URI）——加中间回退项会让 boot.test.mjs 挂；改链必须同步改测试。
50. **bash 双引号字符串里的反引号会被命令替换吃掉**（node -e "..." 里写 JS 模板串/含反引号文本已两次翻车）——多行注入一律用 Edit 工具改文件或写临时 .mjs 脚本，不要往 `node -e "..."` 里塞复杂代码。
51. **vitest fake timers 默认连 requestAnimationFrame 一起接管**（16ms 帧距、时间戳=虚拟时钟）——`advanceTimersByTime` 可确定性驱动 rAF 引擎（boot-motion 用此法）。但它同时 fake setTimeout，**是累计时钟**：多段 advance 相加，别越过后续收尾点（boot 收尾点 ~2.77s）；且引擎的「单帧封顶 100ms」对测试里的大步长 fire 同样生效——推进时间必须 ≤100ms 步长。
52. **解构对象 getter 会即时求值一次**（测试台 `const { hasPendingFrame } = h` 拿到的是解构瞬间的值）——getter 型断言必须现读 `h.hasPendingFrame`。
53. **开机覆盖层退场期间会吞指针**：reload 后立即做任务栏交互，指针移动落在覆盖层上被吞，静止指针不再触发 hover 链（坑 42），任务栏永远唤不出——`revealTaskbar` 已内置等 `[data-testid="boot-screen"]` 卸载，凡 reload 后与桌面交互的路径都要过它。
54. **PRD §29.1 三秒恢复预算含应用加载时间**：开机时长（`BOOT_DURATION_MS`，现 2.2s）改动会直接撞 `desktop-stress.spec.ts` §29.1——调时长先想这条，`boot-motion.test` 对归档值有钉扎。
55. **React className 断言单一类用 `classList.contains`**：`className.toContain('hidden')` 会撞上 `overflow-hidden` 子串（正断言假绿、负断言假红都有可能）。
56. **WAAPI 正放中的位姿读 `getComputedStyle`**：`el.style.transform` 只反映内联样式，动画驱动期间是空——飞行断言/烟雾脚本都要读 computed 值。
57. **lib.dom `Keyframe` 带字符串索引签名**（`string | number | null | undefined`）：自定义关键帧接口加同款索引签名后可直接赋给 `el.animate`（`unknown` 不行）；`motion-lab` 侧的 `as Keyframe[]` 强转在产品里不需要。
58. **窗口动效的状态语义**：store 先行提交、动效纯表现层（最小化飞行用 inline display:flex 反压 `hidden` 类，落定 clearInlinePose 交还）；**关闭 = store 立即提交 + ghost 快照续播退场**（`closing-ghosts.ts`，aria-hidden 不抢可达树；早期「飞完才提交」方案有 120ms 可达树撞车竞态，sdk-fs-note E2E ~50% 复现，已根除）；WindowLayer 按 id 稳定序渲染（focus 的 zIndex 变化不得引发 insertBefore 重排——节点移动会打断进行中的点击事件序列：pointerdown 命中按钮、mousedown 落到 body）；半途抓回走 `anim.reverse()` 换绑落定动作；改窗口关闭/最小化路径前先读 DESIGN.md §12。
59. **E2E「Page console 事件只在 trace 里有」**：页面内 console.error 不会打到 runner stdout——要在失败后看页面探针，得从 `test-results/*/trace.zip` 的 trace JSONL 里捞 `type:'console'` 事件；探针必须用 console.error（log 级不入 trace）。
60. **npm run build = tsc --noEmit && vite build**：e2e/*.spec.ts 里的 TS 错误会让 build 静默失败（输出被 `>/dev/null 2>&1` 吞掉时尤甚）——临时调试 spec 会拖垮所有后续「带构建」的实验；调试 spec 用完即删，构建失败先看 tail 全输出。
61. **调试要「改一层探一层」**：本竞态前后用了 5 层证据（失败截图 → stash 二分 → trace 动作序列 → 页面 console 探针 → MutationObserver/点击目标捕获）才定位；纯推理（launchApp/权限/MissingApp）三次全猜错，直接证据一次命中。
63. **桌面空白点击的实际 target 是壁纸层**：WallpaperLayer（absolute inset-0）盖住画布根，空白点击/交互的 target 是壁纸子元素——桌面级委派监听（涟漪等）要用「target 是宿主或 closest 壁纸层」判定，且桌面内跨元素移动不触发 pointerenter（兜底点亮要点在 move 上），两条都由烟雾脚本抓到。
64. **部署三铁律（2026-09-27 事故换来的）**：① tar 的 `--exclude` 必须放在文件参数**之前**（放后面是 positional、无效且 tar 仍会打完整包——旧流程就这样把本地 server/data 覆盖到了生产）；② 部署后必须核对 `/api/store/catalog` 的 keyId 与前端 pin 一致（200 不代表验签通过——keyId 被覆盖后目录照样 200，直到客户端验签才发现）；③ Caddyfile 是用户另行维护的活文件，每次部署先 `grep os.ageha.cn` 确认站点块还在（块丢了 = 整站 TLS 挂，Caddy 日志只会安静地没有该域名的续期记录）。查这类问题：`openssl s_client -connect 127.0.0.1:443 -servername os.ageha.cn` 秒级定位是 TLS 层还是路由层。
65. **⚠️ 部署后严禁在服务器跑 `npm install --omit=dev`（2026-09-28 生产事故）**：tsx 在 devDependencies 里且正是 systemd ExecStart 的二进制——omit=dev 会把它连根删掉，服务 203/EXEC 崩溃循环。新依赖的正确部署姿势：本地 `npm install ioredis` 进 dependencies → 随 tar 上传 package.json → **服务器跑完整 `npm install`（不带 --omit=dev）**。本次宕机约 2 分钟，靠全量 npm install 恢复。
66. **ZCode 内置浏览器（IAB）面板会把 rAF 整体节流到 0**（2026-09-28 实测：1.5s 内 0 帧、visibility 仍报 visible）——rAF 驱动的 boot 开机屏永远停在 0%，skip 交互也不可靠，`animate()`/WAAPI 同样不可信。**需要浏览器烟雾时直接用仓库 Playwright 写 `.tmp/` 临时脚本**（E2E 13 条能过即证明其 rAF 正常），别在 IAB 里验证动效类功能；demo 桩上游（如 LLM 无 key）用 `page.route` fulfill，被测端点用 `route.continue()` 透传真后端，即可测「真实落库」。另：IAB 的 rAF 节流是环境限制不是产品 bug——判断依据是 E2E 同构建同流程全绿。
62. **fake timers 会冻结退场相位计时器**：有退场动画的组件在 fake-timer 测试里若靠 setTimeout 卸载，节点将永远挂着、污染文本计数类断言——pop-motion 的 `useExitPhase` 在无 WAAPI 运行时（jsdom）直接跳过退场停留（保持旧即时卸载语义），新增同类动效务必带上这条降级；react-hooks/refs + 坑 4 的组合（测量进 ref、结果延迟一拍进 state、渲染只读 state）是浮层测量的合规格写法。
67. **backdrop-filter 会劫持 fixed 后代的包含块（坑 13 家族，2026-10-01 三次变体）**：玻璃胶囊/玻璃面板（`surface-glass`）内的 fixed 弹层会被面板偏移整体推出屏（启动器菜单 375px 溢出、悬停预览被推到屏幕右缘）——**fixed 弹层一律 `createPortal` 至 body + 显式 bottom 定位**（portal 后 `bottom-full` 相对视口=屏顶，必须写显式 bottom 值）；absolute 弹层（UserMenu/NotificationCenter）不受影响。
68. **层叠上下文内单窗口 z 逾越不了容器**：最大化窗口要盖过 z-40 chrome（菜单栏/Dock/浮层栏）必须抬 WindowLayer **整层**（z-30→z-[45]，退场 ghost 一并计入防层闪）；普通窗口拖拽钳制（`getWorkspaceViewport` 扣栏）与最大化几何相互独立。
69. **transform 缩放会撑出滚动容器的可滚动区域**：波浪把 48px 图标放大到 1.5×（72px > 行高 64px），`overflow-x-auto` 行（overflow-y 计算值 auto）的滚动条随悬停闪现——`.no-scrollbar`（scrollbar-width:none + webkit display:none）隐藏滚动条 UI、保留滚轮滚动与 scroll 事件。
70. **「部署后浏览器看不到变化」双根因**：①同名静态资产换内容被陈旧缓存吞掉——URL 版本化（`ageha-dreamland.jpg?v=N`，换图必 bump）；②Caddy 首页无 no-cache 头——`header / Cache-Control "no-cache"`（`/index.html` matcher 不命中 `/` 路径）。
71. **用户系统开启「减弱动态效果」时 prefers-reduced-motion 会抑制全部动效**（波浪/光晕/进阶炫技/弹层动画全部静默）——用户报告「动效没有了」先问这条系统设置，再查代码；产品侧所有动效都必须保留 reduced-motion 降级（a11y 铁律，不许为修报告而移除）。
72. **羽化沙箱运行时实测教训（2026-10-02 P0 spike，Chromium/localhost loopback）**：① `sandbox="allow-scripts"` 不透明 origin 里，CSP `'self'` 按**文档 URL 的 origin** 解释（CSP3 语义）——外链 runner **不会被 CSP 拒**（无「Refused to load」违规），实测拦截发生在其下的网络层（opaque origin → loopback 触发 Chromium 私有网络访问/PNA 的 CORS 拦截）；外链形态因此受环境与浏览器支配，裁决 runner **内联**进 eclosion.html（`'unsafe-inline'` 稳定放行 + 坑 70 缓存）。② runner 源文件（eclosion-runner.js）与 html 内联副本必须逐字节一致（`eclosion-runner.test.ts` 钉死），且源文件里**任何位置都不能写字面脚本结束标签序列**——注释里写也会截断内联副本。③ Chromium 的 `sendBeacon` 被 connect-src 拦截时**仍返回 true**（入队之后、出网之前拦截）——验证禁网看「请求是否真的出网」（page.route 命中计数），别信返回值。④ 不透明 origin iframe 里的 CSP 违规控制台消息**不经 page.on('console') 上浮**——e2e 断言用行为级探测 + 零出网计数，别断言违规文本。⑤ 上游模型选型与首字/总时长/思考字数对照仍待真实 Key 手工 spike（本切片无 Key，未测——勿引用任何未测数据）。⑥ `<template>` 增量挂载 + 收尾破茧的样本兼容性：`e2e/eclosion-runtime.spec.ts` 以真实 html-stream 切分器驱动 event-counter（事件绑定类：点击计数改写生效）与 canvas-game（canvas 类：主循环与键盘监听可用）两份样本均通过——但这是 2 份手工样本，设计 §4.3 要求的「10 份真实生成样本」须待真实 Key 的 LLM 输出补测（与 ⑤ 同因）。
73. **服务端 SSE/长请求的「客户端断开」检测必须挂在 response 上（Node ≥16）**：`request.raw` 的 `close` 事件在**请求体读毕**就会 emit（与连接状态无关，POST + JSON body 场景即触发）——挂在 request 上会在上游调用前就误判断开、把每个流都秒中止（light-my-request 的 mock request 不发这个早 close，inject 测试全绿也发现不了，只有真 socket 测试能抓到）。正确写法：`reply.raw.on('close', () => { if (!reply.raw.writableEnded) abort() })`。同切片另修一处单飞锁 check-then-act 竞态：先读缓存再抢锁，对端恰在两步之间写完缓存并释放锁时，等待者会抢到锁重复生成——必须 acquire 成功后再补读一次缓存（regenerate 除外，其语义就是弃缓存）。
74. **createPortal 到 body 的弹层若其宿主组件住在窗口标题栏里，pointerdown 会被拖拽处理器劫持（2026-10-03 E2E 实测）**：React portal 的事件**经 React 树冒泡**（不是 DOM 树）——羽化举报同意框（`EclosionTitleExtras` 内 `createPortal(…, document.body)`）的按压会触发标题栏 `onTitlePointerDown`，后者 `setPointerCapture(header)` 把后续 `pointerup`/`click` **重定到标题栏**，弹层按钮的 `onClick` 永远收不到（真实浏览器里取消/确认双双失效；`fireEvent.click` 直发 click 的单测发现不了，只有真指针序列的 E2E 能抓到）。守卫：`if (!event.currentTarget.contains(event.target as Node)) return`——只劫持物理命中标题栏自身的按压（portal 子树不是标题栏的 DOM 后代）。同族教训：标题栏内按钮一律 `onPointerDown` stopPropagation（红绿灯先例）只能护住按钮自身，护不住从它 portal 出去的弹层。
75. **E2E 重开窗口后按 URL 定位 iframe 会撞上退场 ghost 的旧 iframe（2026-10-03 羽化 E2E 实测）**：窗口关闭是「store 立即提交 + ghost 快照续播退场」（坑 58），退场期间旧 iframe 仍挂在 DOM——`page.frame({ url: /eclosion\.html/ })` 在重开后的用例里偶发解析到 ghost 的旧帧（三 spec 合跑 2/5 失败、点击类断言假红）。重开/多窗口场景一律锚定**目标窗口自身**的 iframe：`reopened.locator('iframe').contentFrame()`；`page.frame({ url })` 只适合页面生命周期内唯一该帧的首次定位。
76. **上游模型「思考失控」会让流式生成永远超时，且首块延迟测试发现不了（2026-10-03 生产实测）**：`deepseek-v4-flash-vision` 经 tsuki 中转（OpenAI 兼容）生成完整应用时思考无界——240s 内吐出 1.3–2MB 的 `delta.reasoning_content`、正文零字节，`reasoning_effort:"low"` 与去掉该参数两种形态同样失控（中转接受了参数但上游不尊重）；表现为全部 `ai-timeout`（240002ms 整点）。**验证教训**：① 小 `max_tokens`（16/800）的烟雾测试会「成功」——预算太小强行掐停失控思考、finish_reason=length，掩盖问题；② `head -c`/`tail -c` 截断管道会让 curl 提前退出，只测到**首块延迟**而非完整生成耗时——换模型必须测「到 [DONE] 的完整耗时 + finish_reason + content 非空」；③ 判别法：超时审计 `ms` 恰等于 TIMEOUT_MS、reasoning 流量巨大而 content 为零 = 思考失控，与网络/参数无关，直接换模型。当日裁决：回退 `claude-sonnet-4-5`（70s/46k thinkChars/3201B 稳定可用），drop-in 不带 reasoning_effort（保持与验证过的成功配置逐字一致）。
