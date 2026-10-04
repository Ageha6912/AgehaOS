import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

/*
 * Token 2.0 契约（docs/DESIGN.md §2 唯一权威）：钉住 src/index.css 必须
 * 提供的设计 Token 集合与关键别名，防止后续重构静默丢 Token 或破坏
 * v1 兼容别名。样式值本身不在本测试断言范围（属 DESIGN.md 表格）。
 */
const css = readFileSync(join(process.cwd(), 'src', 'index.css'), 'utf8')

function block(open: string): string {
  const start = css.indexOf(open)
  const end = css.indexOf('\n}', start)
  return start >= 0 && end > start ? css.slice(start, end) : ''
}

const root = block(':root {')
const dark = block('.dark {')
const theme = block('@theme inline {')

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
    // Workspace Panel 展开态宽度（Shell 3.0 STEP 2；简报 300-340 档取
    // 324px）——纯浮层几何：窗口布局钳制仍钉 RAIL_LEFT_WIDTH_PX=80，
    // viewport.ts 常量与窗口几何不随展开迁移。
    expect(root).toMatch(/--ag-rail-left-expanded-width:\s*324px/)
    // 右侧小组件栏宽度与 RAIL_RIGHT_WIDTH_PX 常量互指（§27；2026-10-01
    // 用户裁决收窄至 296px）。
    expect(root).toMatch(/--ag-rail-right-width:\s*296px/)
    // §31 Round 2：Dock 胶囊 68px 恒驻；Shell 2.0 离底 20px、图标 48px
    // （节距 56 = 48 + gap-2 8px，波浪 σ44 ≤ 1.2×56 仍成立）。
    expect(root).toMatch(/--ag-dock-height:\s*68px/)
    expect(root).toMatch(/--ag-dock-gap:\s*20px/)
    expect(root).toMatch(/--ag-dock-item-pitch:\s*56px/)
    expect(root).toMatch(/--ag-dock-icon:\s*48px/)
  })

  it('scopes the desktop chrome white-on-glass material (sec 32)', () => {
    expect(css).toContain('.desktop-chrome')
    const scope = css.slice(css.indexOf('.desktop-chrome'), css.indexOf('.surface-panel'))
    // 白字 Token 阶 + 低透白玻璃 + 深玻璃弹层 remap + 降透明实色兜底。
    expect(scope).toMatch(/--ag-text:\s*#ffffff/)
    expect(scope).toMatch(/--ag-glass-bg:\s*rgb\(255 255 255 \/ 14%\)/)
    // 弹层不再继承白字 26% 白玻璃（实测 1.7-2.7:1）：改由纸面块重声明。
    const rule = css.slice(css.indexOf('.desktop-chrome {'), css.indexOf('}', css.indexOf('.desktop-chrome {')))
    expect(rule).not.toMatch(/--ag-glass-bg-strong/)
    // :root 别名在声明处求值、子树不重算：作用域内必须显式重声明，否则
    // hover:bg-surface-raised 会落成 :root 的近白实色（菜单栏铃铛白圆斑）。
    expect(rule).toMatch(/--ag-surface-raised:\s*rgb\(255 255 255 \/ 16%\)/)
    expect(rule).toMatch(/--ag-brand:/)
    expect(scope).toMatch(/--ag-surface-popover:\s*#2c3a63/)
  })

  it('re-declares paper tokens on popovers and widget cards (UI review P0-1)', () => {
    const paperAt = css.indexOf('.chrome-paper,')
    expect(paperAt).toBeGreaterThan(0)
    const paper = css.slice(paperAt, css.indexOf('}', paperAt))
    expect(paper).toMatch(/\.popover-panel,\s*\.glass-popover,\s*\.widget-card\s*\{/)
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

  it('darkens the menubar strip so its white text stays legible', () => {
    const at = css.indexOf('.menubar-glass {')
    const block = css.slice(at, css.indexOf('}', at))
    expect(block).toMatch(/background:\s*rgb\(18 30 66 \/ 50%\)/)
    expect(block).toMatch(/--ag-text-muted:\s*rgb\(255 255 255 \/ 92%\)/)
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
    for (const marker of ['.glass-hint', '.glass-raise', '.glass-deep', '.dock-glass', '.glass-popover']) {
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
  it('renders the system-rails liquid glass with SVG refraction and ordered fallbacks（2026-10-02 裁决）', () => {
    // 折射主通道 = SVG 滤镜 url(#ag-liquid-rail)，blur 只留 2px 保底柔化；
    // 高光描边 = inset 组合（顶缘强/侧缘弱/底缘中）；backdrop-filter 只写
    // 标准属性（坑 A）。源序即降级：本块必须在 reduced-transparency/
    // @supports 兜底之前（同 .glass-raise 的源序纪律）。
    const at = css.indexOf('.glass-liquid {')
    expect(at).toBeGreaterThan(0)
    const rule = css.slice(at, at + 300)
    expect(rule).toContain('backdrop-filter: url(#ag-liquid-rail) blur(2px) saturate(160%)')
    expect(rule).toContain('inset 0 1px 1px rgb(255 255 255 / 45%)')
    expect(rule).toContain('var(--ag-shadow-float)')
    expect(rule).not.toContain('-webkit-backdrop-filter')
    const fallbackAt = css.indexOf('@media (prefers-reduced-transparency: reduce)', at)
    expect(fallbackAt).toBeGreaterThan(at)
    const supportsAt = css.indexOf('@supports not (backdrop-filter: blur(1px))', at)
    expect(supportsAt).toBeGreaterThan(at)
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

  it('bans the -webkit-backdrop-filter prefix everywhere (root cause A)', () => {
    // 源码出现 -webkit- 前缀会被构建链剥掉标准属性 → 全应用玻璃模糊失效。
    // 前缀由 Lightning CSS 构建期自动补，源码只写标准属性。
    expect(css).not.toContain('-webkit-backdrop-filter')
  })

  it('lifts only the hovered dock icon with glow, neighbors untouched（2026-10-02 裁决，§13 波浪退役）', () => {
    // 前置契约：Taskbar 图标 span 挂 data-wave-icon（CSS 钩子，不加则规则
    // 永不命中 = 静默丢需求）。hover 规则 = 浮起（translateY+scale）+ 光晕
    // （drop-shadow，品牌 cobalt 28%，Active/Highlight 配额内）；写入域限定
    // 在 button:hover 的直接子级 = 只影响被悬浮的那一枚；触屏与
    // reduced-motion 不浮起；不声明 background（按钮零底色裁决不回退）。
    const at = css.indexOf('button:hover > [data-wave-icon]')
    expect(at).toBeGreaterThan(0)
    const rule = css.slice(at, at + 320)
    expect(rule).toContain('transform: translateY(-3px) scale(1.18)')
    expect(rule).toContain('filter: drop-shadow(')
    expect(rule).toContain('rgb(47 95 232 / 28%)')
    expect(rule).not.toContain('background')
    // 作用域护栏：hover 浮起必须包在 (hover:hover)+(no-preference) 媒体内，
    // 基态 transition 存在（回落动画）。
    expect(css).toContain('@media (hover: hover) and (prefers-reduced-motion: no-preference)')
    expect(css.indexOf('[data-wave-icon] {')).toBeGreaterThan(-1)
    expect(css.slice(css.indexOf('[data-wave-icon] {'), css.indexOf('[data-wave-icon] {') + 140)).toContain(
      'transition:',
    )
  })

  it('raises the hovered dock icon slowly and settles back faster（2026-10-02 裁决「缓慢浮起」）', () => {
    // 非对称过渡：入场 380ms easeOutQuint（cubic-bezier(0.22,1,0.36,1)）软
    // 减速丝滑浮起，写在 hover 态；回落 220ms 常规缓动，写在基态。
    const hoverAt = css.indexOf('button:hover > [data-wave-icon]')
    const hoverRule = css.slice(hoverAt, hoverAt + 320)
    expect(hoverRule).toContain('transform 380ms cubic-bezier(0.22, 1, 0.36, 1)')
    const baseAt = css.indexOf('[data-wave-icon] {')
    const baseRule = css.slice(baseAt, baseAt + 160)
    expect(baseRule).toContain('transform 220ms var(--ag-motion-ease)')
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
})
