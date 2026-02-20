import { useState, useRef, useEffect } from 'react'
import { ChevronRight, Home } from 'lucide-react'
import { cn } from '@/utils/cn'

interface PathBreadcrumbProps {
  path: string
  separator?: string
  onNavigate: (path: string) => void
  className?: string
}

/**
 * Clickable breadcrumb path bar with editable mode.
 * Click on segments to navigate, click on the bar to edit manually.
 */
export function PathBreadcrumb({ path, separator = '/', onNavigate, className }: PathBreadcrumbProps) {
  const [isEditing, setIsEditing] = useState(false)
  const [editValue, setEditValue] = useState(path)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    setEditValue(path)
  }, [path])

  useEffect(() => {
    if (isEditing && inputRef.current) {
      inputRef.current.focus()
      inputRef.current.select()
    }
  }, [isEditing])

  const segments = path.split(separator).filter(Boolean)
  const isWindows = path.includes('\\') || (segments[0] && /^[A-Z]:$/i.test(segments[0]))

  const handleSegmentClick = (index: number) => {
    if (isWindows) {
      const navPath = segments.slice(0, index + 1).join('\\')
      onNavigate(navPath.includes(':') ? navPath + '\\' : navPath)
    } else {
      onNavigate('/' + segments.slice(0, index + 1).join('/'))
    }
  }

  const handleSubmit = () => {
    setIsEditing(false)
    if (editValue.trim() && editValue.trim() !== path) {
      onNavigate(editValue.trim())
    }
  }

  if (isEditing) {
    return (
      <input
        ref={inputRef}
        type="text"
        value={editValue}
        onChange={(e) => setEditValue(e.target.value)}
        onBlur={handleSubmit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') handleSubmit()
          if (e.key === 'Escape') setIsEditing(false)
        }}
        className={cn(
          'w-full h-7 px-2 rounded bg-nd-surface border border-nd-accent text-xs text-nd-text-primary font-mono',
          'focus:outline-none',
          className
        )}
      />
    )
  }

  return (
    <div
      onClick={() => setIsEditing(true)}
      className={cn(
        'flex items-center gap-0.5 h-7 px-2 rounded bg-nd-surface border border-nd-border cursor-text overflow-hidden',
        'hover:border-nd-border-hover transition-colors',
        className
      )}
    >
      {/* Home button */}
      <button
        onClick={(e) => {
          e.stopPropagation()
          onNavigate(isWindows ? 'C:\\' : '/')
        }}
        className="shrink-0 p-0.5 rounded text-nd-text-muted hover:text-nd-accent transition-colors"
      >
        <Home size={12} />
      </button>

      <ChevronRight size={10} className="text-nd-text-muted shrink-0" />

      {/* Path segments */}
      <div className="flex items-center gap-0.5 overflow-hidden">
        {segments.map((segment, i) => (
          <div key={i} className="flex items-center gap-0.5 shrink-0">
            <button
              onClick={(e) => {
                e.stopPropagation()
                handleSegmentClick(i)
              }}
              className="text-xs text-nd-text-secondary hover:text-nd-accent transition-colors truncate max-w-[120px]"
            >
              {segment}
            </button>
            {i < segments.length - 1 && (
              <ChevronRight size={10} className="text-nd-text-muted shrink-0" />
            )}
          </div>
        ))}
      </div>
    </div>
  )
}
