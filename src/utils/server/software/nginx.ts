import { fileDump, parseFile } from './php'
import { sectionLines, splitSections } from './sections'
import type { NginxFacts } from './types'

export const NGINX_KEYS = ['client_max_body_size', 'keepalive_timeout', 'gzip', 'server_tokens'] as const

export type NginxKey = (typeof NGINX_KEYS)[number]

export const NGINX_DEFAULTS: Record<NginxKey, string> = { client_max_body_size: '1m', keepalive_timeout: '75s', gzip: 'off', server_tokens: 'on' }

export const NGINX_CONF_PATH = '/etc/nginx/nginx.conf'

export const NGINX_SCRIPT = `if [ ! -x /usr/sbin/nginx ] || [ ! -f ${NGINX_CONF_PATH} ]; then echo '@@none'; exit 0; fi
echo '@@conf'
${fileDump(NGINX_CONF_PATH)}
exit 0
`

const HTTP_OPEN = /^\s*http\s*\{\s*$/

const codeOf = (line: string): string => line.replace(/"[^"]*"|'[^']*'/g, '""').replace(/\$\{[^}]*\}/g, '').replace(/#.*$/, '')

const count = (text: string, char: string): number => text.split(char).length - 1

interface HttpScan {
  openLine: number
  direct: boolean[]
}

function scanHttp(lines: string[]): HttpScan | null {
  let depth = 0
  let openLine = -1
  const direct: boolean[] = []
  lines.forEach((line, index) => {
    const code = codeOf(line)
    direct.push(openLine >= 0 && depth === 1)
    if (openLine < 0 && depth === 0 && HTTP_OPEN.test(code)) openLine = index
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

const NOT_INSTALLED: NginxFacts = { installed: false, conf: { sha256: null, content: '' }, values: {} }

export function parseNginx(stdout: string): NginxFacts {
  const conf = parseFile(sectionLines(splitSections(stdout), 'conf'))
  if (!conf.sha256) return NOT_INSTALLED
  return { installed: true, conf, values: parseNginxValues(conf.content) as Record<string, string> }
}
