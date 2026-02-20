import { useRef, useCallback, type ReactNode } from 'react'
import { cn } from '@/utils/cn'

interface SplitterProps {
  /** Left (or top) panel content */
  left: ReactNode
  /** Right (or bottom) panel content */
  right: ReactNode
  /** Split direction */
  direction?: 'horizontal' | 'vertical'
  /** Initial left/top panel size in percentage (0-100) */
  defaultSplit?: number
  /** Minimum panel size in pixels */
  minSize?: number
  className?: string
}

export function Splitter({
  left,
  right,
  direction = 'horizontal',
  defaultSplit = 50,
  minSize = 150,
  className
}: SplitterProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const leftRef = useRef<HTMLDivElement>(null)
  const isHorizontal = direction === 'horizontal'

  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault()
      const container = containerRef.current
      const leftPanel = leftRef.current
      if (!container || !leftPanel) return

      const containerRect = container.getBoundingClientRect()

      const onMouseMove = (ev: MouseEvent) => {
        let ratio: number
        if (isHorizontal) {
          const x = ev.clientX - containerRect.left
          ratio = (x / containerRect.width) * 100
        } else {
          const y = ev.clientY - containerRect.top
          ratio = (y / containerRect.height) * 100
        }

        // Enforce min sizes
        const containerSize = isHorizontal ? containerRect.width : containerRect.height
        const minPercent = (minSize / containerSize) * 100
        ratio = Math.max(minPercent, Math.min(100 - minPercent, ratio))

        leftPanel.style[isHorizontal ? 'width' : 'height'] = `${ratio}%`
      }

      const onMouseUp = () => {
        document.removeEventListener('mousemove', onMouseMove)
        document.removeEventListener('mouseup', onMouseUp)
        document.body.style.cursor = ''
        document.body.style.userSelect = ''
      }

      document.body.style.cursor = isHorizontal ? 'col-resize' : 'row-resize'
      document.body.style.userSelect = 'none'
      document.addEventListener('mousemove', onMouseMove)
      document.addEventListener('mouseup', onMouseUp)
    },
    [isHorizontal, minSize]
  )

  return (
    <div
      ref={containerRef}
      className={cn(
        'flex overflow-hidden',
        isHorizontal ? 'flex-row' : 'flex-col',
        className
      )}
    >
      {/* Left/Top panel */}
      <div
        ref={leftRef}
        className="overflow-hidden"
        style={{ [isHorizontal ? 'width' : 'height']: `${defaultSplit}%` }}
      >
        {left}
      </div>

      {/* Drag handle */}
      <div
        onMouseDown={handleMouseDown}
        className={cn(
          'shrink-0 bg-nd-border hover:bg-nd-accent transition-colors duration-150 z-10',
          isHorizontal
            ? 'w-px cursor-col-resize hover:w-0.5'
            : 'h-px cursor-row-resize hover:h-0.5'
        )}
      />

      {/* Right/Bottom panel */}
      <div className="flex-1 overflow-hidden">{right}</div>
    </div>
  )
}
