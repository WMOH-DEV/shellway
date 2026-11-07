import { splitSections, type OutputSection } from './sections'
import type { SiteUsage } from './types'

export const USAGE_SCRIPT = `for f in /etc/nginx/sites-enabled/* /etc/nginx/conf.d/*.conf; do
  [ -f "$f" ] || continue
  echo "@@nginx $f"
  grep -hE '^[[:space:]]*(server_name|fastcgi_pass)[[:space:]]' "$f" 2>/dev/null
done
for f in /etc/apache2/sites-enabled/* /etc/httpd/conf.d/*.conf; do
  [ -f "$f" ] || continue
  echo "@@apache $f"
  grep -hiE '^[[:space:]]*ServerName[[:space:]]|php[0-9.]+-fpm' "$f" 2>/dev/null
done
`

const IGNORED_NAMES = new Set(['_', 'localhost', 'default', 'default_server'])
const PHP_SOCKET = /php(\d+\.\d+)-fpm/i

interface FileUsage {
  server: 'nginx' | 'apache'
  name: string | null
  phpVersion: string | null
}

function firstName(lines: string[]): string | null {
  for (const line of lines) {
    const match = /^\s*(?:server_name|ServerName)\s+([^;]+)/i.exec(line)
    const name = match?.[1].trim().split(/\s+/).find((candidate) => !IGNORED_NAMES.has(candidate) && !/^\d+\.\d+\.\d+\.\d+$/.test(candidate))
    if (name) return name.replace(/:\d+$/, '')
  }
  return null
}

function fileUsage(section: OutputSection): FileUsage {
  return {
    server: section.marker === 'nginx' ? 'nginx' : 'apache',
    name: firstName(section.lines),
    phpVersion: section.lines.map((line) => PHP_SOCKET.exec(line)?.[1]).find(Boolean) ?? null
  }
}

const addUnique = (list: string[], value: string) => {
  if (!list.includes(value)) list.push(value)
}

export function parseUsage(stdout: string): SiteUsage {
  const usage: SiteUsage = { nginx: [], apache: [], php: {} }
  const files = splitSections(stdout).filter((section) => section.marker === 'nginx' || section.marker === 'apache').map(fileUsage)
  for (const file of files) {
    if (!file.name) continue
    addUnique(usage[file.server], file.name)
    if (file.phpVersion) addUnique((usage.php[file.phpVersion] ??= []), file.name)
  }
  return usage
}

export function sitesUsing(usage: SiteUsage | null, unitName: string): string[] {
  if (!usage) return []
  if (unitName === 'nginx') return usage.nginx
  if (unitName === 'apache2' || unitName === 'httpd') return usage.apache
  const php = /^php(\d+\.\d+)-fpm$/.exec(unitName)
  return php ? (usage.php[php[1]] ?? []) : []
}
