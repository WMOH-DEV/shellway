import { useEffect } from 'react'
import { useUIStore } from '@/stores/uiStore'
import type { Theme } from '@/types/settings'

/**
 * Hook to manage the app theme.
 * Listens for system theme changes when in 'system' mode.
 */
export function useTheme() {
  const { theme, resolvedTheme, setTheme } = useUIStore()

  useEffect(() => {
    // Apply theme on mount
    const root = document.documentElement
    root.classList.remove('dark', 'light')
    root.classList.add(resolvedTheme)
  }, [resolvedTheme])

  useEffect(() => {
    if (theme !== 'system') return

    const mq = window.matchMedia('(prefers-color-scheme: dark)')
    const handler = () => setTheme('system') // Re-resolve

    mq.addEventListener('change', handler)
    return () => mq.removeEventListener('change', handler)
  }, [theme, setTheme])

  return {
    theme,
    resolvedTheme,
    setTheme,
    isDark: resolvedTheme === 'dark',
    toggleTheme: () => {
      const next: Theme = resolvedTheme === 'dark' ? 'light' : 'dark'
      setTheme(next)
    }
  }
}
