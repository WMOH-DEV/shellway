import { useState, useEffect, useCallback, useMemo, type ReactNode } from 'react'
import { FileText, ImageIcon, Code, AlertTriangle } from 'lucide-react'
import { Modal } from '@/components/ui/Modal'
import { Spinner } from '@/components/ui/Spinner'
import { cn } from '@/utils/cn'

interface FilePreviewProps {
  open: boolean
  onClose: () => void
  connectionId: string
  filePath: string
  fileName: string
  fileSize: number
}

const IMAGE_EXTS = new Set(['png', 'jpg', 'jpeg', 'gif', 'svg', 'webp', 'bmp', 'ico'])
const JSON_EXTS = new Set(['json'])
const MARKDOWN_EXTS = new Set(['md'])
const TEXT_EXTS = new Set([
  'txt', 'log', 'sh', 'bash', 'py', 'js', 'ts', 'tsx', 'jsx', 'css', 'html', 'xml',
  'yml', 'yaml', 'toml', 'ini', 'conf', 'cfg', 'env', 'sql', 'rs', 'go', 'rb', 'php',
  'java', 'c', 'cpp', 'h', 'hpp', 'cs', 'swift', 'kt', 'lua', 'pl', 'r', 'm',
])

const MAX_FILE_SIZE = 1_048_576 // 1 MB

type FileCategory = 'image' | 'json' | 'markdown' | 'text' | 'unknown'

function getExtension(name: string): string {
  const dot = name.lastIndexOf('.')
  if (dot === -1 || dot === name.length - 1) return ''
  return name.slice(dot + 1).toLowerCase()
}

function categorize(ext: string): FileCategory {
  if (IMAGE_EXTS.has(ext)) return 'image'
  if (JSON_EXTS.has(ext)) return 'json'
  if (MARKDOWN_EXTS.has(ext)) return 'markdown'
  if (TEXT_EXTS.has(ext)) return 'text'
  return 'unknown'
}

// ---------------------------------------------------------------------------
// Simple JSON syntax highlighter
// ---------------------------------------------------------------------------

function highlightJson(raw: string): ReactNode {
  let pretty: string
  try {
    pretty = JSON.stringify(JSON.parse(raw), null, 2)
  } catch {
    // If it's not valid JSON, just show raw
    pretty = raw
  }

  // Tokenize the pretty-printed JSON into colored spans.
  // We walk through the string and classify each token.
  const elements: ReactNode[] = []
  let i = 0
  let key = 0

  while (i < pretty.length) {
    const ch = pretty[i]

    // Whitespace / structural characters
    if (ch === '\n' || ch === '\r' || ch === ' ' || ch === '{' || ch === '}' || ch === '[' || ch === ']' || ch === ',' || ch === ':') {
      // Collect consecutive structural / whitespace chars
      let j = i
      while (
        j < pretty.length &&
        (pretty[j] === '\n' || pretty[j] === '\r' || pretty[j] === ' ' ||
         pretty[j] === '{' || pretty[j] === '}' || pretty[j] === '[' ||
         pretty[j] === ']' || pretty[j] === ',' || pretty[j] === ':')
      ) {
        j++
      }
      elements.push(<span key={key++} className="text-nd-text-secondary">{pretty.slice(i, j)}</span>)
      i = j
      continue
    }

    // String (starts with ")
    if (ch === '"') {
      let j = i + 1
      while (j < pretty.length) {
        if (pretty[j] === '\\') {
          j += 2 // skip escaped character
          continue
        }
        if (pretty[j] === '"') {
          j++
          break
        }
        j++
      }
      const str = pretty.slice(i, j)

      // Determine if this string is a key: look ahead past whitespace for a colon
      let k = j
      while (k < pretty.length && pretty[k] === ' ') k++
      const isKey = k < pretty.length && pretty[k] === ':'

      elements.push(
        <span key={key++} className={isKey ? 'text-blue-400' : 'text-green-400'}>
          {str}
        </span>
      )
      i = j
      continue
    }

    // Numbers
    if (ch === '-' || (ch >= '0' && ch <= '9')) {
      let j = i + 1
      while (j < pretty.length && /[0-9.eE+\-]/.test(pretty[j])) j++
      elements.push(<span key={key++} className="text-orange-400">{pretty.slice(i, j)}</span>)
      i = j
      continue
    }

    // Booleans (true / false)
    if (pretty.slice(i, i + 4) === 'true') {
      elements.push(<span key={key++} className="text-purple-400">true</span>)
      i += 4
      continue
    }
    if (pretty.slice(i, i + 5) === 'false') {
      elements.push(<span key={key++} className="text-purple-400">false</span>)
      i += 5
      continue
    }

    // Null
    if (pretty.slice(i, i + 4) === 'null') {
      elements.push(<span key={key++} className="text-red-400">null</span>)
      i += 4
      continue
    }

    // Fallback: consume one char
    elements.push(<span key={key++} className="text-nd-text-primary">{ch}</span>)
    i++
  }

  return <>{elements}</>
}

// ---------------------------------------------------------------------------
// Line-numbered text renderer
// ---------------------------------------------------------------------------

