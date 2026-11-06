import { beforeEach, describe, expect, it } from 'vitest'
import { buildTokenThemes } from './tokenThemes'

const TOKENS: Record<string, string> = {
  'bg-primary': '11 14 20',
  'bg-secondary': '14 18 25',
  'bg-sunken': '9 12 17',
  surface: '16 20 28',
  'surface-hover': '21 27 39',
  border: '31 37 50',
  'border-hover': '44 53 70',
  'text-primary': '230 234 242',
  'text-muted': '139 149 167',
  'text-faint': '79 90 109',
  accent: '79 140 255',
  warning: '242 176 74'
}

describe('buildTokenThemes', () => {
  beforeEach(() => {
    for (const [name, value] of Object.entries(TOKENS)) document.documentElement.style.setProperty(`--nd-${name}`, value)
  })

  it('builds the editor colors from the current tokens', () => {
    const { colors } = buildTokenThemes(false).monaco
    expect(colors['editor.background']).toBe('#090c11')
    expect(colors['editor.selectionBackground']).toBe('#4f8cff40')
    expect(colors['editorLineNumber.foreground']).toBe('#4f5a6d')
  })

  it('uses the light base and default syntax colors on the light theme', () => {
    const { base, rules } = buildTokenThemes(true).monaco
    expect(base).toBe('vs')
    expect(rules).toEqual([])
  })

  it('follows a token change on the next build', () => {
    document.documentElement.style.setProperty('--nd-bg-sunken', '238 241 246')
    expect(buildTokenThemes(true).monaco.colors['editor.background']).toBe('#eef1f6')
  })
})
