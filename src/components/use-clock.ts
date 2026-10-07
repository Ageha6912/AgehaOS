import { useEffect, useState } from 'react'

import { useLocaleStore } from '@/core/i18n'

export function useClock(): string {
  const locale = useLocaleStore((state) => state.locale)
  const [now, setNow] = useState(() => new Date())

  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 1000)
    return () => window.clearInterval(timer)
  }, [])

  return new Intl.DateTimeFormat(locale, {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(now)
}
