import { renderHook, act } from '@testing-library/react'
import { describe, it, expect, afterEach } from 'vitest'

import {
  dictionaries,
  translate,
  DEFAULT_LOCALE,
  useLocaleStore,
  useTranslation,
  setLocale,
  getLocale,
} from './index'

afterEach(() => {
  useLocaleStore.setState(useLocaleStore.getInitialState())
})

describe('dictionaries', () => {
  it('covers every message key in both supported locales', () => {
    const keys = Object.keys(dictionaries[DEFAULT_LOCALE])

    expect(Object.keys(dictionaries.en)).toEqual(expect.arrayContaining(keys))
    expect(Object.keys(dictionaries.en)).toHaveLength(keys.length)
  })

  it('translates a key for each locale', () => {
    expect(translate('zh-CN', 'boot.ready')).toBe('启动完成')
    expect(translate('en', 'boot.ready')).toBe('Ready')
  })
})

describe('locale store', () => {
  it('starts with the default locale', () => {
    expect(getLocale()).toBe('zh-CN')
  })

  it('changes the locale', () => {
    setLocale('en')

    expect(getLocale()).toBe('en')
  })
})

describe('useTranslation', () => {
  it('returns translations for the active locale and reacts to changes', () => {
    const { result } = renderHook(() => useTranslation())

    expect(result.current.locale).toBe('zh-CN')
    expect(result.current.t('boot.booting')).toBe('正在启动 AgehaOS…')

    act(() => {
      setLocale('en')
    })

    expect(result.current.locale).toBe('en')
    expect(result.current.t('boot.booting')).toBe('Starting AgehaOS…')
  })
})
