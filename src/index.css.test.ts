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
      'ag-shadow-popover',
      'ag-shadow-modal',
      'ag-blur-sm',
      'ag-blur-md',
      'ag-blur-lg',
      'ag-scrim',
      'ag-scrim-strong',
      'ag-radius-pill',
      'ag-menubar-height',
      'ag-dock-height',
      'ag-dock-item-pitch',
      'ag-dock-icon',
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
    // 顶栏高度与 viewport.ts 的 MENUBAR_HEIGHT_PX 常量互指（§19；§32 对齐参考图 40px）。
    expect(root).toMatch(/--ag-menubar-height:\s*40px/)
    // 左侧系统导航栏宽度与 RAIL_LEFT_WIDTH_PX 常量互指（§26；§32 对齐参考图 132px）。
    expect(root).toMatch(/--ag-rail-left-width:\s*132px/)
    // 右侧小组件栏宽度与 RAIL_RIGHT_WIDTH_PX 常量互指（§27；§32 参考图 336px，
    // 2026-10-01 用户裁决收窄至 296px）。
    expect(root).toMatch(/--ag-rail-right-width:\s*296px/)
    // §31 Round 2：Dock 提升存在感；§32 图标 44px（节距 52 不变，σ ≤ 1.2×节距成立）。
    expect(root).toMatch(/--ag-dock-height:\s*68px/)
    expect(root).toMatch(/--ag-dock-item-pitch:\s*52px/)
    expect(root).toMatch(/--ag-dock-icon:\s*44px/)
  })

  it('scopes the desktop chrome white-on-glass material (sec 32)', () => {
    expect(css).toContain('.desktop-chrome')
    const scope = css.slice(css.indexOf('.desktop-chrome'), css.indexOf('.surface-panel'))
    // 白字 Token 阶 + 低透白玻璃 + 降透明实色兜底三件套。
    expect(scope).toMatch(/--ag-text:\s*#ffffff/)
    expect(scope).toMatch(/--ag-glass-bg:\s*rgb\(255 255 255 \/ 14%\)/)
    expect(scope).toMatch(/--ag-surface-popover:\s*#2c3a63/)
  })

  it('defines the widget Acrylic knobs (sec 32, 用户可调模糊/遮罩)', () => {
    // 模糊半径（2026-10-01 用户裁决五轮调淡后 12px）+ 淡蓝纱遮罩（
    // 白字配深遮罩）；.widget-card 消费双旋钮，降透明回落实色。
    expect(root).toMatch(/--ag-widget-blur:\s*12px/)
    expect(root).toMatch(/--ag-widget-tint:\s*linear-gradient\(/)
    // 主规则是文件中最后一个 .widget-card（前面是降透明/@supports 兜底块）。
    const widget = css.slice(css.lastIndexOf('.widget-card'), css.lastIndexOf('.widget-card') + 400)
    expect(widget).toMatch(/backdrop-filter:\s*blur\(var\(--ag-widget-blur\)\)/)
    expect(widget).toMatch(/background:\s*var\(--ag-widget-tint\)/)
    // 白玻璃配深墨字（chrome 白字作用域内重映射，参考图组件样式）。
    expect(widget).toMatch(/--ag-text:\s*#1c2740/)
    expect(widget).toMatch(/text-shadow:\s*none/)
    expect(css).toMatch(/prefers-reduced-transparency[\s\S]{0,400}\.widget-card\s*\{[^}]*#2c3a63/)
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
})
