import { create } from 'zustand'

import { DEFAULT_LOCALE, translate } from './dictionaries'
import type { Locale, MessageKey } from './dictionaries'

interface I18nState {
  locale: Locale
  setLocale: (locale: Locale) => void
}

export const useLocaleStore = create<I18nState>((set) => ({
  locale: DEFAULT_LOCALE,
  setLocale: (locale) => set({ locale }),
}))

export function useTranslation(): {
  locale: Locale
  t: (key: MessageKey) => string
} {
  const locale = useLocaleStore((state) => state.locale)
  return { locale, t: (key) => translate(locale, key) }
}

export function setLocale(locale: Locale): void {
  useLocaleStore.getState().setLocale(locale)
}

export function getLocale(): Locale {
  return useLocaleStore.getState().locale
}
