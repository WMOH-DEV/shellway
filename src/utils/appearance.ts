import type { InterfaceDensity } from '@/types/settings'

/** Convert hex color (#rrggbb) to space-separated RGB channels for CSS variables */
export function hexToRgb(hex: string): string {
  const h = hex.replace('#', '')
  const r = parseInt(h.substring(0, 2), 16)
  const g = parseInt(h.substring(2, 4), 16)
  const b = parseInt(h.substring(4, 6), 16)
  return `${r} ${g} ${b}`
}

/** Apply accent color to CSS custom properties on :root */
export function applyAccentColor(hex: string): void {
  const rgb = hexToRgb(hex)
  document.documentElement.style.setProperty('--nd-accent', rgb)
  // Derive a slightly darker hover variant
  const h = hex.replace('#', '')
  const r = Math.max(0, parseInt(h.substring(0, 2), 16) - 22)
  const g = Math.max(0, parseInt(h.substring(2, 4), 16) - 31)
  const b = Math.max(0, parseInt(h.substring(4, 6), 16) - 11)
  document.documentElement.style.setProperty('--nd-accent-hover', `${r} ${g} ${b}`)
}

/** Apply density data attribute to :root */
export function applyDensity(density: InterfaceDensity): void {
  document.documentElement.dataset.density = density
}
