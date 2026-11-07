import { sectionLines, shellQuote, splitSections } from './sections'
import type { PackageHit } from './types'

export const SEARCH_LIMIT = 50

const QUERY = /^[a-z0-9][a-z0-9+.-]{2,63}$/

export function assertSearchQuery(raw: unknown): string {
  const query = typeof raw === 'string' ? raw.trim().toLowerCase() : ''
  if (!QUERY.test(query)) throw new Error('Search with at least 3 letters, digits, dots, dashes or plus signs')
  return query
}

export function searchScript(query: string): string {
  return `if ! command -v apt-cache >/dev/null 2>&1; then echo '@@unsupported'; exit 0; fi
results=$(apt-cache search --names-only -- ${shellQuote(assertSearchQuery(query))} 2>/dev/null | head -n ${SEARCH_LIMIT})
echo '@@results'
printf '%s\\n' "$results"
echo '@@installed'
names=$(printf '%s\\n' "$results" | cut -d' ' -f1)
[ -n "$names" ] && dpkg-query -W -f='\${Package}\\t\${Status}\\n' $names 2>/dev/null | awk -F'\\t' '$2=="install ok installed"{print $1}'
exit 0
`
}

const RESULT = /^(\S+) - (.*)$/

export function parseSearch(stdout: string): PackageHit[] | null {
  const sections = splitSections(stdout)
  if (sections.some((section) => section.name === 'unsupported')) return null
  const installed = new Set(sectionLines(sections, 'installed').map((line) => line.trim()))
  return sectionLines(sections, 'results')
    .map((line) => RESULT.exec(line.trim()))
    .filter((match): match is RegExpExecArray => match !== null)
    .slice(0, SEARCH_LIMIT)
    .map(([, name, description]) => ({ name, description, installed: installed.has(name) }))
}
