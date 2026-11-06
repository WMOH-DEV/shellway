export type UsageLevel = 'success' | 'warning' | 'error'

export function usageLevel(pct: number): UsageLevel {
  if (pct >= 90) return 'error'
  if (pct >= 70) return 'warning'
  return 'success'
}

export function temperatureLevel(celsius: number): UsageLevel {
  if (celsius >= 80) return 'error'
  if (celsius >= 60) return 'warning'
  return 'success'
}
