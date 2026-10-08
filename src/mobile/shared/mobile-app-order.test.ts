import { describe, expect, it } from 'vitest'

import {
  MOBILE_APP_ORDER,
  mobileAppOrderRank,
  orderAppsForMobileGrid,
} from './mobile-app-order'

/**
 * M1-4 应用网格排序契约（纯函数，零 React 零 store）：
 * - 常量优先序成员按 MOBILE_APP_ORDER 表序在前（输入顺序无关）；
 * - 未列入的按注入解析器给的展示名小写码元序排后（大小写不敏感、跨环境
 *   恒定——刻意不用 localeCompare）；
 * - 排序稳定（同名保持注册表原序）、输入数组不被原地修改、空输入返回空。
 */

/** 造一个最小可排条目（排序只读 id 与注入名，不碰 manifest 其余字段）。 */
function app(id: string): { id: string } {
  return { id }
}

/** 确定性名称解析器（测试注入，模拟 appDisplayName 的「id → 展示名」形）。 */
function resolveByNameTable(table: Record<string, string>) {
  return (appId: string): string => table[appId] ?? appId
}

describe('MOBILE_APP_ORDER', () => {
  it('常量表 = 切片指定的 7 个内置应用序（dynamic.panel 最前、terminal 收尾）', () => {
    expect(MOBILE_APP_ORDER).toEqual([
      'com.ageha.dynamic.panel',
      'com.ageha.files',
      'com.ageha.notes',
      'com.ageha.settings',
      'com.ageha.calculator',
      'com.ageha.store',
      'com.ageha.terminal',
    ])
  })
})

describe('mobileAppOrderRank', () => {
  it('表内 id 返回表序名次，未列入的返回 MAX_SAFE_INTEGER（排后）', () => {
    expect(mobileAppOrderRank('com.ageha.dynamic.panel')).toBe(0)
    expect(mobileAppOrderRank('com.ageha.terminal')).toBe(6)
    expect(mobileAppOrderRank('com.ageha.eclosion.clock')).toBe(Number.MAX_SAFE_INTEGER)
    expect(mobileAppOrderRank('com.store.thirdparty')).toBe(Number.MAX_SAFE_INTEGER)
  })
})

describe('orderAppsForMobileGrid', () => {
  it('7 个内置应用：任意输入序 → 恒定优先序输出', () => {
    const input = [
      'com.ageha.terminal',
      'com.ageha.store',
      'com.ageha.notes',
      'com.ageha.calculator',
      'com.ageha.dynamic.panel',
      'com.ageha.settings',
      'com.ageha.files',
    ].map(app)
    const resolve = resolveByNameTable({})

    expect(orderAppsForMobileGrid(input, resolve).map((entry) => entry.id)).toEqual([
      'com.ageha.dynamic.panel',
      'com.ageha.files',
      'com.ageha.notes',
      'com.ageha.settings',
      'com.ageha.calculator',
      'com.ageha.store',
      'com.ageha.terminal',
    ])
  })

  it('未列入的按展示名排在内置之后（羽化 L1 场景：boot 注册表全量 10 应用）', () => {
    const input = [
      'com.ageha.eclosion.notes',
      'com.ageha.notes',
      'com.ageha.eclosion.clock',
      'com.ageha.files',
      'com.ageha.eclosion.calculator',
      'com.ageha.terminal',
    ].map(app)
    // 与生产同形的解析结果（appDisplayName：羽化走规格表 titleKey 的 zh 值）。
    const resolve = resolveByNameTable({
      'com.ageha.eclosion.notes': '记事',
      'com.ageha.eclosion.clock': '时钟',
      'com.ageha.eclosion.calculator': '计算器',
    })

    expect(orderAppsForMobileGrid(input, resolve).map((entry) => entry.id)).toEqual([
      // 优先序成员按表内相对序在前（files 表位 1、notes 表位 2、terminal 表位 6）。
      'com.ageha.files',
      'com.ageha.notes',
      'com.ageha.terminal',
      // 未列入按名称小写码元序：时(U+65F6) < 计(U+8BA1) < 记(U+8BB0)。
      'com.ageha.eclosion.clock',
      'com.ageha.eclosion.calculator',
      'com.ageha.eclosion.notes',
    ])
  })

  it('未列入的名字比较大小写不敏感（小写码元序）', () => {
    const input = ['com.zeta.app', 'com.alpha.app', 'com.ageha.notes'].map(app)
    const resolve = resolveByNameTable({ 'com.zeta.app': 'Zeta', 'com.alpha.app': 'alpha tool' })

    expect(orderAppsForMobileGrid(input, resolve).map((entry) => entry.id)).toEqual([
      'com.ageha.notes',
      'com.alpha.app',
      'com.zeta.app',
    ])
  })

  it('优先序里缺席的成员不占位：只装了 3 个应用也按表内相对序排', () => {
    const input = ['com.ageha.store', 'com.ageha.notes'].map(app)
    const resolve = resolveByNameTable({})

    expect(orderAppsForMobileGrid(input, resolve).map((entry) => entry.id)).toEqual([
      'com.ageha.notes',
      'com.ageha.store',
    ])
  })

  it('同名稳定：未列入的同名条目保持输入序（sort 稳定语义）', () => {
    const input = ['com.b.app', 'com.a.app', 'com.ageha.notes'].map(app)
    const resolve = resolveByNameTable({ 'com.b.app': 'Same', 'com.a.app': 'same' })

    expect(orderAppsForMobileGrid(input, resolve).map((entry) => entry.id)).toEqual([
      'com.ageha.notes',
      'com.b.app',
      'com.a.app',
    ])
  })

  it('空输入 → 空输出；输入数组不被原地修改', () => {
    const resolve = resolveByNameTable({})

    expect(orderAppsForMobileGrid([], resolve)).toEqual([])

    const input = ['com.ageha.terminal', 'com.ageha.notes'].map(app)
    const snapshot = input.map((entry) => entry.id)
    orderAppsForMobileGrid(input, resolve)
    expect(input.map((entry) => entry.id)).toEqual(snapshot)
  })
})
