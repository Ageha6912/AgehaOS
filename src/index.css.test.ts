import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

/*
 * Token 2.0 契约（docs/DESIGN.md §2 唯一权威）：钉住 src/index.css 必须
 * 提供的设计 Token 集合与关键别名，防止后续重构静默丢 Token 或破坏
 * v1 兼容别名。样式值本身不在本测试断言范围（属 DESIGN.md 表格）。
 */
const css = readFileSync(join(process.cwd(), 'src', 'index.css'), 'utf8')
/* 空间化地基契约（src/styles/spatial.css，--sp-* 命名空间）：令牌双主题、
 * 玻璃基规则、深度/浮动增量与两处实色兜底的自持源序，同读源文本钉扎。 */
const spatial = readFileSync(join(process.cwd(), 'src', 'styles', 'spatial.css'), 'utf8')

function block(open: string): string {
  const start = css.indexOf(open)
  const end = css.indexOf('\n}', start)
  return start >= 0 && end > start ? css.slice(start, end) : ''
}

const root = block(':root {')
const dark = block('.dark {')
const theme = block('@theme inline {')

function spatialBlock(open: string): string {
  const start = spatial.indexOf(open)
  const end = spatial.indexOf('\n}', start)
  return start >= 0 && end > start ? spatial.slice(start, end) : ''
}

const spRoot = spatialBlock(':root {')
const spDark = spatialBlock('.dark {')

function has(scope: string, name: string): boolean {
  return new RegExp(`--${name}:`).test(scope)
}

