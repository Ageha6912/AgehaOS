import { describe, expect, it } from 'vitest'

import { BRANDING_TIER_CLASS, brandingTier } from './branding-visibility'

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

  it('BRANDING_TIER_CLASS 档位值钉在契约带内（Shell 3.1 STEP 4 复核：不动）', () => {
    // 任务书 §20 推荐带：dim 35-50%、faint 10-25%；hidden=0、full=100%。
    // 字面量整类供 Tailwind v4 源码扫描——改值必须连带本测试与 branding.spec。
    expect(BRANDING_TIER_CLASS.full).toBe('opacity-100')
    expect(BRANDING_TIER_CLASS.dim).toBe('opacity-40')
    expect(BRANDING_TIER_CLASS.faint).toBe('opacity-15')
    expect(BRANDING_TIER_CLASS.hidden).toBe('opacity-0')
  })
})