function LineNumberedText({ content, className }: { content: string; className?: string }) {
  const lines = content.split('\n')
  // Avoid trailing phantom empty line from a final newline
  const displayLines = lines.length > 1 && lines[lines.length - 1] === '' ? lines.slice(0, -1) : lines
  const gutterWidth = String(displayLines.length).length

  return (
    <div className={cn('flex text-xs leading-5', className)}>
      {/* Line number gutter */}
      <div
        className="shrink-0 select-none text-right pr-3 mr-3 border-r border-nd-border text-nd-text-muted"
        aria-hidden="true"
      >
        {displayLines.map((_, idx) => (
          <div key={idx} style={{ minWidth: `${gutterWidth}ch` }}>
            {idx + 1}
          </div>
        ))}
      </div>

      {/* Content */}
      <pre className="flex-1 overflow-x-auto whitespace-pre text-nd-text-primary font-mono">
        {displayLines.map((line, idx) => (
          <div key={idx}>{line || ' '}</div>
        ))}
      </pre>
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

  const ext = useMemo(() => getExtension(name), [name])
  const category = useMemo(() => categorize(ext), [ext])
  const tooLarge = fileSize > MAX_FILE_SIZE

  // Fetch file content when the modal opens
  useEffect(() => {
    if (!open) {
      // Reset state when modal closes
      setContent(null)
      setError(null)
      setLoading(false)
      return
    }

    if (tooLarge || category === 'unknown') return

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
  }, [open, connectionId, filePath, tooLarge, category])

  // Build the data URL for images
  const imageDataUrl = useMemo(() => {
    if (category !== 'image' || !content) return null
    const mime = ext === 'svg' ? 'image/svg+xml' : `image/${ext === 'jpg' ? 'jpeg' : ext}`
    return `data:${mime};base64,${content}`
  }, [category, content, ext])

  // Render the appropriate preview body
  const renderContent = useCallback((): ReactNode => {
    // Too large guard
    if (tooLarge) {
      return (
        <div className="flex flex-col items-center justify-center gap-3 py-12 text-nd-text-muted">
          <AlertTriangle size={32} className="text-nd-error/70" />
          <p className="text-sm">File too large to preview</p>
          <p className="text-xs text-nd-text-muted">
            {(fileSize / 1_048_576).toFixed(2)} MB exceeds the 1 MB limit
          </p>
        </div>
      )
    }

    // Unknown category guard
    if (category === 'unknown') {
      return (
        <div className="flex flex-col items-center justify-center gap-3 py-12 text-nd-text-muted">
          <FileText size={32} className="opacity-40" />
          <p className="text-sm">Preview not available for this file type</p>
          <p className="text-xs">.{ext || '(no extension)'}</p>
        </div>
      )
    }

    // Loading
    if (loading) {
      return (
        <div className="flex flex-col items-center justify-center gap-3 py-16">
          <Spinner size="lg" />
          <p className="text-xs text-nd-text-muted">Loading preview...</p>
        </div>
      )
    }

    // Error
    if (error) {
      return (
        <div className="flex flex-col items-center justify-center gap-3 py-12 text-nd-error">
          <AlertTriangle size={28} />
          <p className="text-sm">Failed to load preview</p>
          <p className="text-xs text-nd-text-muted max-w-xs text-center">{error}</p>
        </div>
      )
    }

    // No content yet
    if (content === null) return null

    // ----- Image -----
    if (category === 'image' && imageDataUrl) {
      return (
        <div className="flex items-center justify-center p-4">
          <img
            src={imageDataUrl}
            alt={name}
            className="max-w-full max-h-[60vh] object-contain rounded"
          />
        </div>
      )
    }

    // ----- JSON -----
    if (category === 'json') {
      return (
        <pre className="p-4 text-xs leading-5 font-mono overflow-x-auto whitespace-pre">
          {highlightJson(content)}
        </pre>
      )
    }

    // ----- Markdown -----
    if (category === 'markdown') {
      return (
        <LineNumberedText content={content} className="p-4 font-mono" />
      )
    }

    // ----- Text / Code -----
    if (category === 'text') {
      return (
        <LineNumberedText content={content} className="p-4" />
      )
    }

    return null
  }, [tooLarge, category, loading, error, content, imageDataUrl, name, ext, fileSize])

  // Category icon for the title area
  const categoryIcon = useMemo(() => {
    switch (category) {
      case 'image':
        return <ImageIcon size={14} className="text-nd-accent shrink-0" />
      case 'json':
      case 'text':
      case 'markdown':
        return <Code size={14} className="text-nd-accent shrink-0" />
      default:
        return <FileText size={14} className="text-nd-text-muted shrink-0" />
    }
  }, [category])

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={name}
      maxWidth="max-w-2xl"
    >
      {/* Category badge */}
      <div className="flex items-center gap-2 mb-3">
        {categoryIcon}
        <span className="text-xs text-nd-text-muted uppercase tracking-wider">
          {category === 'unknown' ? ext || 'unknown' : category} preview
        </span>
        <span className="ml-auto text-xs text-nd-text-muted">
          {fileSize < 1024
            ? `${fileSize} B`
            : fileSize < 1_048_576
              ? `${(fileSize / 1024).toFixed(1)} KB`
              : `${(fileSize / 1_048_576).toFixed(2)} MB`}
        </span>
      </div>

      {/* Preview area */}
      <div
        className={cn(
          'rounded-md border border-nd-border bg-nd-bg-primary overflow-auto',
          'max-h-[70vh]',
        )}
      >
        {renderContent()}
      </div>
    </Modal>
  )
}
