import { useEffect, type RefObject } from 'react'

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'

function wrapTarget(panel: HTMLElement, backwards: boolean): HTMLElement | null {
  const items = [...panel.querySelectorAll<HTMLElement>(FOCUSABLE)]
  if (items.length === 0) return panel
  const first = items[0]
  const last = items[items.length - 1]
  const active = document.activeElement
  if (!panel.contains(active) || active === panel) return backwards ? last : first
  if (backwards && active === first) return last
  if (!backwards && active === last) return first
  return null
}

export function useDialogFocus(ref: RefObject<HTMLElement>, onEscape: () => void): void {
  useEffect(() => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null
    ref.current?.focus()
    return () => previous?.focus()
  }, [ref])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const panel = ref.current
      if (!panel) return
      if (event.key === 'Escape') {
        event.preventDefault()
        onEscape()
        return
      }
      if (event.key !== 'Tab') return
      const target = wrapTarget(panel, event.shiftKey)
      if (!target) return
      event.preventDefault()
      target.focus()
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [ref, onEscape])
}
