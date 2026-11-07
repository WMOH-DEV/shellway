import type { SystemdTimer, TimersFacts } from './types'

const EMPTY_TIME = /^(n\/a|0)?$/

const readTime = (value: string | undefined): string => (value === undefined || EMPTY_TIME.test(value) ? '' : value)

function timerOf(block: string): SystemdTimer | null {
  const values = Object.fromEntries(
    block.split('\n').flatMap((line) => {
      const at = line.indexOf('=')
      return at > 0 ? [[line.slice(0, at), line.slice(at + 1).trim()]] : []
    })
  )
  if (!values.Id) return null
  return {
    unit: values.Id,
    description: values.Description ?? '',
    activates: values.Unit ?? '',
    next: readTime(values.NextElapseUSecRealtime),
    last: readTime(values.LastTriggerUSec),
    active: values.ActiveState ?? ''
  }
}

export function parseTimers(stdout: string): TimersFacts {
  if (stdout.includes('@@missing')) return { available: false, timers: [] }
  const timers = stdout
    .replace(/\r/g, '')
    .split(/\n\s*\n/)
    .flatMap((block) => timerOf(block) ?? [])
  return { available: true, timers }
}

export const TIMERS_SCRIPT = `if ! command -v systemctl >/dev/null 2>&1; then echo '@@missing'; exit 0; fi
units=$(systemctl list-timers --all --no-pager --no-legend 2>/dev/null | grep -o '[^[:space:]]*\\.timer' | sort -u | head -n 100)
[ -n "$units" ] || exit 0
systemctl show --no-pager -p Id,Description,Unit,NextElapseUSecRealtime,LastTriggerUSec,ActiveState $units
`
