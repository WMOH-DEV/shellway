import { fileDump, parseFile } from './php'
import { sectionLines, splitSections } from './sections'
import type { NginxFacts, NginxIncludedSetting } from './types'

export const NGINX_KEYS = ['client_max_body_size', 'keepalive_timeout', 'gzip', 'server_tokens'] as const

export type NginxKey = (typeof NGINX_KEYS)[number]

export const NGINX_DEFAULTS: Record<NginxKey, string> = { client_max_body_size: '1m', keepalive_timeout: '75s', gzip: 'off', server_tokens: 'on' }

export const NGINX_CONF_PATH = '/etc/nginx/nginx.conf'

const SCAN_FUNCTION = `scan() { awk -v f="$1" -v root="$2" -v want="$3" '{ bare = $0; gsub(/"[^"]*"|\\047[^\\047]*\\047/, "Q", bare); sub(/#.*/, "", bare)
  if (root && depth == 0 && bare ~ /^[ \t]*http[ \t]*([{]|$)/) http = 1
  if (root ? http && depth == 1 : depth == 0) {
    if (want == "inc" && bare ~ /^[ \t]*include[ \t]/) { s = $0; sub(/^[ \t]*include[ \t]+/, "", s); sub(/;.*$/, "", s); gsub(/["\\047 \t]/, "", s); print s }
    if (want == "set" && bare ~ /^[ \t]*(${NGINX_KEYS.join('|')})[ \t]+[^;]*;/) { s = bare; sub(/^[ \t]+/, "", s); key = s; sub(/[ \t].*$/, "", key); val = s; sub(/^[^ \t]+[ \t]+/, "", val); sub(/[ \t]*;.*$/, "", val); print f "|" key "|" val }
  }
  depth += gsub(/[{]/, "{", bare) - gsub(/[}]/, "}", bare)
  if (root && depth == 0 && bare ~ /[}]/) http = 0 }' "$1"; }`

export const includedSettingsScript = (confDir: string): string => `${SCAN_FUNCTION}
todo=$(scan '${confDir}/nginx.conf' 1 inc)
seen=' '
for round in 1 2 3 4; do
  next=''
  for pattern in $todo; do
    case "$pattern" in /*) ;; *) pattern="${confDir}/$pattern" ;; esac
    for f in $pattern; do
      [ -f "$f" ] && [ -r "$f" ] || continue
      case "$seen" in *" $f "*) continue ;; esac
      seen="$seen$f "
      scan "$f" 0 set
      next="$next $(scan "$f" 0 inc)"
    done
  done
  todo=$next
done`

export const NGINX_SCRIPT = `if [ ! -x /usr/sbin/nginx ] || [ ! -f ${NGINX_CONF_PATH} ]; then echo '@@none'; exit 0; fi
echo '@@conf'
${fileDump(NGINX_CONF_PATH)}
echo '@@included'
${includedSettingsScript('/etc/nginx')}
exit 0
`

