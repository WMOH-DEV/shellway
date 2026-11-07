import { useLayoutEffect, useState, type CSSProperties, type RefObject } from 'react'

const POPOVER_HEIGHT = 330
const GAP = 4
const VIEWPORT_MARGIN = 8

function computePosition(trigger: HTMLElement): CSSProperties {
  const rect = trigger.getBoundingClientRect()
  const spaceBelow = window.innerHeight - rect.bottom
  const opensAbove = spaceBelow < POPOVER_HEIGHT && rect.top > spaceBelow
  const base: CSSProperties = {
    left: Math.max(VIEWPORT_MARGIN, rect.left),
    minWidth: rect.width,
    maxWidth: window.innerWidth - VIEWPORT_MARGIN * 2
  }
  return opensAbove ? { ...base, bottom: window.innerHeight - rect.top + GAP } : { ...base, top: rect.bottom + GAP }
}

function isSamePosition(a: CSSProperties | null, b: CSSProperties): boolean {
  return a !== null && JSON.stringify(a) === JSON.stringify(b)
}

export function usePopoverPosition(triggerRef: RefObject<HTMLElement>, open: boolean): CSSProperties | null {
  const [position, setPosition] = useState<CSSProperties | null>(null)

  useLayoutEffect(() => {
    const trigger = triggerRef.current
    if (!open || !trigger) return
    const update = () => {
      const next = computePosition(trigger)
      setPosition((previous) => (isSamePosition(previous, next) ? previous : next))
    }
    update()
    window.addEventListener('scroll', update, true)
    window.addEventListener('resize', update)
    return () => {
      window.removeEventListener('scroll', update, true)
      window.removeEventListener('resize', update)
    }
  }, [open, triggerRef])

  return open ? position : null
}
