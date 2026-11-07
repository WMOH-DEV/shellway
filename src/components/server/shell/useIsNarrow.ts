import { useEffect, useState, type RefObject } from 'react'

export function useIsNarrow(ref: RefObject<HTMLElement | null>, minWidth: number): boolean {
  const [narrow, setNarrow] = useState(false)

  useEffect(() => {
    const element = ref.current
    if (!element) return
    const observer = new ResizeObserver(([entry]) => {
      const width = entry.contentRect.width
      if (width > 0) setNarrow(width < minWidth)
    })
    observer.observe(element)
    return () => observer.disconnect()
  }, [ref, minWidth])

  return narrow
}
