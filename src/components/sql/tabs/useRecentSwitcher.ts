import { useCallback, useEffect, useRef, useState } from 'react'
import type { SQLTab } from '@/types/sql'
import { getBinding } from '@/stores/keybindingStore'
import { matchesKeyCombo } from '@/utils/keybindings'

export const SWITCHER_ROWS = 7
const MAX_DIGIT_JUMP = 6
const RECENT_TABS_ACTION = 'sql:recentTabs'

type HoldModifier = 'Control' | 'Meta' | 'Alt' | 'Shift'

interface Session {
  rows: SQLTab[]
  highlight: number
}

interface Options {
  enabled: boolean
  getRows: () => SQLTab[]
  onCommit: (tabId: string) => void
}

export interface RecentSwitcher {
  open: boolean
  rows: SQLTab[]
  highlight: number
  setHighlight: (index: number) => void
  commit: (index: number) => void
  cancel: () => void
}

function isMac(): boolean {
  return navigator.platform?.includes('Mac') ?? false
}

function toHoldModifier(modifier: string): HoldModifier | null {
  switch (modifier.toLowerCase()) {
    case 'ctrl':
      return 'Control'
    case 'cmdorctrl':
      return isMac() ? 'Meta' : 'Control'
    case 'alt':
      return 'Alt'
    case 'shift':
      return 'Shift'
    default:
      return null
  }
}

export function holdModifiers(combo: string): HoldModifier[] {
  const found = combo
    .split('+')
    .slice(0, -1)
    .map(toHoldModifier)
    .filter((m): m is HoldModifier => m !== null)
  return [...new Set(found)]
}

function isHeld(e: KeyboardEvent, modifier: HoldModifier): boolean {
  switch (modifier) {
    case 'Control':
      return e.ctrlKey
    case 'Meta':
      return e.metaKey
    case 'Alt':
      return e.altKey
    case 'Shift':
      return e.shiftKey
  }
}

function isTrigger(e: KeyboardEvent, combo: string): boolean {
  if (!combo) return false
  if (matchesKeyCombo(e, combo)) return true
  return !holdModifiers(combo).includes('Shift') && matchesKeyCombo(e, `Shift+${combo}`)
}

function isBackwards(e: KeyboardEvent, combo: string): boolean {
  return e.shiftKey && !holdModifiers(combo).includes('Shift')
}

function wrap(index: number, delta: number, length: number): number {
  return (index + delta + length) % length
}

function consume(e: KeyboardEvent): void {
  e.preventDefault()
  e.stopPropagation()
}

export function useRecentSwitcher(options: Options): RecentSwitcher {
  const [session, setSession] = useState<Session | null>(null)
  const sessionRef = useRef<Session | null>(null)
  const optionsRef = useRef(options)
  optionsRef.current = options

  const update = useCallback((next: Session | null) => {
    sessionRef.current = next
    setSession(next)
  }, [])

  const setHighlight = useCallback(
    (index: number) => {
      const current = sessionRef.current
      if (current && current.highlight !== index) update({ ...current, highlight: index })
    },
    [update]
  )

  const cancel = useCallback(() => update(null), [update])

  const commit = useCallback(
    (index: number) => {
      const target = sessionRef.current?.rows[index]
      update(null)
      if (target) optionsRef.current.onCommit(target.id)
    },
    [update]
  )

  const handleClosedKeyDown = useCallback(
    (e: KeyboardEvent, combo: string) => {
      if (!isTrigger(e, combo)) return
      consume(e)
      const rows = optionsRef.current.getRows().slice(0, SWITCHER_ROWS)
      if (rows.length < 2) return
      update({ rows, highlight: isBackwards(e, combo) ? rows.length - 1 : 1 })
    },
    [update]
  )

  const handleOpenKeyDown = useCallback(
    (e: KeyboardEvent, current: Session, combo: string) => {
      const step = (delta: number): void => {
        consume(e)
        update({ ...current, highlight: wrap(current.highlight, delta, current.rows.length) })
      }
      if (isTrigger(e, combo)) return step(isBackwards(e, combo) ? -1 : 1)
      if (e.key === 'ArrowDown') return step(1)
      if (e.key === 'ArrowUp') return step(-1)
      if (e.key === 'Escape') {
        consume(e)
        return cancel()
      }
      if (e.key === 'Enter') {
        consume(e)
        return commit(current.highlight)
      }
      const digit = /^[1-6]$/.test(e.key) ? Number(e.key) : 0
      if (digit >= 1 && digit <= MAX_DIGIT_JUMP && digit < current.rows.length) {
        consume(e)
        commit(digit)
      }
    },
    [update, cancel, commit]
  )

  const handleKeyUp = useCallback(
    (e: KeyboardEvent, current: Session, combo: string) => {
      const held = holdModifiers(combo).filter((m) => m !== 'Shift')
      if (held.length === 0 || held.some((m) => isHeld(e, m))) return
      commit(current.highlight)
    },
    [commit]
  )

  useEffect(() => {
    if (!options.enabled) {
      update(null)
      return
    }
    const onKeyDown = (e: KeyboardEvent): void => {
      const combo = getBinding(RECENT_TABS_ACTION)
      const current = sessionRef.current
      if (current) handleOpenKeyDown(e, current, combo)
      else handleClosedKeyDown(e, combo)
    }
    const onKeyUp = (e: KeyboardEvent): void => {
      const current = sessionRef.current
      if (current) handleKeyUp(e, current, getBinding(RECENT_TABS_ACTION))
    }
    window.addEventListener('keydown', onKeyDown, true)
    window.addEventListener('keyup', onKeyUp, true)
    return () => {
      window.removeEventListener('keydown', onKeyDown, true)
      window.removeEventListener('keyup', onKeyUp, true)
    }
  }, [options.enabled, update, handleClosedKeyDown, handleOpenKeyDown, handleKeyUp])

  return {
    open: session !== null,
    rows: session?.rows ?? [],
    highlight: session?.highlight ?? 0,
    setHighlight,
    commit,
    cancel
  }
}
