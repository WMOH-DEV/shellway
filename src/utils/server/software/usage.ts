import { hasSection, keyValues, sectionLines, splitSections } from './sections'
import type { FpmPressure, UsageFacts } from './types'

export const USAGE_SCRIPT = `if [ -d /var/lib/mysql ]; then
  echo '@@mysql'
  for d in /var/lib/mysql/*/; do [ -d "$d" ] && basename "$d"; done
fi
if command -v psql >/dev/null 2>&1 && id postgres >/dev/null 2>&1; then
  names=$(cd / && runuser -u postgres -- psql -XAtc 'select datname from pg_database where not datistemplate' 2>/dev/null)
  if [ $? -eq 0 ]; then echo '@@postgres'; printf '%s\\n' "$names"; fi
fi
for f in /var/log/php*-fpm.log; do
  [ -f "$f" ] || continue
  v=$(basename "$f" | sed -E 's/^php([0-9.]+)-fpm\\.log$/\\1/')
  lines=$(tail -n 2000 "$f" | grep 'reached pm.max_children')
  echo "@@fpm $v"
  echo "hits=$(printf '%s' "$lines" | grep -c .)"
  echo "last=$(printf '%s\\n' "$lines" | tail -n 1 | sed -nE 's/^\\[([^]]+)\\].*/\\1/p')"
done
exit 0
`

const MYSQL_SYSTEM = new Set(['mysql', 'performance_schema', 'sys', 'information_schema'])

const POSTGRES_SYSTEM = new Set(['postgres'])

const userDatabases = (lines: string[], system: Set<string>): string[] =>
  lines.map((line) => line.trim()).filter((name) => name && !name.startsWith('#') && !system.has(name))

function parsePressure(lines: string[], version: string): FpmPressure {
  const values = keyValues(lines)
  const hits = Number.parseInt(values.hits ?? '0', 10)
  return { version, hits: Number.isFinite(hits) ? hits : 0, last: values.last || null }
}

export function parseUsage(stdout: string): UsageFacts {
  const sections = splitSections(stdout)
  return {
    mysqlDatabases: hasSection(sections, 'mysql') ? userDatabases(sectionLines(sections, 'mysql'), MYSQL_SYSTEM) : null,
    postgresDatabases: hasSection(sections, 'postgres') ? userDatabases(sectionLines(sections, 'postgres'), POSTGRES_SYSTEM) : null,
    fpmPressure: sections.filter((section) => section.name === 'fpm' && /^\d+\.\d+$/.test(section.arg)).map((section) => parsePressure(section.lines, section.arg))
  }
}
