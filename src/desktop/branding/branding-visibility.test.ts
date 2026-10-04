import { describe, expect, it } from 'vitest'

import { brandingTier } from './branding-visibility'

describe('brandingTier（STEP 5 中央品牌四档分级，纯函数）', () => {
  it('弹层打开恒为 hidden——优先级压过任何窗口档', () => {
    expect(brandingTier(0, true)).toBe('hidden')
    expect(brandingTier(1, true)).toBe('hidden')
    expect(brandingTier(5, true)).toBe('hidden')
  })

  it('窗口档阶梯：空闲 full → 单窗 dim → 多窗 faint', () => {
    expect(brandingTier(0, false)).toBe('full')
    expect(brandingTier(1, false)).toBe('dim')
    expect(brandingTier(2, false)).toBe('faint')
    expect(brandingTier(9, false)).toBe('faint')
  })

  it('负数/异常计数按空闲处理（防御性，不抛错）', () => {
    expect(brandingTier(-1, false)).toBe('full')
  })
})
