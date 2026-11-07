import { sectionLines, splitSections, type OutputSection } from './sections'
import type { FailedDetails, Listener } from './types'

export const FAILED_SCRIPT = `found=0
if command -v systemctl >/dev/null 2>&1; then
  for unit in $(systemctl list-units --type=service --state=failed --plain --no-legend --no-pager 2>/dev/null | awk '{ print ($1 == "●" ? $2 : $1) }' | head -n 10); do
    found=1
    echo "@@unit $unit"
    journalctl -u "$unit" -n 20 --no-pager -o short 2>&1
  done
  if systemctl is-failed --quiet nginx 2>/dev/null && command -v nginx >/dev/null 2>&1; then echo @@nginx-test; nginx -t 2>&1; fi
  if systemctl is-failed --quiet apache2 2>/dev/null && command -v apache2ctl >/dev/null 2>&1; then echo @@apache-test; apache2ctl configtest 2>&1; fi
fi
if command -v supervisorctl >/dev/null 2>&1; then
  for program in $(supervisorctl status 2>/dev/null | awk '$2 == "FATAL" || $2 == "BACKOFF" { print $1 }' | head -n 10); do
    found=1
    echo "@@program $program"
    supervisorctl tail -2000 "$program" stderr 2>&1 | tail -n 20
  done
fi
[ "$found" = 1 ] || exit 0
echo @@listen
ss -ltnpH 2>/dev/null | head -n 100
`

function groupBy(sections: OutputSection[], marker: string): Record<string, string[]> {
  const groups: Record<string, string[]> = {}
  for (const section of sections.filter((candidate) => candidate.marker === marker && candidate.arg)) {
    groups[section.arg.replace(/\.service$/, '')] = section.lines.filter((line) => line.trim() !== '')
  }
  return groups
}

function parseListener(line: string): Listener | null {
  const columns = line.trim().split(/\s+/)
  const local = columns[3] ?? ''
  const port = Number(/:(\d+)$/.exec(local)?.[1])
  if (!Number.isInteger(port)) return null
  return { address: local, port, process: /users:\(\("([^"]+)"/.exec(line)?.[1] ?? '' }
}

function joinedOrNull(sections: OutputSection[], marker: string): string | null {
  return sections.some((section) => section.marker === marker) ? sectionLines(sections, marker).join('\n') : null
}

export function parseFailed(stdout: string): FailedDetails {
  const sections = splitSections(stdout)
  return {
    units: groupBy(sections, 'unit'),
    programs: groupBy(sections, 'program'),
    nginxTest: joinedOrNull(sections, 'nginx-test'),
    apacheTest: joinedOrNull(sections, 'apache-test'),
    listeners: sectionLines(sections, 'listen').map(parseListener).filter((listener): listener is Listener => listener !== null)
  }
}
