import { describe, expect, it } from 'vitest'

import { STORE_CATALOG } from '@/apps/store/catalog'

import { BUILTIN_APP_MANIFESTS } from './builtin-manifests'

/**
 * §30 应用默认窗口横版裁决（2026-10-01 用户「软件默认不要竖版排版」）：
 * 内置应用默认窗口一律宽 > 高；唯一豁免 = 计算器（手持计算器物理隐喻，
 * resizable: false 固定 300×440）。
 */
const PORTRAIT_EXEMPT_IDS = new Set(['com.ageha.calculator'])

function portraitIds(entries: readonly unknown[]): string[] {
  return entries
    .filter((raw) => {
      const { id, window } = raw as {
        id: string
        window?: { width: number; height: number }
      }
      return window !== undefined && window.height > window.width && !PORTRAIT_EXEMPT_IDS.has(id)
    })
    .map((raw) => (raw as { id: string }).id)
}

describe('app default window orientation (DESIGN.md §30)', () => {
  it('every built-in app defaults to a landscape window', () => {
    expect(portraitIds(BUILTIN_APP_MANIFESTS)).toEqual([])
  })

  it('every store catalog app defaults to a landscape window', () => {
    expect(
      portraitIds(STORE_CATALOG.map((entry) => entry.manifest)),
    ).toEqual([])
  })

  it('the dynamic panel default is landscape (680×420)', () => {
    const panel = BUILTIN_APP_MANIFESTS.find(
      (raw) => (raw as { id: string }).id === 'com.ageha.dynamic.panel',
    ) as { window: { width: number; height: number } }
    expect(panel.window).toEqual({ width: 680, height: 420, resizable: true })
  })
})
