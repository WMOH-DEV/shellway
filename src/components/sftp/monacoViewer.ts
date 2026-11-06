import { loader } from '@monaco-editor/react'
import * as monaco from 'monaco-editor'
import type * as MonacoEditor from 'monaco-editor'

loader.config({ monaco })

if (typeof self !== 'undefined' && !self.MonacoEnvironment) {
  self.MonacoEnvironment = {
    getWorker(_: unknown, _label: string) {
      return new Worker(
        new URL('monaco-editor/esm/vs/editor/editor.worker.js', import.meta.url),
        { type: 'module' }
      )
    },
  }
}

let themeRegistered = false

export function ensureViewerTheme(monacoInstance: typeof MonacoEditor) {
  if (themeRegistered) return
  monacoInstance.editor.defineTheme('shellway-viewer', {
    base: 'vs-dark',
    inherit: true,
    rules: [
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
      { token: 'constant', foreground: 'c084fc' },
    ],
    colors: {
      'editor.background': '#0c0e14',
      'editor.foreground': '#e2e8f0',
      'editor.lineHighlightBackground': '#1e293b30',
      'editor.selectionBackground': '#6d28d970',
      'editor.inactiveSelectionBackground': '#6d28d940',
      'editor.selectionHighlightBackground': '#6d28d918',
      'editor.selectionHighlightBorder': '#a78bfa50',
      'editor.wordHighlightBackground': '#00000000',
      'editor.wordHighlightBorder': '#64748b80',
      'editor.wordHighlightStrongBackground': '#00000000',
      'editor.wordHighlightStrongBorder': '#94a3b8a0',
      'editor.findMatchBackground': '#fbbf2440',
      'editor.findMatchBorder': '#fbbf24',
      'editor.findMatchHighlightBackground': '#fbbf2420',
      'editor.findMatchHighlightBorder': '#fbbf2460',
      'editorCursor.foreground': '#38bdf8',
      'editorGutter.background': '#0c0e14',
      'editorLineNumber.foreground': '#334155',
      'editorLineNumber.activeForeground': '#64748b',
      'editorWidget.background': '#0f1117',
      'editorWidget.border': '#1e293b',
      'editorWidget.foreground': '#e2e8f0',
      'editorWidget.resizeBorder': '#38bdf8',
      'input.background': '#1e293b',
      'input.foreground': '#e2e8f0',
      'input.border': '#334155',
      'inputOption.activeBorder': '#38bdf8',
      'inputOption.activeBackground': '#38bdf830',
      'inputOption.activeForeground': '#e2e8f0',
      'focusBorder': '#38bdf8',
      'list.activeSelectionBackground': '#38bdf830',
      'list.hoverBackground': '#1e293b60',
      'scrollbarSlider.background': '#334155',
      'scrollbarSlider.hoverBackground': '#475569',
      'scrollbarSlider.activeBackground': '#64748b',
      'minimap.background': '#0c0e14',
      'minimap.selectionHighlight': '#6d28d960',
      'minimap.findMatchHighlight': '#fbbf2480',
    },
  })
  themeRegistered = true
}
