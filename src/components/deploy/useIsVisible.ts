import { useEffect, useState, type RefObject } from 'react'

export function useIsVisible(ref: RefObject<HTMLElement>): boolean {
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    const element = ref.current
    if (!element) return
    const observer = new IntersectionObserver(([entry]) => setVisible(entry.isIntersecting))
    observer.observe(element)
    return () => observer.disconnect()
  }, [ref])

  return visible
}
