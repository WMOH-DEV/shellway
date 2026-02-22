/**
 * Canvas-based monospace font detection.
 *
 * Measures a test string rendered in each candidate font against a baseline
 * monospace fallback.  If the measured width differs, the font is present.
 * Results are computed once and cached for the lifetime of the page.
 */

const MONOSPACE_FONTS = [
  // Premium / coding fonts
  'JetBrains Mono',
  'Fira Code',
  'Cascadia Code',
  'Cascadia Mono',
  'Source Code Pro',
  'IBM Plex Mono',
  'Hack',
  'Iosevka',
  'Victor Mono',
  'Recursive Mono',
  'Monaspace Neon',
  'Monaspace Argon',
  'Geist Mono',
  'Maple Mono',
  'Commit Mono',
  'Intel One Mono',

  // Classic monospace
  'Consolas',
  'Menlo',
  'Monaco',
  'SF Mono',
  'DejaVu Sans Mono',
  'Liberation Mono',
  'Ubuntu Mono',
  'Droid Sans Mono',
  'Roboto Mono',
  'Noto Sans Mono',
  'Inconsolata',
  'Anonymous Pro',
  'PT Mono',

  // System defaults
  'Courier New',
  'Courier',
  'Lucida Console',
]

export interface FontInfo {
  name: string
  available: boolean
}

function isFontAvailable(fontName: string): boolean {
  const canvas = document.createElement('canvas')
  const ctx = canvas.getContext('2d')
  if (!ctx) return false

  const testString = 'mmmmmmmmmmlli1|WwQq@#'
  const baseFont = 'monospace'
  const size = '72px'

  ctx.font = `${size} ${baseFont}`
  const baseWidth = ctx.measureText(testString).width

  ctx.font = `${size} "${fontName}", ${baseFont}`
  const testWidth = ctx.measureText(testString).width

  return baseWidth !== testWidth
}

let _cache: FontInfo[] | null = null

/**
 * Returns a list of known monospace / terminal fonts with availability flags.
 * The result is cached after the first call.
 */
export function getAvailableMonospaceFonts(): FontInfo[] {
  if (_cache) return _cache

  _cache = MONOSPACE_FONTS.map((name) => ({
    name,
    available: isFontAvailable(name),
  }))

  return _cache
}
