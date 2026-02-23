import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import {
  FileText,
  ImageIcon,
  Code,
  AlertTriangle,
  WrapText,
  Map,
  Copy,
  Check,
  ZoomIn,
  ZoomOut,
  RotateCcw,
  Search,
  X,
} from 'lucide-react'
import Editor, { loader, type OnMount } from '@monaco-editor/react'
import * as monaco from 'monaco-editor'
import type * as MonacoEditor from 'monaco-editor'
import { Modal } from '@/components/ui/Modal'
import { Spinner } from '@/components/ui/Spinner'
import { cn } from '@/utils/cn'

// ---------------------------------------------------------------------------
// Monaco setup — local bundling for Electron (no CDN)
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Shellway dark theme for Monaco
// ---------------------------------------------------------------------------

let themeRegistered = false

function ensureViewerTheme(monacoInstance: typeof MonacoEditor) {
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
      // Selection (double-click / drag): opaque violet — unmistakable
      'editor.selectionBackground': '#6d28d970',
      'editor.inactiveSelectionBackground': '#6d28d940',
      // Other occurrences of selected text: very faint violet, no fill confusion
      'editor.selectionHighlightBackground': '#6d28d918',
      'editor.selectionHighlightBorder': '#a78bfa50',
      // Word highlight (single click): NO fill — border only, clearly different from selection
      'editor.wordHighlightBackground': '#00000000',
      'editor.wordHighlightBorder': '#64748b80',
      'editor.wordHighlightStrongBackground': '#00000000',
      'editor.wordHighlightStrongBorder': '#94a3b8a0',
      // Find match highlighting: amber/gold
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

// ---------------------------------------------------------------------------
// File extension → Monaco language mapping
// ---------------------------------------------------------------------------

const EXT_TO_LANGUAGE: Record<string, string> = {
  // JavaScript / TypeScript
  js: 'javascript', jsx: 'javascript', mjs: 'javascript', cjs: 'javascript',
  ts: 'typescript', tsx: 'typescript', mts: 'typescript', cts: 'typescript',
  // Web
  html: 'html', htm: 'html', css: 'css', scss: 'scss', less: 'less',
  // Data / Config
  json: 'json', jsonc: 'json', json5: 'json',
  xml: 'xml', svg: 'xml', xsl: 'xml',
  yaml: 'yaml', yml: 'yaml',
  toml: 'ini', ini: 'ini', conf: 'ini', cfg: 'ini', properties: 'ini',
  env: 'ini',
  // Scripting
  py: 'python', pyw: 'python',
  rb: 'ruby', rake: 'ruby',
  php: 'php',
  lua: 'lua',
  pl: 'perl', pm: 'perl',
  r: 'r',
  // Systems
  go: 'go',
  rs: 'rust',
  c: 'c', h: 'c',
  cpp: 'cpp', cc: 'cpp', cxx: 'cpp', hpp: 'cpp', hh: 'cpp', hxx: 'cpp',
  cs: 'csharp',
  java: 'java',
  kt: 'kotlin', kts: 'kotlin',
  swift: 'swift',
  m: 'objective-c',
  scala: 'scala',
  dart: 'dart',
  // Shell
  sh: 'shell', bash: 'shell', zsh: 'shell', fish: 'shell',
  ps1: 'powershell', psm1: 'powershell',
  bat: 'bat', cmd: 'bat',
  // Markup / Docs
  md: 'markdown', mdx: 'markdown',
  tex: 'latex', latex: 'latex',
  // Query
  sql: 'sql',
  graphql: 'graphql', gql: 'graphql',
  // DevOps
  dockerfile: 'dockerfile',
  // Other
  txt: 'plaintext', log: 'plaintext', text: 'plaintext',
  csv: 'plaintext', tsv: 'plaintext',
  makefile: 'plaintext',
  gitignore: 'plaintext',
  editorconfig: 'ini',
  // Functional
  hs: 'haskell',
  ex: 'elixir', exs: 'elixir',
  erl: 'erlang',
  clj: 'clojure', cljs: 'clojure',
}

/** Files with no extension that are commonly text files */
const KNOWN_TEXTFILES = new Set([
  'makefile', 'dockerfile', 'vagrantfile', 'gemfile', 'rakefile',
  'procfile', 'brewfile', 'justfile',
  '.gitignore', '.gitattributes', '.gitmodules',
  '.dockerignore', '.editorconfig', '.eslintrc', '.prettierrc',
  '.babelrc', '.npmrc', '.nvmrc', '.env',
  'license', 'licence', 'readme', 'changelog', 'authors', 'todo',
  'contributing', 'codeowners',
])

// ---------------------------------------------------------------------------
// Image extensions
// ---------------------------------------------------------------------------

const IMAGE_EXTS = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'ico', 'svg'])

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MAX_FILE_SIZE = 5 * 1024 * 1024 // 5 MB (matches SFTPService limit)

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

