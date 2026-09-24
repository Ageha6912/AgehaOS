import { readFileSync, readdirSync, statSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

import { dictionaries } from '../../i18n/dictionaries'
import { PHOTO_CATALOG, photoById, photosForTheme } from './catalog'

/** public/ 下路径 → 仓库磁盘路径（vitest 以仓库根为 CWD）。 */
const diskPath = (src: string): string => `public${src}`

const LICENSE_ALLOWLIST = ['CC0', 'Public domain', 'CC BY', 'CC BY-SA', 'CC BY 2.0', 'CC BY 3.0', 'CC BY-SA 2.0', 'CC BY-SA 3.0', 'CC BY-SA 4.0']

describe('photo wallpaper catalog (Phase A.6)', () => {
  it('has unique ids and complete credit metadata', () => {
    const ids = PHOTO_CATALOG.map((photo) => photo.id)
    expect(new Set(ids).size).toBe(ids.length)
    for (const photo of PHOTO_CATALOG) {
      expect(photo.src).toMatch(/^\/wallpapers\/landscapes\/[\w-]+\.jpg$/)
      expect(photo.credit.author.length).toBeGreaterThan(0)
      expect(LICENSE_ALLOWLIST).toContain(photo.credit.license)
      expect(photo.credit.sourceUrl).toMatch(/^https:\/\/commons\.wikimedia\.org\/wiki\/File:/)
    }
  })

  it('points at real bundled files within the size budget', () => {
    for (const photo of PHOTO_CATALOG) {
      const stat = statSync(diskPath(photo.src))
      expect(stat.isFile()).toBe(true)
      expect(stat.size).toBeLessThan(1.5 * 1024 * 1024)
      // JPEG 魔数（防止误打包其他格式）。
      const bytes = readFileSync(diskPath(photo.src))
      expect(bytes[0]).toBe(0xff)
      expect(bytes[1]).toBe(0xd8)
    }
  })

  it('has no orphaned image files in the wallpapers directory', () => {
    const referenced = new Set(PHOTO_CATALOG.map((photo) => photo.src.replace('/wallpapers/landscapes/', '')))
    const onDisk = readdirSync('public/wallpapers/landscapes').filter((name) => name.endsWith('.jpg'))
    expect(onDisk.sort()).toEqual([...referenced].sort())
  })

  it('provides a usable pool for each theme mood', () => {
    expect(photosForTheme('light').length).toBeGreaterThanOrEqual(4)
    expect(photosForTheme('dark').length).toBeGreaterThanOrEqual(4)
    expect(photoById('yamzho-yumco')?.mood).toBe('light')
  })

  it('resolves every photo name key in both locales (词典类型强制之外的双保险)', () => {
    const zh = dictionaries['zh-CN'] as Record<string, string>
    const en = dictionaries.en as Record<string, string>
    for (const photo of PHOTO_CATALOG) {
      expect(zh[photo.nameKey]).toBeTruthy()
      expect(en[photo.nameKey]).toBeTruthy()
    }
  })

  it('ships a credits file covering every bundled photo', () => {
    const credits = readFileSync('public/wallpapers/landscapes/CREDITS.md', 'utf-8')
    for (const photo of PHOTO_CATALOG) {
      expect(credits).toContain(photo.credit.author)
      expect(credits).toContain(photo.credit.license)
    }
  })
})
