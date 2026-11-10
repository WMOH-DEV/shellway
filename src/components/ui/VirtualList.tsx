import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { cn } from '@/utils/cn'

interface VirtualListProps<T> {
  items: T[]
  rowHeight: number
  renderRow: (item: T, index: number) => ReactNode
  getKey: (item: T) => string
  overscan?: number
  scrollToIndex?: number
  className?: string
  id?: string
  role?: string
  ariaLabel?: string
  ariaActiveDescendant?: string
}

function visibleRange(scrollTop: number, viewport: number, rowHeight: number, count: number, overscan: number) {
  const first = Math.max(0, Math.floor(scrollTop / rowHeight) - overscan)
  const last = Math.min(count, Math.ceil((scrollTop + viewport) / rowHeight) + overscan)
  return { first, last }
}

export function VirtualList<T>({
  items,
  rowHeight,
  renderRow,
  getKey,
  overscan = 6,
  scrollToIndex,
  className,
  id,
  role,
  ariaLabel,
  ariaActiveDescendant
}: VirtualListProps<T>) {
  const viewportRef = useRef<HTMLDivElement>(null)
  const [scrollTop, setScrollTop] = useState(0)
  const [viewport, setViewport] = useState(0)

  useLayoutEffect(() => {
    const element = viewportRef.current
    if (!element) return
    setViewport(element.clientHeight)
    const observer = new ResizeObserver(() => setViewport(element.clientHeight))
    observer.observe(element)
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    const element = viewportRef.current
    if (!element || scrollToIndex === undefined || scrollToIndex < 0) return
    const top = scrollToIndex * rowHeight
    const bottom = top + rowHeight
    if (top < element.scrollTop) element.scrollTop = top
    else if (bottom > element.scrollTop + element.clientHeight) element.scrollTop = bottom - element.clientHeight
    setScrollTop(element.scrollTop)
  }, [scrollToIndex, rowHeight])

  const { first, last } = visibleRange(scrollTop, viewport, rowHeight, items.length, overscan)

  return (
    <div
      ref={viewportRef}
      id={id}
      role={role}
      aria-label={ariaLabel}
      aria-activedescendant={ariaActiveDescendant}
      onScroll={(e) => setScrollTop(e.currentTarget.scrollTop)}
      className={cn('relative overflow-y-auto', className)}
    >
      <div style={{ height: items.length * rowHeight, position: 'relative' }}>
        {items.slice(first, last).map((item, offset) => {
          const index = first + offset
          return (
            <div
              key={getKey(item)}
              style={{ position: 'absolute', top: index * rowHeight, left: 0, right: 0, height: rowHeight }}
            >
              {renderRow(item, index)}
            </div>
          )
        })}
      </div>
    </div>
  )
}
