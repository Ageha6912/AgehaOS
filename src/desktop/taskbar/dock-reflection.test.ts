import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

/*
 * Dock 弱倒影 CSS 契约（2026-10-11 环境抛光切片；src/styles/spatial.css
 * .dock-reflection 段，同 index.css.test.ts 读源文本钉扎手法；同日用户
 * 反馈「效果太克制」振幅加大——40px/18%/14%/88%）：
 * - 渐变 mask 伪倒影挂在胶囊正下方（top:100% + 继承胶囊圆角）；
 * - 峰值透明度双主题成对（浅 18% / 深 14%）；
 * - prefers-reduced-motion 整层消失（display:none）；
 * - 非玻璃件：零 backdrop-filter、零 -webkit- 前缀（根因 A 同源）。
 */
const spatial = readFileSync(join(process.cwd(), 'src', 'styles', 'spatial.css'), 'utf8')

describe('dock reflection css contract（2026-10-11 环境抛光）', () => {
  const at = spatial.indexOf('.dock-reflection {')
  const rule = spatial.slice(at, spatial.indexOf('}', at))

  it('paints the pseudo reflection directly below the pill with a gradient mask', () => {
    expect(at, '.dock-reflection rule exists').toBeGreaterThan(0)
    expect(rule).toContain('position: absolute')
    expect(rule).toContain('top: 100%')
    expect(rule).toContain('height: var(--sp-dock-reflection-height)')
    expect(rule).toContain('border-radius: inherit')
    expect(rule).toContain('mask-image: linear-gradient(to bottom, black, transparent 88%)')
    expect(rule).toContain('pointer-events: none')
  })

  it('keeps the peak opacity paired across themes (light 18% / dark 14%, 2026-10-11 amplified)', () => {
    expect(rule).toContain('background: rgb(255 255 255 / 18%)')
    const darkAt = spatial.indexOf('.dark .dock-reflection')
    expect(darkAt, 'dark pairing after the base rule').toBeGreaterThan(at)
    const darkRule = spatial.slice(darkAt, spatial.indexOf('}', darkAt))
    expect(darkRule).toContain('background: rgb(255 255 255 / 14%)')
  })

  it('hides the whole layer under prefers-reduced-motion', () => {
    const mediaAt = spatial.indexOf('@media (prefers-reduced-motion: reduce)')
    expect(mediaAt, 'reduced-motion block exists').toBeGreaterThan(0)
    const media = spatial.slice(mediaAt, spatial.indexOf('\n}', mediaAt))
    expect(media).toContain('.dock-reflection')
    expect(media).toContain('display: none')
  })

  it('registers the height token and stays free of glass/prefix machinery', () => {
    const rootAt = spatial.indexOf(':root {')
    const rootBlock = spatial.slice(rootAt, spatial.indexOf('\n}', rootAt))
    expect(rootBlock).toMatch(/--sp-dock-reflection-height:\s*40px/)
    // 非玻璃件：不带 backdrop-filter；前缀禁令同样适用本文件（根因 A）。
    expect(rule).not.toContain('backdrop-filter')
    expect(spatial).not.toContain('-webkit-backdrop-filter')
  })
})
