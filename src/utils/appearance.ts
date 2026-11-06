import { DEFAULT_SETTINGS, type InterfaceDensity } from '@/types/settings'

type Rgb = [number, number, number]

const READABLE_ON_WHITE = 4.5
const DARKEN_STEP = 0.95
const ACCENT_VARS = ['--nd-accent', '--nd-accent-hover', '--nd-accent-solid', '--nd-accent-solid-hover']

function parseHex(hex: string): Rgb {
  const h = hex.replace('#', '')
  return [0, 2, 4].map((i) => parseInt(h.substring(i, i + 2), 16)) as Rgb
}

const channels = (rgb: Rgb): string => rgb.join(' ')

function luminance(rgb: Rgb): number {
  const [r, g, b] = rgb.map((c) => {
    const s = c / 255
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
  })
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

export function contrastWithWhite(rgb: Rgb): number {
  return 1.05 / (luminance(rgb) + 0.05)
}

const darken = (rgb: Rgb): Rgb => rgb.map((c) => Math.round(c * DARKEN_STEP)) as Rgb

export function solidAccent(hex: string): { solid: string; hover: string } {
  let solid = parseHex(hex)
  while (contrastWithWhite(solid) < READABLE_ON_WHITE) solid = darken(solid)
  return { solid: channels(solid), hover: channels(darken(solid)) }
}

export function applyAccentColor(hex: string): void {
  const style = document.documentElement.style
  if (hex.toLowerCase() === DEFAULT_SETTINGS.accentColor) {
    ACCENT_VARS.forEach((name) => style.removeProperty(name))
    return
  }
  const [r, g, b] = parseHex(hex)
  const { solid, hover } = solidAccent(hex)
  style.setProperty('--nd-accent', channels([r, g, b]))
  style.setProperty('--nd-accent-hover', channels([Math.max(0, r - 22), Math.max(0, g - 31), Math.max(0, b - 11)]))
  style.setProperty('--nd-accent-solid', solid)
  style.setProperty('--nd-accent-solid-hover', hover)
}

export function applyDensity(density: InterfaceDensity): void {
  document.documentElement.dataset.density = density
}