describe('index.css token contract (Token 2.0)', () => {
  it('defines the v2 semantic surface/text/border tiers in both themes', () => {
    for (const name of [
      'ag-surface-soft',
      'ag-surface-elevated',
      'ag-surface-popover',
      'ag-surface-modal',
      'ag-text-tertiary',
      'ag-text-disabled',
      'ag-border-subtle',
      'ag-border-strong',
    ]) {
      expect(has(root, name), `${name} in :root`).toBe(true)
      expect(has(dark, name), `${name} in .dark`).toBe(true)
    }
  })

  it('defines the shadow/blur/scrim scales and shell geometry', () => {
    for (const name of [
      'ag-shadow-soft',
      'ag-shadow-panel',
      'ag-shadow-float',
      'ag-shadow-dock',
      'ag-shadow-popover',
      'ag-shadow-modal',
      'ag-blur-sm',
      'ag-blur-md',
      'ag-blur-lg',
      'ag-blur-xl',
      'ag-blur-2xl',
      'ag-scrim',
      'ag-scrim-strong',
      'ag-radius-pill',
      'ag-menubar-height',
      'ag-dock-height',
      'ag-dock-gap',
      'ag-dock-item-pitch',
      'ag-dock-icon',
      'ag-glass-bg-strong',
      'ag-tooltip-bg',
    ]) {
      expect(has(root, name), `${name} in :root`).toBe(true)
    }
  })

  it('defines the accent family and info state', () => {
    for (const name of [
      'ag-accent-blue',
      'ag-accent-indigo',
      'ag-accent-violet',
      'ag-accent-cyan',
      'ag-accent-pink',
      'ag-info',
    ]) {
      expect(has(root, name), `${name} in :root`).toBe(true)
      expect(has(dark, name), `${name} in .dark`).toBe(true)
    }
  })

  it('keeps v1 tokens as live aliases (not removed, not hardcoded duplicates)', () => {
    expect(root).toMatch(/--ag-surface-raised:\s*var\(--ag-surface-soft\)/)
    expect(dark).toMatch(/--ag-surface-raised:\s*var\(--ag-surface-soft\)/)
    expect(root).toMatch(/--ag-brand:\s*var\(--ag-primary\)/)
    expect(dark).toMatch(/--ag-brand:\s*var\(--ag-primary\)/)
  })

  it('anchors the radius scale and glass blur to raw tokens', () => {
    expect(root).toMatch(/--ag-radius-sm:\s*8px/)
    expect(root).toMatch(/--ag-radius-md:\s*12px/)
    expect(root).toMatch(/--ag-radius-lg:\s*16px/)
    expect(root).toMatch(/--ag-radius-xl:\s*20px/)
    expect(root).toMatch(/--ag-glass-blur:\s*var\(--ag-blur-lg\)/)
    // 顶栏高度与 viewport.ts 的 MENUBAR_HEIGHT_PX 常量互指（§19；Shell 2.0
    // 精修 32px：h-7(28px) 触发器 + 上下 2px 呼吸）。
    expect(root).toMatch(/--ag-menubar-height:\s*32px/)
    // 左侧 Workspace Rail 宽度与 RAIL_LEFT_WIDTH_PX 常量互指（§26；Shell
    // 3.0 STEP 1 窄轨浮岛 80px = 44px 圆钮 ×2 + 呼吸，内容宽 72px）。
    expect(root).toMatch(/--ag-rail-left-width:\s*80px/)
    // Workspace Panel 展开态宽度（Shell 3.0 STEP 2 引入 324px；Shell 3.1
    // STEP 1 F1 减重收敛至 312px，280-320 带内、内容列 304px）——纯浮层
    // 几何：窗口布局钳制仍钉 RAIL_LEFT_WIDTH_PX=80，viewport.ts 常量与
    // 窗口几何不随展开迁移。
    expect(root).toMatch(/--ag-rail-left-expanded-width:\s*312px/)
    // 右侧小组件栏宽度与 RAIL_RIGHT_WIDTH_PX 常量互指（§27；2026-10-01
    // 用户裁决收窄至 296px）。
    expect(root).toMatch(/--ag-rail-right-width:\s*296px/)
    // §31 Round 2：Dock 胶囊 68px 恒驻；Shell 2.0 离底 20px、图标 48px
    // （节距 56 = 48 + gap-2 8px，波浪 σ44 ≤ 1.2×56 仍成立）；Shell 3.0
    // STEP 6 胶囊圆角 24px（§33.2 档，全 pill 退役）。
    expect(root).toMatch(/--ag-dock-height:\s*68px/)
    expect(root).toMatch(/--ag-dock-gap:\s*20px/)
    expect(root).toMatch(/--ag-dock-item-pitch:\s*56px/)
    expect(root).toMatch(/--ag-dock-icon:\s*48px/)
    expect(root).toMatch(/--ag-dock-radius:\s*24px/)
  })

  it('scopes the desktop chrome white-on-glass material (sec 32)', () => {
    expect(css).toContain('.desktop-chrome')
    const scope = css.slice(css.indexOf('.desktop-chrome'), css.indexOf('.surface-panel'))
    // 白字 Token 阶 + 低透白玻璃 + 深玻璃弹层 remap + 降透明实色兜底。
    expect(scope).toMatch(/--ag-text:\s*#ffffff/)
    // 2026-10-05 用户裁决：原毛玻璃样式保留、玻璃底透明度调高 14%→8%。
    expect(scope).toMatch(/--ag-glass-bg:\s*rgb\(255 255 255 \/ 8%\)/)
    // 弹层不再继承白字 26% 白玻璃（实测 1.7-2.7:1）：改由纸面块重声明。
    const rule = css.slice(css.indexOf('.desktop-chrome {'), css.indexOf('}', css.indexOf('.desktop-chrome {')))
    expect(rule).not.toMatch(/--ag-glass-bg-strong/)
    // :root 别名在声明处求值、子树不重算：作用域内必须显式重声明，否则
    // hover:bg-surface-raised 会落成 :root 的近白实色（菜单栏铃铛白圆斑）。
    expect(rule).toMatch(/--ag-surface-raised:\s*rgb\(255 255 255 \/ 16%\)/)
    // 顶栏/左栏双岛玻璃底（2026-10-05 用户裁决：原样式保留、透明度调高
    // 14%→8%；Dock/右栏卡有各自底色不受影响）。
    expect(rule).toMatch(/--ag-glass-bg:\s*rgb\(255 255 255 \/ 8%\)/)
    expect(rule).toMatch(/--ag-brand:/)
    expect(scope).toMatch(/--ag-surface-popover:\s*#2c3a63/)
  })

  it('re-declares paper tokens on popovers and widget cards (UI review P0-1)', () => {
    const paperAt = css.indexOf('.chrome-paper,')
    expect(paperAt).toBeGreaterThan(0)
    const paper = css.slice(paperAt, css.indexOf('}', paperAt))
    // 2026-10-06 亮度裁决：展开面板底部追平卡片亮白后，面板浅纸作用域
    // （.panel-paper）并入同一组声明——白底上必须墨字。
    expect(paper).toMatch(
      /\.popover-panel,\s*\.glass-popover,\s*\.widget-card,\s*\.panel-paper\s*\{/,
    )
    // 墨字 + 白玻璃；别名（surface-raised）必须显式重声明，不能靠 :root 别名。
    expect(paper).toMatch(/--ag-text:\s*#18202c/)
    expect(paper).toMatch(/--ag-text-muted:\s*#43526a/)
    expect(paper).toMatch(/--ag-surface-raised:/)
    expect(paper).toMatch(/--ag-brand:\s*#2f5fe8/)
    expect(paper).toMatch(/--ag-glass-bg-strong:\s*rgb\(255 255 255 \/ 86%\)/)
    expect(paper).toMatch(/text-shadow:\s*none/)
    // 深色主题 = 冷墨玻璃 + 浅字。
    const darkAt = css.indexOf('.dark .chrome-paper,')
    const darkPaper = css.slice(darkAt, css.indexOf('}', darkAt))
    expect(darkPaper).toMatch(/--ag-text:\s*#e6ecf7/)
    expect(darkPaper).toMatch(/--ag-glass-bg-strong:\s*rgb\(16 23 40 \/ 86%\)/)
    // 纸面块只发 Token，不碰玻璃声明：必须位于玻璃兜底之后、互不干扰。
    expect(paper).not.toContain('backdrop-filter')
    expect(paperAt).toBeGreaterThan(css.indexOf('.surface-glass {'))
  })

  it('puts the menubar on the same light chrome glass as the islands (2026-10-05 裁决)', () => {
    // 顶栏不再有独立暗条材质：与左栏双岛同吃 chrome --ag-glass-bg（白 8%）
    // + glass-hint blur，白字可读性由 desktop-chrome 的 text-shadow 兜底；
    // 组件侧钉扎在 MenuBar.test / Desktop.test。
    expect(css).not.toContain('.menubar-glass')
  })

  it('lights sidebar tooltips with an unlayered rule (Tailwind utilities cannot beat opacity:0)', () => {
    expect(css).toMatch(/\.group:hover \.os-tooltip,\s*\.group:focus-visible \.os-tooltip\s*\{\s*opacity:\s*1;/)
  })

  it('draws a two-tone focus ring that survives any backdrop', () => {
    expect(root).toMatch(/--ag-focus-ring:\s*#2f5fe8/)
    expect(root).toMatch(/--ag-focus-halo:\s*#ffffff/)
    expect(css).toMatch(/outline:\s*2px solid var\(--ag-focus-ring\)/)
    expect(css).toMatch(/box-shadow:\s*0 0 0 2px var\(--ag-focus-halo\)/)
  })

  it('exempts self-focused inputs (terminal / Ctrl+K search) from the global ring', () => {
    // 终端与搜索面板本身就是焦点上下文（光标已指示输入位）；豁免必须写
    // 在 index.css 未分层区（工具类在 @layer utilities 必败，§0.3）。
    // 搜索输入须同时中和 box-shadow——全局焦点环是 outline + halo 双环。
    expect(css).toMatch(
      /\[data-testid='terminal-input'\]:focus-visible\s*\{\s*outline:\s*none;/,
    )
    expect(css).toMatch(
      /\[data-testid='search-input'\]:focus-visible\s*\{\s*outline:\s*none;\s*box-shadow:\s*none;/,
    )
  })

  it('defines the widget Acrylic knobs (sec 32, 用户可调模糊/遮罩)', () => {
    // 模糊半径 8px（3px 时壁纸细节透字，UI 评审 P0-1 提到 8px）+ 白纱遮罩
    // 配墨字；.widget-card 消费双旋钮，降透明回落纸面实色。
    expect(root).toMatch(/--ag-widget-blur:\s*8px/)
    expect(root).toMatch(/--ag-widget-tint:\s*linear-gradient\(/)
    // 主规则是文件中最后一个 .widget-card（前面是降透明/@supports 兜底块）。
    const widget = css.slice(css.lastIndexOf('.widget-card'), css.lastIndexOf('.widget-card') + 400)
    expect(widget).toMatch(/backdrop-filter:\s*blur\(var\(--ag-widget-blur\)\)/)
    expect(widget).toMatch(/background:\s*var\(--ag-widget-tint\)/)
    // 墨字 Token 由纸面块提供（见 paper 用例）；降透明回落纸面实色而非藏青。
    expect(css).toMatch(
      /prefers-reduced-transparency[\s\S]{0,400}\.widget-card\s*\{[^}]*var\(--ag-surface-popover\)/,
    )
  })

  it('defines the unified popover-panel material (sec 24)', () => {
    expect(css).toContain('.popover-panel')
    expect(css).toMatch(/\.popover-panel\s*\{[\s\S]*?--ag-radius-lg/)
  })

  it('keeps app paper at the ruled 92% translucency (sec 21 P2-6)', () => {
    expect(root).toMatch(/--ag-panel:\s*[\s\S]*92%/)
    expect(dark).toMatch(/--ag-panel:\s*[\s\S]*92%/)
    expect(css).toMatch(/\.surface-panel\s*\{[\s\S]*?var\(--ag-surface\) 92%/)
    expect(css).toContain('prefers-reduced-transparency')
  })

  it('defines theme-independent traffic light tokens mapped to utilities', () => {
    for (const name of ['ag-wl-close', 'ag-wl-min', 'ag-wl-max']) {
      expect(has(root, name), `${name} in :root`).toBe(true)
    }
    for (const name of ['color-wl-close', 'color-wl-min', 'color-wl-max']) {
      expect(has(theme, name), `${name} in @theme inline`).toBe(true)
    }
  })

  it('themes the desktop atmosphere layer (ambient light + vignette)', () => {
    expect(has(root, 'ag-atmosphere-ambient')).toBe(true)
    expect(has(dark, 'ag-atmosphere-ambient')).toBe(true)
    expect(has(root, 'ag-atmosphere-vignette')).toBe(true)
    expect(has(dark, 'ag-atmosphere-vignette')).toBe(true)
    expect(css).toContain('.atmosphere-layer')
  })

  it('exposes the v2 tiers and scales through @theme inline utilities', () => {
    for (const name of [
      'color-surface-soft',
      'color-surface-elevated',
      'color-surface-popover',
      'color-surface-modal',
      'color-text-tertiary',
      'color-text-disabled',
      'color-border-subtle',
      'color-border-strong',
      'color-brand',
      'color-info',
      'color-scrim',
      'color-scrim-strong',
      'color-accent-violet',
      'radius-xl',
      'shadow-soft',
      'shadow-panel',
      'shadow-float',
      'shadow-dock',
      'shadow-popover',
      'shadow-modal',
    ]) {
      expect(has(theme, name), `${name} in @theme inline`).toBe(true)
    }
  })

  it('keeps the glass material fallbacks on the popover surface token', () => {
    const glass = css.slice(css.indexOf('.surface-glass'), css.indexOf('/*\n * Scroll thin'))
    expect(glass).toContain('var(--ag-surface-popover)')
  })

  it('pins the seven-face material ladder with pairwise-distinct blur steps (shell 2.0 §4.1)', () => {
    // blur 阶梯（浅/深主题同值）：widget 8（Acrylic 特例族）< menubar 12 <
    // rail 20 < dock 28 < window 36 < popover 44；modal = 实色无 blur（材质
    // 终点，第七面互异由「实色」承担）。逐格互异 = 递进成立的量化前提。
    const blurPx = [
      'ag-widget-blur',
      'ag-blur-sm',
      'ag-blur-md',
      'ag-blur-lg',
      'ag-blur-xl',
      'ag-blur-2xl',
    ].map((name) => Number(root.match(new RegExp(`--${name}:\\s*(\\d+)px`))?.[1]))
    expect(blurPx).toEqual([8, 12, 20, 28, 36, 44])
    expect(new Set(blurPx).size).toBe(blurPx.length)
    // modal 面唯一实色（100% 不透明 hex，无 blur 档）。
    expect(root).toMatch(/--ag-surface-modal:\s*#ffffff/)
    expect(dark).toMatch(/--ag-surface-modal:\s*#1a2540/)
    // shadow 阶梯双主题成对：float（rail 12%）与 dock（胶囊 18%）专用档。
    expect(root).toMatch(/--ag-shadow-float:\s*0 12px 32px rgb\(18 32 62 \/ 12%\)/)
    expect(root).toMatch(/--ag-shadow-dock:\s*0 20px 56px rgb\(18 32 62 \/ 18%\)/)
    expect(dark).toMatch(/--ag-shadow-float:\s*0 12px 32px rgb\(0 0 0 \/ 34%\)/)
    expect(dark).toMatch(/--ag-shadow-dock:\s*0 20px 56px rgb\(0 0 0 \/ 50%\)/)
    // tooltip 冷墨芯片底：主题无关常量（同红绿灯 --ag-wl-*，只入 :root）。
    expect(root).toMatch(/--ag-tooltip-bg:\s*rgb\(18 26 44 \/ 92%\)/)
  })

  it('orders the shell 2.0 glass materials between the glass base rule and the fallbacks', () => {
    // 下界锚 = glass 基规则形态（区别于文件头注释里的裸类名字样）；上界 =
    // 其后首个降透明兜底。一切新玻璃材质必须夹在两界之间——源序即降级，
    // 兜底块在后必胜（根因 B）。
    const base = css.indexOf('.surface-glass {')
    const fallback = css.indexOf('prefers-reduced-transparency', base)
    expect(base).toBeGreaterThan(0)
    expect(fallback).toBeGreaterThan(base)
    for (const marker of ['.glass-hint', '.glass-veil', '.panel-frost', '.glass-raise', '.glass-deep', '.window-glass-focus', '.dock-glass', '.glass-popover']) {
      const at = css.indexOf(marker)
      expect(at, `${marker} after the glass base rule`).toBeGreaterThan(base)
      expect(at, `${marker} before the reduced-transparency fallback`).toBeLessThan(fallback)
    }
    // 深玻璃块内容：strong 玻璃底 + 44px blur（glass-popover 类名全文件唯一）。
    const deepAt = css.indexOf('.glass-popover')
    const deep = css.slice(deepAt, deepAt + 200)
    expect(deep).toContain('var(--ag-glass-bg-strong)')
    expect(deep).toContain('blur(var(--ag-blur-2xl))')
  })
  it('keeps the legacy popover-panel block free of glass declarations (fallback trap)', () => {
    // 原块（border/radius/shadow 三件套）位于兜底之后——若在其体内扩
    // backdrop-filter，降级环境会静默带上 44px 半透玻璃（根因 B 回归点）。
    // 必须 lastIndexOf：插入深玻璃选择器组后 indexOf 会先命中组员
    // '.popover-panel,'，其切片必含 backdrop-filter → 断言恒红、意图不可实现。
    const legacyAt = css.lastIndexOf('.popover-panel')
    expect(legacyAt).toBeGreaterThan(css.indexOf('.glass-popover'))
    expect(css.slice(legacyAt, legacyAt + 400)).not.toContain('backdrop-filter')
    expect(css.slice(legacyAt, legacyAt + 200)).toMatch(/--ag-radius-lg/)
  })

  it('defines the strong glass material in both themes', () => {
    // 浅=白86% / 深=墨84%；chrome 弹层由纸面块重声明（上方 paper 用例）。
    expect(root).toMatch(/--ag-glass-bg-strong:\s*rgb\(255 255 255 \/ 86%\)/)
    expect(dark).toMatch(/--ag-glass-bg-strong:\s*rgb\(16 23 40 \/ 84%\)/)
  })

  it('defines the shell 3.0 focused-window face and shadow tiers in both themes', () => {
    // STEP 7 深度层级：聚焦窗口 = 更高面实度（72% 基底 < 84% < 弹层 strong
    // 86%，只提实度不加色相——active 禁止整体变蓝）+ 更强大气软影（flat <
    // window < window-active 递进）；失焦窗口沿用基底玻璃与 flat 档。
    expect(root).toMatch(/--ag-window-face-active:\s*rgb\(255 255 255 \/ 84%\)/)
    expect(dark).toMatch(/--ag-window-face-active:\s*rgb\(16 23 40 \/ 78%\)/)
    expect(root).toMatch(/--ag-shadow-window-active:\s*0 24px 64px rgb\(18 32 62 \/ 20%\)/)
    expect(dark).toMatch(/--ag-shadow-window-active:\s*0 24px 64px rgb\(0 0 0 \/ 52%\)/)
    expect(has(theme, 'shadow-window-active'), 'shadow-window-active in @theme inline').toBe(true)
    // 聚焦面增量类只换 background（blur/兜底全部继承 surface-glass 基规则）。
    const at = css.indexOf('.window-glass-focus')
    expect(css.slice(at, at + 120)).toContain('background: var(--ag-window-face-active)')
    expect(css.slice(at, at + 200)).not.toContain('backdrop-filter')
  })

  it('bans the -webkit-backdrop-filter prefix everywhere (root cause A)', () => {
    // 源码出现 -webkit- 前缀会被构建链剥掉标准属性 → 全应用玻璃模糊失效。
    // 前缀由 Lightning CSS 构建期自动补，源码只写标准属性。
    expect(css).not.toContain('-webkit-backdrop-filter')
  })

  it('keeps the wave transition base and retires the hover strong lift（2026-10-05 终态：波浪唯一浮起）', () => {
    // 波浪引擎直写 inline transform（rAF 逐帧），基态 220ms transform 过渡
    // 提供轻阻尼与离开软回落；2026-10-02 的悬停强浮起规则（-3px/1.18 +
    // 光晕，(hover:hover) 媒体块）已随波浪恢复裁决一并退役。
    const baseAt = css.indexOf('[data-wave-icon] {')
    expect(baseAt).toBeGreaterThan(-1)
    const baseRule = css.slice(baseAt, baseAt + 160)
    expect(baseRule).toContain('transition:')
    expect(baseRule).toContain('transform 220ms var(--ag-motion-ease)')
    expect(css).not.toContain('button:hover > [data-wave-icon]')
    expect(css).not.toContain('translateY(-3px) scale(1.18)')
    expect(css).not.toContain('drop-shadow(0 4px 10px rgb(47 95 232 / 28%))')
  })

  it('styles the sidebar tooltip as a glass ink chip with slide-in (2026-10-02 裁决「太简陋」)', () => {
    // 玻璃冷墨芯片：blur + 细描边 + 顶缘高光 + 分层软影；浮现 = 淡入 + 4px
    // 右滑微动（基态 translateX(-4px) → 亮起归位）；backdrop-filter 只写
    // 标准属性（坑 A）。定位 translateY(-50%) 两个状态都必须保留。
    const at = css.indexOf('.os-tooltip {')
    const rule = css.slice(at, css.indexOf('}', at))
    expect(rule).toContain('backdrop-filter: blur(10px)')
    expect(rule).toContain('border: 1px solid rgb(255 255 255 / 14%)')
    expect(rule).toContain('inset 0 1px 0 rgb(255 255 255 / 10%)')
    expect(rule).toContain('transform: translateY(-50%) translateX(-4px)')
    // Dock 变体：气泡位于图标上方居中（bottom:100%+10px），亮起位移归零——
    // specificity (0,4,0) 高于 reveal 规则，覆写安全（2026-10-02 裁决）。
    expect(css).toContain('.os-tooltip--dock')
    expect(css).toContain('bottom: calc(100% + 10px)')
    expect(css).toContain('.group:hover .os-tooltip--dock')
        const revealAt = css.indexOf('.group:hover .os-tooltip')
    const reveal = css.slice(revealAt, css.indexOf('}', revealAt))
    expect(reveal).toContain('opacity: 1')
    expect(reveal).toContain('transform: translateY(-50%) translateX(0)')
  })

  it('defines the shell 3.0 active capsule gradient in both themes (§34)', () => {
    // 选中态渐变胶囊（工作空间 selector / 品牌徽章 / 今日世界角标）：
    // primary 同族明暗渐变，非新色相；双主题同形重声明。
    expect(root).toMatch(/--ag-capsule-active:\s*linear-gradient/)
    expect(dark).toMatch(/--ag-capsule-active:\s*linear-gradient/)
  })

  it('documents the accent quota and the glass/solid material rules in the token header', () => {
    // 色彩配额：主强调只用于 Active/Selected/Focus/Highlight，不许全页紫蓝化；
    // 材质纪律：大面=玻璃、小控件=实色——两条规则钉在 Token 头注释防漂移。
    expect(css).toContain('Active/Selected/Focus/Highlight')
    expect(css).toContain('大面=玻璃')
    expect(css).toContain('小控件=实色')
    // 不换色纪律（Shell 2.0）：冷白基底 + 蓝靛紫青 accent 族原值保留，
    // 无橙/米暖氛围入 Token 体系。
    expect(root).toMatch(/--ag-primary:\s*#2f5fe8/)
    expect(dark).toMatch(/--ag-primary:\s*#82a3ff/)
    expect(root).toMatch(/--ag-accent-blue:\s*#2f6fed/)
    expect(root).toMatch(/--ag-accent-indigo:\s*#4f46e5/)
    expect(root).toMatch(/--ag-accent-violet:\s*#8b5cf6/)
    expect(root).toMatch(/--ag-accent-cyan:\s*#0891b2/)
  })

  it('declares the mobile safe-area vars on .mobile-shell only (M0-3, desktop zero contact)', () => {
    // 四个 --safe-* 只在 .mobile-shell 根类上声明（env(safe-area-inset-*)，
    // 无刘海视口回退 0px）——不得泄入 :root/.dark（桌面零接触）。
    const mobileAt = css.indexOf('.mobile-shell {')
    expect(mobileAt).toBeGreaterThan(-1)
    const mobile = css.slice(mobileAt, css.indexOf('}', mobileAt))
    for (const side of ['top', 'right', 'bottom', 'left']) {
      expect(mobile).toMatch(
        new RegExp(`--safe-${side}:\\s*env\\(safe-area-inset-${side},\\s*0px\\)`),
      )
      expect(has(root, `safe-${side}`), `--safe-${side} NOT in :root`).toBe(false)
      expect(has(dark, `safe-${side}`), `--safe-${side} NOT in .dark`).toBe(false)
    }
    // M0-4：frame 只承担左右横屏 padding（上/下安全区由两条占位带承担，
    // frame 再加纵向 padding 会与占位带高度双重计入）。
    const frameAt = css.indexOf('.mobile-shell-frame {')
    expect(frameAt).toBeGreaterThan(-1)
    const frame = css.slice(frameAt, css.indexOf('}', frameAt))
    expect(frame).toMatch(/padding-left:\s*var\(--safe-left\)/)
    expect(frame).toMatch(/padding-right:\s*var\(--safe-right\)/)
    expect(frame).not.toContain('--safe-top')
    expect(frame).not.toContain('--safe-bottom')
    // 布局作用域段、非玻璃材质：不得携带 backdrop-filter（不落玻璃源序语义）。
    expect(mobile).not.toContain('backdrop-filter')
    expect(frame).not.toContain('backdrop-filter')
  })

  it('reserves safe-area bands with max() floors and a content scroll container (M0-4)', () => {
    // 顶部状态栏占位带：max(env top, 24px) 保底——纯占位不显示假数据；
    // 视觉克制：--ag-* 中性色（--ag-surface），不引入 blur/backdrop-filter。
    const statusbarAt = css.indexOf('.mobile-statusbar-slot {')
    expect(statusbarAt).toBeGreaterThan(-1)
    const statusbar = css.slice(statusbarAt, css.indexOf('}', statusbarAt))
    expect(statusbar).toMatch(/height:\s*max\(var\(--safe-top\),\s*24px\)/)
    expect(statusbar).toMatch(/background-color:\s*var\(--ag-surface\)/)
    expect(statusbar).not.toContain('backdrop-filter')
    expect(statusbar).not.toContain('blur(')

    // 底部 Dock 安全区预留带：max(env bottom, 12px) 给 Home indicator 留呼吸。
    const dockAt = css.indexOf('.mobile-dock-slot {')
    expect(dockAt).toBeGreaterThan(-1)
    const dock = css.slice(dockAt, css.indexOf('}', dockAt))
    expect(dock).toMatch(/height:\s*max\(var\(--safe-bottom\),\s*12px\)/)
    expect(dock).toMatch(/background-color:\s*var\(--ag-surface\)/)
    expect(dock).not.toContain('backdrop-filter')
    expect(dock).not.toContain('blur(')

    // 内容滚动容器（M1 填充）：min-height 0 + 纵向滚动。
    const scrollAt = css.indexOf('.mobile-content-scroll {')
    expect(scrollAt).toBeGreaterThan(-1)
    const scroll = css.slice(scrollAt, css.indexOf('}', scrollAt))
    expect(scroll).toMatch(/min-height:\s*0/)
    expect(scroll).toMatch(/overflow-y:\s*auto/)
    expect(scroll).not.toContain('backdrop-filter')
  })

  it('imports spatial.css right after tailwindcss at the top of index.css', () => {
    // 空间化地基独立文件由 index.css 顶部引入（@import 'tailwindcss' 之后
    // 第一行）；--sp-* 令牌与类在最前段注册，内部自持源序（基规则→增量→
    // 兜底）不受 index.css 未分层区影响。
    expect(css.slice(0, 120)).toMatch(
      /@import 'tailwindcss';\s*@import '\.\/styles\/spatial\.css';/,
    )
  })

  it('defines the spatial tokens (geometry constants + both-theme glass/shadow pairing)', () => {
    // 主题无关几何常量只入 :root（同红绿灯/--ag-tooltip-bg 先例）：圆角
    // 升档（20px rounded-xl → 28px 空间档）、深度、透视与浮动参数。
    expect(spRoot).toMatch(/--sp-window-radius:\s*28px/)
    expect(spRoot).toMatch(/--sp-widget-radius:\s*20px/)
    expect(spRoot).toMatch(/--sp-lift-near:\s*80px/)
    expect(spRoot).toMatch(/--sp-lift-middle:\s*40px/)
    expect(spRoot).toMatch(/--sp-lift-far:\s*0px/)
    expect(spRoot).toMatch(/--sp-perspective:\s*1400px/)
    expect(spRoot).toMatch(/--sp-float-duration:\s*9s/)
    expect(spRoot).toMatch(/--sp-float-distance:\s*5px/)
    // 随主题翻转的档位成对声明：浅色低透白 10/16/24；深色冷墨
    // rgb(16 23 40 / x%) 家族（--ag-glass-bg 深色配方同族，独立低透明档）。
    expect(spRoot).toMatch(/--sp-glass-light:\s*rgb\(255 255 255 \/ 10%\)/)
    expect(spRoot).toMatch(/--sp-glass-medium:\s*rgb\(255 255 255 \/ 16%\)/)
    expect(spRoot).toMatch(/--sp-glass-heavy:\s*rgb\(255 255 255 \/ 24%\)/)
    for (const name of ['sp-glass-light', 'sp-glass-medium', 'sp-glass-heavy']) {
      expect(has(spDark, name), `${name} in .dark`).toBe(true)
      expect(spDark).toMatch(new RegExp(`--${name}:\\s*rgb\\(16 23 40 \\/ \\d+%\\)`))
    }
    // 空间窗口阴影双主题成对：浅 = 冷墨家族、深 = 纯黑家族；比
    // --ag-shadow-window（0 16px 48px）更大更弥散（96px 漂浮档）。
    expect(spRoot).toMatch(/--sp-shadow-window:\s*0 32px 96px rgb\(18 32 62 \/ 22%\)/)
    expect(spDark).toMatch(/--sp-shadow-window:\s*0 32px 96px rgb\(0 0 0 \/ 55%\)/)
  })

  it('builds the spatial glass face on the independent sp tiers (never ag glass)', () => {
    const at = spatial.indexOf('.spatial-window {')
    const rule = spatial.slice(at, spatial.indexOf('}', at))
    expect(rule).toContain('background: var(--sp-glass-medium)')
    expect(rule).toContain('backdrop-filter: blur(40px) saturate(150%)')
    expect(rule).toContain('border: 1px solid rgb(255 255 255 / 24%)')
    expect(rule).toContain('border-radius: var(--sp-window-radius)')
    expect(rule).toContain('box-shadow: var(--sp-shadow-window)')
    // 斜向高光装饰层：120deg 白 12% 渐隐至 40%，克制不刺眼、不截胡交互。
    const beforeAt = spatial.indexOf('.spatial-window::before')
    const before = spatial.slice(beforeAt, spatial.indexOf('}', beforeAt))
    expect(before).toContain('linear-gradient(120deg, rgb(255 255 255 / 12%), transparent 40%)')
    expect(before).toContain('pointer-events: none')
  })

  it('keeps the depth ladder and float/static pair with the static cutoff after float', () => {
    // 深度三档：translateZ 消费 --sp-lift-*，近档附加 scale(1.02)；变换不
    // 改变静止布局盒。
    expect(spatial).toMatch(
      /\.sp-depth-near\s*\{\s*transform:\s*translateZ\(var\(--sp-lift-near\)\)\s*scale\(1\.02\);/,
    )
    expect(spatial).toMatch(
      /\.sp-depth-middle\s*\{\s*transform:\s*translateZ\(var\(--sp-lift-middle\)\);/,
    )
    expect(spatial).toMatch(
      /\.sp-depth-far\s*\{\s*transform:\s*translateZ\(var\(--sp-lift-far\)\);/,
    )
    // 常驻浮动：关键帧只动 transform（translateY 上下），参数走 --sp-float-*。
    expect(spatial).toMatch(
      /animation:\s*sp-float var\(--sp-float-duration\) ease-in-out infinite/,
    )
    const keyframesAt = spatial.indexOf('@keyframes sp-float')
    const keyframes = spatial.slice(keyframesAt, keyframesAt + 260)
    expect(keyframes).toContain('transform: translateY(0)')
    expect(keyframes).toContain('translateY(calc(-1 * var(--sp-float-distance)))')
    expect(keyframes).not.toMatch(/(width|height|top|margin):/)
    // 关档直切类必须位于浮动类之后：同特异性源序必胜（mobile 静态类同口径）。
    const floatAt = spatial.indexOf('.sp-ambient-float')
    const staticAt = spatial.indexOf('.sp-motion-static')
    expect(floatAt).toBeGreaterThan(0)
    expect(staticAt, 'static cutoff after the float rule').toBeGreaterThan(floatAt)
    const staticRule = spatial.slice(staticAt, spatial.indexOf('}', staticAt))
    expect(staticRule).toContain('animation: none')
  })

  it('resolves the depth ladder inside the window workplane scope (static box == layout box)', () => {
    // 窗口 = 工作面（2026-10-10 空间化窗口切片）：窗口 section 是
    // responsive-quad boundingBox 与 window-resize ±2px 的测量面——深度梯
    // 与失焦退后在窗口作用域必须解析为 transform: none（红线 10：静止渲染
    // 盒恒等于布局盒）；类照挂（组件契约不变），变换归零（测量面契约）。
    expect(spatial).toMatch(
      /\.spatial-window\.sp-win\.sp-depth-near,\s*\.spatial-window\.sp-win\.sp-depth-middle,\s*\.spatial-window\.sp-win\.sp-depth-far\s*\{\s*transform:\s*none;/,
    )
    expect(spatial).toMatch(/\.spatial-window\.sp-win\.is-tilt-dim\s*\{\s*transform:\s*none;/)
    // 栈内唯一 transform 写入者是悬停浮起 :hover 规则（只给失焦窗口，
    // translateY(-6px) scale(1.01) + 阴影加深；hover 态才发生，几何探针按
    // 静止态测量永不命中）——且位于深度/退后消解规则之后（同特异性源序）。
    const hoverAt = spatial.indexOf('.spatial-window.sp-win.sp-win-hover:hover')
    expect(hoverAt).toBeGreaterThan(spatial.indexOf('.spatial-window.sp-win.is-tilt-dim'))
    const hoverRule = spatial.slice(hoverAt, spatial.indexOf('}', hoverAt))
    expect(hoverRule).toContain('transform: translateY(-6px) scale(1.01)')
    expect(hoverRule).toContain('box-shadow: var(--sp-shadow-window-hover)')
    // 窗口工作面底档：position 抵消基规则 relative（几何仍由 inline
    // left/top 定位），面/边走 --ag 窗口档（工作面承墨字）。
    const winBaseAt = spatial.indexOf('.spatial-window.sp-win {')
    const winBase = spatial.slice(winBaseAt, spatial.indexOf('}', winBaseAt))
    expect(winBase).toContain('position: absolute')
    expect(winBase).toContain('background: var(--ag-glass-bg)')
    expect(winBase).toContain('border-color: var(--ag-border)')
    // 聚焦档：更高面实度 + 中性细边 + 更深空间阴影——只提实度不加色相
    // （active 禁止整体变蓝，不引入 primary）。
    const focusedAt = spatial.indexOf('.spatial-window.sp-win.sp-win-focused')
    const focusedRule = spatial.slice(focusedAt, spatial.indexOf('}', focusedAt))
    expect(focusedRule).toContain('background: var(--ag-window-face-active)')
    expect(focusedRule).toContain('border-color: var(--ag-border-strong)')
    expect(focusedRule).toContain('box-shadow: var(--sp-shadow-window-active)')
    // 最大化直切零圆角（rounded-none 工具类在未分层规则前必败，
    // sp-win-max 是实效载体；组件侧两类同挂）。
    const maxAt = spatial.indexOf('.spatial-window.sp-win.sp-win-max')
    const maxRule = spatial.slice(maxAt, spatial.indexOf('}', maxAt))
    expect(maxRule).toMatch(/border-radius:\s*0px/)
  })

  it('pairs the spatial window shadow tiers across themes and pins the window scope before fallbacks', () => {
    // 空间窗口阴影三档（flat < hover < active 递进）双主题成对：浅 = 冷墨
    // 家族、深 = 纯黑家族。
    expect(spRoot).toMatch(/--sp-shadow-window-hover:\s*0 36px 104px rgb\(18 32 62 \/ 25%\)/)
    expect(spRoot).toMatch(/--sp-shadow-window-active:\s*0 40px 112px rgb\(18 32 62 \/ 27%\)/)
    expect(spDark).toMatch(/--sp-shadow-window-hover:\s*0 36px 104px rgb\(0 0 0 \/ 58%\)/)
    expect(spDark).toMatch(/--sp-shadow-window-active:\s*0 40px 112px rgb\(0 0 0 \/ 62%\)/)
    // 源序（红线 3）：窗口作用域段位于浮动/静态对之后、两处实色兜底之前；
    // 聚焦面档特异性更高，两处兜底选择器组必须同等特异性并列覆盖
    // （降级环境必胜，对比从不依赖 blur）。
    const winScopeAt = spatial.indexOf('.spatial-window.sp-win {')
    expect(winScopeAt).toBeGreaterThan(spatial.indexOf('.sp-motion-static'))
    const rtiAt = spatial.indexOf('@media (prefers-reduced-transparency')
    const nbfAt = spatial.indexOf('@supports not (backdrop-filter')
    expect(rtiAt).toBeGreaterThan(winScopeAt)
    expect(nbfAt).toBeGreaterThan(rtiAt)
    for (const fbAt of [rtiAt, nbfAt]) {
      const fbBlock = spatial.slice(fbAt, spatial.indexOf('\n}', fbAt))
      expect(fbBlock).toContain('.spatial-window,')
      expect(fbBlock).toContain('.spatial-window.sp-win,')
      expect(fbBlock).toContain('.spatial-window.sp-win.sp-win-focused')
    }
  })

  it('falls back to solid surfaces inside spatial.css with self-contained source order', () => {
    // 空间玻璃对比度从不依赖 blur：spatial.css 内部自持源序——基规则 →
    // 增量 → 两处实色兜底（--ag-surface-popover 家族，与既有 .surface-glass
    // 兜底同口径）；前缀禁令同样适用本文件（根因 A）。
    const base = spatial.indexOf('.spatial-window {')
    const rti = spatial.indexOf('prefers-reduced-transparency')
    const nbf = spatial.indexOf('@supports not (backdrop-filter')
    expect(base).toBeGreaterThan(0)
    expect(rti, 'reduced-transparency fallback after the base rule').toBeGreaterThan(base)
    expect(
      nbf,
      'supports-not fallback after the reduced-transparency fallback',
    ).toBeGreaterThan(rti)
    const rtiBlock = spatial.slice(rti, spatial.indexOf('}', rti))
    expect(rtiBlock).toContain('background: var(--ag-surface-popover)')
    expect(rtiBlock).toContain('backdrop-filter: none')
    const nbfBlock = spatial.slice(nbf, spatial.indexOf('}', nbf))
    expect(nbfBlock).toContain('background: var(--ag-surface-popover)')
    expect(spatial).not.toContain('-webkit-backdrop-filter')
  })
})