const HTTP_OPEN = /^\s*http\s*\{\s*$/

const HTTP_KEYWORD = /^\s*http\s*$/

const BRACE_ONLY = /^\s*\{\s*$/

const codeOf = (line: string): string => line.replace(/"[^"]*"|'[^']*'/g, '""').replace(/\$\{[^}]*\}/g, '').replace(/#.*$/, '')

const count = (text: string, char: string): number => text.split(char).length - 1

interface HttpScan {
  openLine: number
  direct: boolean[]
}

function scanHttp(lines: string[]): HttpScan | null {
  let depth = 0
  let openLine = -1
  let afterKeyword = false
  const direct: boolean[] = []
  lines.forEach((line, index) => {
    const code = codeOf(line)
    direct.push(openLine >= 0 && depth === 1)
    if (openLine < 0 && depth === 0) {
      if (HTTP_OPEN.test(code) || (afterKeyword && BRACE_ONLY.test(code))) openLine = index
      else if (code.trim()) afterKeyword = HTTP_KEYWORD.test(code)
    }
    depth += count(code, '{') - count(code, '}')
  })
  return openLine < 0 ? null : { openLine, direct }
}

const splitLines = (content: string): string[] => content.replace(/\n$/, '').split('\n')

const activePattern = (key: string): RegExp => new RegExp(`^(\\s*${key}\\s+)[^;]*;`)

const commentedPattern = (key: string): RegExp => new RegExp(`^(\\s*)#\\s*${key}\\s+[^;]*;`)

const valuePattern = (key: string): RegExp => new RegExp(`^\\s*${key}\\s+([^;]+?)\\s*;`)

export function parseNginxValues(content: string): Partial<Record<NginxKey, string>> {
  const lines = splitLines(content)
  const scan = scanHttp(lines)
  const values: Partial<Record<NginxKey, string>> = {}
  if (!scan) return values
  lines.forEach((line, index) => {
    if (!scan.direct[index]) return
    const code = codeOf(line)
    for (const key of NGINX_KEYS) {
      const match = valuePattern(key).exec(code)
      if (match && values[key] === undefined) values[key] = match[1]
    }
  })
  return values
}

function replaceActive(lines: string[], scan: HttpScan, pending: Map<string, string>): void {
  lines.forEach((line, index) => {
    if (!scan.direct[index]) return
    const code = codeOf(line)
    for (const [key, value] of pending) {
      if (!valuePattern(key).test(code)) continue
      lines[index] = line.replace(activePattern(key), (_, head: string) => `${head}${value};`)
      pending.delete(key)
    }
  })
}

function commentedInsertions(lines: string[], scan: HttpScan, pending: Map<string, string>): Map<number, string[]> {
  const inserts = new Map<number, string[]>()
  lines.forEach((line, index) => {
    if (!scan.direct[index]) return
    for (const [key, value] of pending) {
      const match = commentedPattern(key).exec(line)
      if (!match) continue
      inserts.set(index, [...(inserts.get(index) ?? []), `${match[1]}${key} ${value};`])
      pending.delete(key)
    }
  })
  return inserts
}

function openIndent(lines: string[], openLine: number): string {
  const next = lines.slice(openLine + 1).find((line) => line.trim() !== '')
  if (next === undefined || next.trim().startsWith('}')) return `${/^\s*/.exec(lines[openLine])?.[0] ?? ''}    `
  return /^\s*/.exec(next)?.[0] ?? ''
}

export function setNginxDirectives(conf: string, values: Partial<Record<NginxKey, string>>): string | null {
  const lines = splitLines(conf)
  const scan = scanHttp(lines)
  if (!scan) return null
  const pending = new Map(Object.entries(values) as [string, string][])
  replaceActive(lines, scan, pending)
  const inserts = commentedInsertions(lines, scan, pending)
  const indent = openIndent(lines, scan.openLine)
  const atOpen = [...pending].map(([key, value]) => `${indent}${key} ${value};`)
  const output = lines.flatMap((line, index) => [line, ...(inserts.get(index) ?? []), ...(index === scan.openLine ? atOpen : [])])
  return `${output.join('\n')}\n`
}

const NOT_INSTALLED: NginxFacts = { installed: false, conf: { sha256: null, content: '' }, values: {}, elsewhere: {} }

const isNginxKey = (key: string): key is NginxKey => (NGINX_KEYS as readonly string[]).includes(key)

export function parseIncludedSettings(lines: string[]): Record<string, NginxIncludedSetting> {
  const found: Record<string, NginxIncludedSetting> = {}
  for (const line of lines) {
    const [path, key, ...rest] = line.split('|')
    const value = rest.join('|').trim()
    if (path && key && value && isNginxKey(key) && !found[key]) found[key] = { value, path }
  }
  return found
}

export function parseNginx(stdout: string): NginxFacts {
  const sections = splitSections(stdout)
  const conf = parseFile(sectionLines(sections, 'conf'))
  if (!conf.sha256) return NOT_INSTALLED
  return { installed: true, conf, values: parseNginxValues(conf.content) as Record<string, string>, elsewhere: parseIncludedSettings(sectionLines(sections, 'included')) }
}