interface FilePreviewProps {
  open: boolean
  onClose: () => void
  connectionId: string
  filePath: string
  fileName: string
  fileSize: number
}

function getExtension(name: string): string {
  const dot = name.lastIndexOf('.')
  if (dot === -1 || dot === name.length - 1) return ''
  return name.slice(dot + 1).toLowerCase()
}

function getLanguageFromFileName(name: string): string {
  const ext = getExtension(name)
  if (ext && EXT_TO_LANGUAGE[ext]) return EXT_TO_LANGUAGE[ext]

  // Check known text files by full name
  const lower = name.toLowerCase()
  if (KNOWN_TEXTFILES.has(lower)) return 'plaintext'

  // Dotfiles with no further extension
  if (lower.startsWith('.') && !ext) return 'plaintext'

  return 'plaintext'
}

function isImageFile(name: string): boolean {
  return IMAGE_EXTS.has(getExtension(name))
}

/** Detect likely binary content by checking for null bytes */
function isBinaryContent(content: string): boolean {
  const sample = content.slice(0, 8192)
  let nullCount = 0
  for (let i = 0; i < sample.length; i++) {
    if (sample.charCodeAt(i) === 0) nullCount++
  }
  return nullCount > sample.length * 0.01
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1_048_576) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1_048_576).toFixed(2)} MB`
}

// ---------------------------------------------------------------------------
// Image viewer with zoom / pan
// ---------------------------------------------------------------------------

function ImageViewer({ src, alt }: { src: string; alt: string }) {
  const [scale, setScale] = useState(1)
  const positionRef = useRef({ x: 0, y: 0 })
  const [renderPos, setRenderPos] = useState({ x: 0, y: 0 })
  const [isDragging, setIsDragging] = useState(false)
  const dragStart = useRef({ x: 0, y: 0 })
  const posStart = useRef({ x: 0, y: 0 })
  const containerRef = useRef<HTMLDivElement>(null)
  const scaleRef = useRef(1)

  const handleZoomIn = useCallback(() => setScale((s) => { const v = Math.min(s * 1.3, 8); scaleRef.current = v; return v }), [])
  const handleZoomOut = useCallback(() => setScale((s) => { const v = Math.max(s / 1.3, 0.1); scaleRef.current = v; return v }), [])
  const handleReset = useCallback(() => {
    setScale(1)
    scaleRef.current = 1
    positionRef.current = { x: 0, y: 0 }
    setRenderPos({ x: 0, y: 0 })
  }, [])

  // Use native event listener for wheel to allow preventDefault (passive: false)
  useEffect(() => {
    const el = containerRef.current
    if (!el) return

    const handler = (e: WheelEvent) => {
      e.preventDefault()
      const delta = e.deltaY > 0 ? 0.9 : 1.1
      setScale((s) => {
        const v = Math.min(Math.max(s * delta, 0.1), 8)
        scaleRef.current = v
        return v
      })
    }

    el.addEventListener('wheel', handler, { passive: false })
    return () => el.removeEventListener('wheel', handler)
  }, [])

  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      if (scaleRef.current <= 1) return
      setIsDragging(true)
      dragStart.current = { x: e.clientX, y: e.clientY }
      posStart.current = { ...positionRef.current }
    },
    []
  )

  const handleMouseMove = useCallback(
    (e: React.MouseEvent) => {
      if (!isDragging) return
      const dx = e.clientX - dragStart.current.x
      const dy = e.clientY - dragStart.current.y
      const newPos = { x: posStart.current.x + dx, y: posStart.current.y + dy }
      positionRef.current = newPos
      setRenderPos(newPos)
    },
    [isDragging]
  )

  const handleMouseUp = useCallback(() => setIsDragging(false), [])

  return (
    <div className="flex flex-col h-full">
      {/* Image toolbar */}
      <div className="shrink-0 flex items-center gap-1 px-3 py-1.5 border-b border-nd-border bg-nd-bg-tertiary/50">
        <button
          onClick={handleZoomIn}
          className="p-1.5 rounded hover:bg-nd-surface text-nd-text-muted hover:text-nd-text-primary transition-colors"
          title="Zoom in"
        >
          <ZoomIn size={14} />
        </button>
        <button
          onClick={handleZoomOut}
          className="p-1.5 rounded hover:bg-nd-surface text-nd-text-muted hover:text-nd-text-primary transition-colors"
          title="Zoom out"
        >
          <ZoomOut size={14} />
        </button>
        <button
          onClick={handleReset}
          className="p-1.5 rounded hover:bg-nd-surface text-nd-text-muted hover:text-nd-text-primary transition-colors"
          title="Reset zoom"
        >
          <RotateCcw size={14} />
        </button>
        <span className="ml-2 text-xs text-nd-text-muted tabular-nums">{Math.round(scale * 100)}%</span>
      </div>

      {/* Image canvas */}
      <div
        ref={containerRef}
        className={cn(
          'flex-1 min-h-0 overflow-hidden flex items-center justify-center',
          'bg-[#0a0c10]',
          scale > 1 ? 'cursor-grab' : 'cursor-default',
          isDragging && 'cursor-grabbing'
        )}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
      >
        <img
          src={src}
          alt={alt}
          className="max-w-full max-h-full object-contain select-none"
          style={{
            transform: `translate(${renderPos.x}px, ${renderPos.y}px) scale(${scale})`,
            transition: isDragging ? 'none' : 'transform 0.15s ease',
          }}
          draggable={false}
        />
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// FilePreview component
// ---------------------------------------------------------------------------

export function FilePreview({
  open,
  onClose,
  connectionId,
  filePath,
  fileName: name,
  fileSize,
}: FilePreviewProps) {
  const [loading, setLoading] = useState(false)
  const [content, setContent] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [wordWrap, setWordWrap] = useState(true)
  const [showMinimap, setShowMinimap] = useState(false)
  const [copied, setCopied] = useState(false)

  // MutationObserver ref — strips native tooltips from find widget buttons
  const tooltipObserverRef = useRef<MutationObserver | null>(null)

  const ext = useMemo(() => getExtension(name), [name])
  const isImage = useMemo(() => isImageFile(name), [name])
  const language = useMemo(() => getLanguageFromFileName(name), [name])
  const tooLarge = fileSize > MAX_FILE_SIZE

  // Binary content detection (after content is loaded)
  const isBinary = useMemo(() => {
    if (!content || isImage) return false
    return isBinaryContent(content)
  }, [content, isImage])

  // Line count for the status bar
  const lineCount = useMemo(() => {
    if (!content || isImage || isBinary) return 0
    return content.split('\n').length
  }, [content, isImage, isBinary])

  // Fetch file content when the modal opens
  useEffect(() => {
    if (!open) {
      setContent(null)
      setError(null)
      setLoading(false)
      tooltipObserverRef.current?.disconnect()
      tooltipObserverRef.current = null
      return
    }

    if (tooLarge) return

    let cancelled = false
    setLoading(true)
    setError(null)
    setContent(null)

    window.novadeck.sftp
      .readFile(connectionId, filePath)
      .then((result) => {
        if (cancelled) return
        if (result.success && result.data !== undefined) {
          setContent(result.data)
        } else {
          setError(result.error ?? 'Failed to read file')
        }
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(String(err))
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })

    return () => {
      cancelled = true
    }
  }, [open, connectionId, filePath, tooLarge])

  // Build the data URL for images
  const imageDataUrl = useMemo(() => {
    if (!isImage || !content) return null
    const mime = ext === 'svg' ? 'image/svg+xml' : `image/${ext === 'jpg' ? 'jpeg' : ext}`
    return `data:${mime};base64,${content}`
  }, [isImage, content, ext])

  // Copy all content to clipboard
  const handleCopy = useCallback(async () => {
    if (!content) return
    try {
      await navigator.clipboard.writeText(content)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      // Clipboard API may be unavailable — try legacy fallback
      try {
        const textarea = document.createElement('textarea')
        textarea.value = content
        textarea.style.position = 'fixed'
        textarea.style.opacity = '0'
        document.body.appendChild(textarea)
        textarea.select()
        document.execCommand('copy')
        document.body.removeChild(textarea)
        setCopied(true)
        setTimeout(() => setCopied(false), 2000)
      } catch {
        console.warn('FilePreview: clipboard copy failed')
      }
    }
  }, [content])

  // Custom escape handling: don't close modal when Monaco's find widget is open
  useEffect(() => {
    if (!open) return

    const handler = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return

      // Check if Monaco's find widget is visible
      const findWidget = document.querySelector('.monaco-editor .find-widget.visible')
      if (findWidget) {
        // Let Monaco handle closing its own find widget — don't close the modal
        return
      }

      e.stopPropagation()
      onClose()
    }

    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [open, onClose])

  // Monaco editor mount
  const handleEditorMount: OnMount = useCallback(
    (editor, monacoInstance) => {
      ensureViewerTheme(monacoInstance)
      monacoInstance.editor.setTheme('shellway-viewer')

      // Strip native `title` tooltips from find widget buttons.
      // They cause flicker inside the modal because the browser tooltip
      // fights with the button hover state in the constrained space.
      const editorDom = editor.getDomNode()
      if (editorDom) {
        const stripFindWidgetTooltips = () => {
          // Temporarily disconnect to avoid self-triggering on attribute removal
          observer.disconnect()
          editorDom.querySelectorAll('.find-widget [title]').forEach((el) => {
            el.removeAttribute('title')
          })
          observer.observe(editorDom, {
            childList: true,
            subtree: true,
            attributes: true,
            attributeFilter: ['title'],
          })
        }

        tooltipObserverRef.current?.disconnect()
        const observer = new MutationObserver(stripFindWidgetTooltips)
        observer.observe(editorDom, {
          childList: true,
          subtree: true,
          attributes: true,
          attributeFilter: ['title'],
        })
        tooltipObserverRef.current = observer
      }
    },
    []
  )

  // Monaco editor options
  const editorOptions = useMemo(
    (): MonacoEditor.editor.IStandaloneEditorConstructionOptions => ({
      readOnly: true,
      domReadOnly: true,
      fontSize: 13,
      fontFamily: "'JetBrains Mono', 'Fira Code', 'Cascadia Code', monospace",
      fontLigatures: true,
      lineNumbers: 'on',
      tabSize: 2,
      wordWrap: wordWrap ? 'on' : 'off',
      scrollBeyondLastLine: false,
      automaticLayout: true,
      minimap: { enabled: showMinimap },
      padding: { top: 12, bottom: 12 },
      renderLineHighlight: 'line',
      matchBrackets: 'always',
      folding: true,
      foldingHighlight: true,
      glyphMargin: false,
      lineDecorationsWidth: 8,
      fixedOverflowWidgets: true,
      scrollbar: {
        vertical: 'auto',
        horizontal: 'auto',
        verticalScrollbarSize: 10,
        horizontalScrollbarSize: 10,
      },
      overviewRulerBorder: false,
      overviewRulerLanes: 0,
      hideCursorInOverviewRuler: true,
      renderWhitespace: 'none',
      guides: {
        indentation: true,
        bracketPairs: true,
      },
      bracketPairColorization: {
        enabled: true,
      },
      smoothScrolling: true,
      cursorBlinking: 'smooth',
      cursorSmoothCaretAnimation: 'on',
      find: {
        addExtraSpaceOnTop: false,
        autoFindInSelection: 'never',
        seedSearchStringFromSelection: 'always',
      },
      contextmenu: true,
      copyWithSyntaxHighlighting: true,
      links: true,
      colorDecorators: true,
    }),
    [wordWrap, showMinimap]
  )

  // Determine what to display in the language badge
  const languageLabel = useMemo(() => {
    const map: Record<string, string> = {
      javascript: 'JavaScript', typescript: 'TypeScript',
      python: 'Python', ruby: 'Ruby', php: 'PHP',
      go: 'Go', rust: 'Rust', c: 'C', cpp: 'C++',
      csharp: 'C#', java: 'Java', kotlin: 'Kotlin',
      swift: 'Swift', dart: 'Dart', scala: 'Scala',
      shell: 'Shell', powershell: 'PowerShell', bat: 'Batch',
      html: 'HTML', css: 'CSS', scss: 'SCSS', less: 'LESS',
      json: 'JSON', xml: 'XML', yaml: 'YAML',
      sql: 'SQL', graphql: 'GraphQL',
      markdown: 'Markdown', latex: 'LaTeX',
      ini: 'Config', plaintext: 'Plain Text',
      dockerfile: 'Dockerfile',
      haskell: 'Haskell', elixir: 'Elixir', erlang: 'Erlang',
      clojure: 'Clojure', perl: 'Perl', lua: 'Lua', r: 'R',
      'objective-c': 'Objective-C',
    }
    return map[language] ?? language
  }, [language])

  // Render body content
  const renderContent = useCallback(() => {
    // Too large guard
    if (tooLarge) {
      return (
        <div className="flex flex-col items-center justify-center gap-3 h-full text-nd-text-muted">
          <AlertTriangle size={36} className="text-nd-error/70" />
          <p className="text-sm font-medium">File too large to preview</p>
          <p className="text-xs text-nd-text-muted">
            {formatFileSize(fileSize)} exceeds the {formatFileSize(MAX_FILE_SIZE)} limit
          </p>
          <p className="text-xs text-nd-text-muted mt-1">
            Use <span className="font-mono text-nd-text-secondary">View / Edit</span> to open in an external editor
          </p>
        </div>
      )
    }

    // Loading
    if (loading) {
      return (
        <div className="flex flex-col items-center justify-center gap-3 h-full">
          <Spinner size="lg" />
          <p className="text-xs text-nd-text-muted">Loading file...</p>
        </div>
      )
    }

    // Error
    if (error) {
      return (
        <div className="flex flex-col items-center justify-center gap-3 h-full text-nd-error">
          <AlertTriangle size={32} />
          <p className="text-sm font-medium">Failed to load file</p>
          <p className="text-xs text-nd-text-muted max-w-md text-center">{error}</p>
        </div>
      )
    }

    // No content yet
    if (content === null) return null

    // Binary content detected
    if (isBinary) {
      return (
        <div className="flex flex-col items-center justify-center gap-3 h-full text-nd-text-muted">
          <FileText size={36} className="opacity-40" />
          <p className="text-sm font-medium">Binary file</p>
          <p className="text-xs">This file contains binary data and cannot be displayed as text</p>
          <p className="text-xs text-nd-text-muted mt-1">
            Use <span className="font-mono text-nd-text-secondary">View / Edit</span> to open in an external editor
          </p>
        </div>
      )
    }

    // Image
    if (isImage && imageDataUrl) {
      return <ImageViewer src={imageDataUrl} alt={name} />
    }

    // Text / Code — Monaco Editor
    return (
      <Editor
        language={language}
        theme="shellway-viewer"
        value={content}
        options={editorOptions}
        onMount={handleEditorMount}
        loading={
          <div className="flex items-center justify-center h-full text-nd-text-muted text-sm">
            <Spinner size="md" />
          </div>
        }
      />
    )
  }, [
    tooLarge, loading, error, content, isBinary, isImage, imageDataUrl,
    name, language, editorOptions, handleEditorMount, fileSize,
  ])

  return (
    <Modal
      open={open}
      onClose={onClose}
      title=""
      maxWidth="max-w-[92vw]"
      className="!max-h-[92vh]"
      closeOnEscape={false}
    >
      {/* ─── Header bar ─── */}
      <div className="flex items-center gap-3 -mt-2 mb-3">
        {/* File icon + name */}
        <div className="flex items-center gap-2 min-w-0 flex-1">
          {isImage ? (
            <ImageIcon size={15} className="text-nd-accent shrink-0" />
          ) : (
            <Code size={15} className="text-nd-accent shrink-0" />
          )}
          <span className="text-sm font-medium text-nd-text-primary truncate" title={name}>
            {name}
          </span>
        </div>

        {/* File size */}
        <span className="text-xs text-nd-text-muted shrink-0 tabular-nums">
          {formatFileSize(fileSize)}
        </span>

        {/* Close button */}
        <button
          onClick={onClose}
          className="shrink-0 rounded-md p-1 text-nd-text-muted hover:text-nd-text-primary hover:bg-nd-surface transition-colors"
          title="Close"
        >
          <X size={16} />
        </button>
      </div>

      {/* ─── Toolbar (only for text content) ─── */}
      {!isImage && !tooLarge && content && !isBinary && (
        <div className="flex items-center gap-1 mb-2 -mx-1">
          {/* Language badge */}
          <span className="px-2 py-0.5 text-2xs font-medium rounded bg-nd-accent/15 text-nd-accent border border-nd-accent/20 mr-1">
            {languageLabel}
          </span>

          {/* Line count */}
          <span className="text-2xs text-nd-text-muted tabular-nums mr-auto">
            {lineCount.toLocaleString()} {lineCount === 1 ? 'line' : 'lines'}
          </span>

          {/* Word wrap toggle */}
          <button
            onClick={() => setWordWrap((v) => !v)}
            className={cn(
              'flex items-center gap-1.5 px-2 py-1 rounded text-2xs transition-colors',
              wordWrap
                ? 'bg-nd-accent/15 text-nd-accent'
                : 'text-nd-text-muted hover:text-nd-text-secondary hover:bg-nd-surface'
            )}
            title={wordWrap ? 'Word wrap on' : 'Word wrap off'}
          >
            <WrapText size={13} />
            <span className="hidden sm:inline">Wrap</span>
          </button>

          {/* Minimap toggle */}
          <button
            onClick={() => setShowMinimap((v) => !v)}
            className={cn(
              'flex items-center gap-1.5 px-2 py-1 rounded text-2xs transition-colors',
              showMinimap
                ? 'bg-nd-accent/15 text-nd-accent'
                : 'text-nd-text-muted hover:text-nd-text-secondary hover:bg-nd-surface'
            )}
            title={showMinimap ? 'Minimap on' : 'Minimap off'}
          >
            <Map size={13} />
            <span className="hidden sm:inline">Minimap</span>
          </button>

          {/* Search hint */}
          <div className="hidden sm:flex items-center gap-1 px-2 py-1 text-2xs text-nd-text-muted" title="Search in file">
            <Search size={11} />
            <span className="font-mono">{navigator.platform?.includes('Mac') ? '⌘F' : 'Ctrl+F'}</span>
          </div>

          {/* Copy button */}
          <button
            onClick={handleCopy}
            className={cn(
              'flex items-center gap-1.5 px-2 py-1 rounded text-2xs transition-colors',
              copied
                ? 'bg-nd-success/15 text-nd-success'
                : 'text-nd-text-muted hover:text-nd-text-secondary hover:bg-nd-surface'
            )}
            title="Copy file content"
          >
            {copied ? <Check size={13} /> : <Copy size={13} />}
            <span className="hidden sm:inline">{copied ? 'Copied' : 'Copy'}</span>
          </button>
        </div>
      )}

      {/* ─── Main content area ─── */}
      <div
        className={cn(
          'rounded-md border border-nd-border overflow-hidden',
          'bg-[#0c0e14]',
        )}
        style={{ height: 'min(72vh, 800px)' }}
      >
        {renderContent()}
      </div>
    </Modal>
  )
}
