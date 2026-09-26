import { render } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { BRAND_LOGO_SRC, BrandLogo } from './brand-logo'

describe('BrandLogo (品牌 logo，DESIGN.md §10)', () => {
  it('renders the master-cropped logo at the requested size with tile clipping', () => {
    const { container } = render(<BrandLogo size={48} />)

    const img = container.querySelector('img')
    expect(img).not.toBeNull()
    expect(img).toHaveAttribute('src', BRAND_LOGO_SRC)
    expect(img).toHaveAttribute('width', '48')
    expect(img).toHaveAttribute('height', '48')
    // 展示层贴合：CSS 圆角裁掉源图四角的残余黑边，object-cover 防变形。
    expect(img?.className).toContain('rounded-[24%]')
    expect(img?.className).toContain('object-cover')
  })

  it('stays decorative without a label and exposes alt text with one', () => {
    const { container, rerender } = render(<BrandLogo size={16} />)
    expect(container.querySelector('img')).toHaveAttribute('aria-hidden', 'true')

    rerender(<BrandLogo size={16} label="AgehaOS" />)
    expect(container.querySelector('img')).toHaveAttribute('alt', 'AgehaOS')
    expect(container.querySelector('img')).not.toHaveAttribute('aria-hidden')
  })
})
