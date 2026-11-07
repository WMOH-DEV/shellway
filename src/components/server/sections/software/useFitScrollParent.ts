import { useEffect, useState, type RefObject } from 'react'

function scrollParent(element: HTMLElement): HTMLElement | null {
  for (let node = element.parentElement; node; node = node.parentElement) {
    if (/auto|scroll/.test(getComputedStyle(node).overflowY)) return node
  }
  return null
}

export function useFitScrollParent(ref: RefObject<HTMLElement | null>, gap: number): number | undefined {
  const [maxHeight, setMaxHeight] = useState<number>()

  useEffect(() => {
    const scroller = ref.current && scrollParent(ref.current)
    if (!scroller) return
    const observer = new ResizeObserver(() => setMaxHeight(Math.max(scroller.clientHeight - gap, 0)))
    observer.observe(scroller)
    return () => observer.disconnect()
  }, [ref, gap])

  return maxHeight
}
