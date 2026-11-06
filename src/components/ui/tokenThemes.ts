import { useMemo } from 'react'
import { themeQuartz } from 'ag-grid-community'
import type * as MonacoEditor from 'monaco-editor'
import { useUIStore } from '@/stores/uiStore'

type Rgb = [number, number, number]

export const MONACO_THEME = 'shellway'

const DARK_SYNTAX: MonacoEditor.editor.ITokenThemeRule[] = [
  { token: 'keyword', foreground: '38bdf8', fontStyle: 'bold' },
  { token: 'string', foreground: '86efac' },
  { token: 'string.key.json', foreground: '7dd3fc' },
  { token: 'string.value.json', foreground: '86efac' },
  { token: 'number', foreground: 'fbbf24' },
  { token: 'comment', foreground: '64748b', fontStyle: 'italic' },
  { token: 'operator', foreground: 'e2e8f0' },
  { token: 'predefined', foreground: 'c084fc' },
  { token: 'type', foreground: '22d3ee' },
  { token: 'variable', foreground: 'e2e8f0' },
  { token: 'tag', foreground: 'f472b6' },
  { token: 'attribute.name', foreground: 'fbbf24' },
  { token: 'attribute.value', foreground: '86efac' },
  { token: 'delimiter', foreground: '94a3b8' },
  { token: 'constant', foreground: 'c084fc' }
]

function readPalette() {
  const styles = getComputedStyle(document.documentElement)
  const token = (name: string): Rgb => styles.getPropertyValue(`--nd-${name}`).trim().split(/\s+/).map(Number) as Rgb
  return {
    primary: token('bg-primary'),
    secondary: token('bg-secondary'),
    sunken: token('bg-sunken'),
    surface: token('surface'),
    surfaceHover: token('surface-hover'),
    border: token('border'),
    borderHover: token('border-hover'),
    text: token('text-primary'),
    muted: token('text-muted'),
    faint: token('text-faint'),
    accent: token('accent'),
    warning: token('warning')
  }
}

type Palette = ReturnType<typeof readPalette>

const hex = (rgb: Rgb, alpha = ''): string => `#${rgb.map((c) => c.toString(16).padStart(2, '0')).join('')}${alpha}`
const css = ([r, g, b]: Rgb, alpha = 1): string => `rgba(${r}, ${g}, ${b}, ${alpha})`

function monacoTheme(p: Palette, isLight: boolean): MonacoEditor.editor.IStandaloneThemeData {
  return {
    base: isLight ? 'vs' : 'vs-dark',
    inherit: true,
    rules: isLight ? [] : DARK_SYNTAX,
    colors: {
      'editor.background': hex(p.sunken),
      'editor.foreground': hex(p.text),
      'editor.lineHighlightBackground': hex(p.border, '60'),
      'editor.selectionBackground': hex(p.accent, '40'),
      'editor.inactiveSelectionBackground': hex(p.accent, '20'),
      'editor.selectionHighlightBackground': hex(p.accent, '18'),
      'editor.selectionHighlightBorder': hex(p.accent, '50'),
      'editor.wordHighlightBackground': '#00000000',
      'editor.wordHighlightBorder': hex(p.faint, '80'),
      'editor.wordHighlightStrongBackground': '#00000000',
      'editor.wordHighlightStrongBorder': hex(p.muted, 'a0'),
      'editor.findMatchBackground': hex(p.warning, '40'),
      'editor.findMatchBorder': hex(p.warning),
      'editor.findMatchHighlightBackground': hex(p.warning, '20'),
      'editor.findMatchHighlightBorder': hex(p.warning, '60'),
      'editorCursor.foreground': hex(p.accent),
      'editorGutter.background': hex(p.sunken),
      'editorLineNumber.foreground': hex(p.faint),
      'editorLineNumber.activeForeground': hex(p.muted),
      'editorWidget.background': hex(p.surface),
      'editorWidget.border': hex(p.border),
      'editorWidget.foreground': hex(p.text),
      'editorWidget.resizeBorder': hex(p.accent),
      'input.background': hex(p.sunken),
      'input.foreground': hex(p.text),
      'input.border': hex(p.border),
      'inputOption.activeBorder': hex(p.accent),
      'inputOption.activeBackground': hex(p.accent, '30'),
      'inputOption.activeForeground': hex(p.text),
      focusBorder: hex(p.accent),
      'list.activeSelectionBackground': hex(p.accent, '30'),
      'list.hoverBackground': hex(p.surfaceHover),
      'scrollbarSlider.background': hex(p.border),
      'scrollbarSlider.hoverBackground': hex(p.borderHover),
      'scrollbarSlider.activeBackground': hex(p.faint),
      'minimap.background': hex(p.sunken),
      'minimap.selectionHighlight': hex(p.accent, '60'),
      'minimap.findMatchHighlight': hex(p.warning, '80')
    }
  }
}

function gridTheme(p: Palette) {
  return themeQuartz.withParams({
    headerFontWeight: 600,
    cellEditingBorder: { color: css(p.accent), style: 'solid', width: 1 },
    borderRadius: 0,
    wrapperBorderRadius: 0,
    fontFamily: 'inherit',
    fontSize: 13,
    headerFontSize: 12,
    iconSize: 12,
    cellHorizontalPadding: 10,
    spacing: 4,
    columnBorder: true,
    backgroundColor: css(p.primary),
    foregroundColor: css(p.text),
    headerBackgroundColor: css(p.secondary),
    headerTextColor: css(p.muted),
    borderColor: css(p.border),
    rowBorder: true,
    rowHoverColor: css(p.surfaceHover),
    selectedRowBackgroundColor: css(p.accent, 0.12),
    headerColumnResizeHandleColor: css(p.borderHover),
    chromeBackgroundColor: css(p.secondary),
    oddRowBackgroundColor: css(p.secondary)
  })
}

export function buildTokenThemes(isLight: boolean) {
  const palette = readPalette()
  return { monaco: monacoTheme(palette, isLight), grid: gridTheme(palette) }
}

export function useGridTheme() {
  const resolvedTheme = useUIStore((s) => s.resolvedTheme)
  return useMemo(() => buildTokenThemes(resolvedTheme === 'light').grid, [resolvedTheme])
}

const isLightNow = (): boolean => document.documentElement.classList.contains('light')

function applyMonacoTheme(monaco: typeof MonacoEditor): void {
  monaco.editor.defineTheme(MONACO_THEME, buildTokenThemes(isLightNow()).monaco)
  monaco.editor.setTheme(MONACO_THEME)
}

let followingTheme = false

export function syncMonacoTheme(monaco: typeof MonacoEditor): void {
  applyMonacoTheme(monaco)
  if (followingTheme) return
  followingTheme = true
  useUIStore.subscribe((state, previous) => {
    if (state.resolvedTheme !== previous.resolvedTheme) applyMonacoTheme(monaco)
  })
}
