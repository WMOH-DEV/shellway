import { useRef, useCallback, useState } from 'react'
import { cn } from '@/utils/cn'
import { TerminalTabs } from '@/components/terminal/TerminalTabs'
import { SFTPView } from '@/components/sftp/SFTPView'

interface SplitViewProps {
  /** Connection ID for both terminal and SFTP */
  connectionId: string
  /** Session ID for path persistence */
  sessionId: string
  /** Connection status passed to TerminalTabs */
  connectionStatus?: string
  /** Split direction: horizontal = top/bottom, vertical = side-by-side */
  layout: 'horizontal' | 'vertical'
  /** Split ratio (0-1), e.g., 0.5 = equal */
  ratio: number
  /** Callback when the ratio changes (via drag) */
  onRatioChange: (ratio: number) => void
}

/**
 * Combined Terminal + SFTP split view.
 * Renders terminal on top (or left) and SFTP on bottom (or right) with a resizable drag handle.
 * Double-click handle to collapse one pane (50/50 toggle).
 */
export function SplitView({ connectionId, sessionId, connectionStatus, layout, ratio, onRatioChange }: SplitViewProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const isHorizontal = layout === 'horizontal' // top/bottom
  const [collapsed, setCollapsed] = useState<'none' | 'top' | 'bottom'>('none')

  const effectiveRatio = collapsed === 'top' ? 0.05 : collapsed === 'bottom' ? 0.95 : ratio

  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault()
      setCollapsed('none')
      const container = containerRef.current
      if (!container) return

      const rect = container.getBoundingClientRect()

      const onMouseMove = (ev: MouseEvent) => {
        let newRatio: number
        if (isHorizontal) {
          newRatio = (ev.clientY - rect.top) / rect.height
        } else {
          newRatio = (ev.clientX - rect.left) / rect.width
        }
        // Clamp between 15% and 85%
        newRatio = Math.max(0.15, Math.min(0.85, newRatio))
        onRatioChange(newRatio)
      }

      const onMouseUp = () => {
        document.removeEventListener('mousemove', onMouseMove)
        document.removeEventListener('mouseup', onMouseUp)
        document.body.style.cursor = ''
        document.body.style.userSelect = ''
      }

      document.body.style.cursor = isHorizontal ? 'row-resize' : 'col-resize'
      document.body.style.userSelect = 'none'
      document.addEventListener('mousemove', onMouseMove)
      document.addEventListener('mouseup', onMouseUp)
    },
    [isHorizontal, onRatioChange]
  )

  const handleDoubleClick = useCallback(() => {
    if (collapsed === 'none') {
      // Collapse bottom
      setCollapsed('bottom')
    } else if (collapsed === 'bottom') {
      setCollapsed('top')
    } else {
      setCollapsed('none')
      onRatioChange(0.5)
    }
  }, [collapsed, onRatioChange])

  const topSize = `${effectiveRatio * 100}%`

  return (
    <div
      ref={containerRef}
      className={cn(
        'flex overflow-hidden h-full',
        isHorizontal ? 'flex-col' : 'flex-row'
      )}
    >
      {/* Terminal pane (top/left) */}
      <div
        className="overflow-hidden"
        style={{ [isHorizontal ? 'height' : 'width']: topSize }}
      >
        <TerminalTabs connectionId={connectionId} connectionStatus={connectionStatus} />
      </div>

      {/* Drag handle */}
      <div
        onMouseDown={handleMouseDown}
        onDoubleClick={handleDoubleClick}
        className={cn(
          'shrink-0 bg-nd-border hover:bg-nd-accent transition-colors duration-150 z-10 relative group',
          isHorizontal
            ? 'h-1 cursor-row-resize hover:h-1.5'
            : 'w-1 cursor-col-resize hover:w-1.5'
        )}
      >
        {/* Visual grip dots */}
        <div
          className={cn(
            'absolute inset-0 flex items-center justify-center',
            isHorizontal ? 'flex-row gap-1' : 'flex-col gap-1'
          )}
        >
          {[0, 1, 2].map((i) => (
            <div
              key={i}
              className="w-1 h-1 rounded-full bg-nd-text-muted/40 group-hover:bg-white/60 transition-colors"
            />
          ))}
        </div>
      </div>

      {/* SFTP pane (bottom/right) */}
      <div className="flex-1 overflow-hidden">
        <SFTPView connectionId={connectionId} sessionId={sessionId} connectionStatus={connectionStatus} />
      </div>
    </div>
  )
}
