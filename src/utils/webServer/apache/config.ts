import { splitLines } from '../../ssl/originCa/diff'

export interface ApacheDirective {
  name: string
  args: string[]
  line: number
  lastLine: number
  body: ApacheDirective[] | null
}

interface LogicalLine {
  text: string
  line: number
  lastLine: number
}

const isSpace = (ch: string) => ch === ' ' || ch === '\t'

const CONTINUED = /(?:^|[^\\])\\\r?$/

export const UNBALANCED_SECTIONS = "This file's sections (such as <VirtualHost> or <IfModule>) do not open and close in order, so Shellway will not edit it."

function logicalLines(text: string): LogicalLine[] {
  const found: LogicalLine[] = []
  let open = false
  splitLines(text).forEach((raw, index) => {
    const continues = CONTINUED.test(raw)
    const part = continues ? raw.replace(/\\\r?$/, '') : raw
    const last = found[found.length - 1]
    if (open) found[found.length - 1] = { text: last.text + part, line: last.line, lastLine: index + 1 }
    else found.push({ text: part, line: index + 1, lastLine: index + 1 })
    open = continues
  })
  return found
}

function quotedEnd(text: string, start: number): { value: string; end: number } {
  const quote = text[start]
  let value = ''
  let i = start + 1
  for (; i < text.length && text[i] !== quote; i++) {
    if (text[i] === '\\' && text[i + 1] === quote) i++
    value += text[i]
  }
  return { value, end: i + 1 }
}

function wordEnd(text: string, start: number): number {
  let i = start
  while (i < text.length && !isSpace(text[i])) i++
  return i
}

function words(text: string): string[] {
  const found: string[] = []
  let i = 0
  while (i < text.length) {
    if (isSpace(text[i])) i++
    else if (text[i] === '"' || text[i] === "'") {
      const quoted = quotedEnd(text, i)
      found.push(quoted.value)
      i = quoted.end
    } else {
      const end = wordEnd(text, i)
      found.push(text.slice(i, end))
      i = end
    }
  }
  return found
}

function directive(text: string, at: LogicalLine, body: ApacheDirective[] | null): ApacheDirective {
  const [name = '', ...args] = words(text)
  return { name: name.toLowerCase(), args, line: at.line, lastLine: at.lastLine, body }
}

function sectionHeader(text: string): string {
  const close = text.lastIndexOf('>')
  return text.slice(1, close > 0 ? close : text.length)
}

const closerName = (text: string): string => sectionHeader(text).slice(1).trim().toLowerCase()

interface ParsedConfig {
  directives: ApacheDirective[]
  balanced: boolean
}

function parse(text: string): ParsedConfig {
  const root: ApacheDirective = { name: '', args: [], line: 0, lastLine: 0, body: [] }
  const stack = [root]
  let balanced = true
  for (const at of logicalLines(text)) {
    const trimmed = at.text.trim()
    const parent = stack[stack.length - 1]
    if (trimmed === '' || trimmed.startsWith('#')) continue
    if (trimmed.startsWith('</')) {
      if (stack.length === 1 || parent.name !== closerName(trimmed)) balanced = false
      if (stack.length > 1) stack.pop()!.lastLine = at.lastLine
    } else if (trimmed.startsWith('<')) {
      const section = directive(sectionHeader(trimmed), at, [])
      parent.body!.push(section)
      stack.push(section)
    } else parent.body!.push(directive(trimmed, at, null))
  }
  return { directives: root.body!, balanced: balanced && stack.length === 1 }
}

export const parseApacheConfig = (text: string): ApacheDirective[] => parse(text).directives

export function assertBalanced(text: string): void {
  if (!parse(text).balanced) throw new Error(UNBALANCED_SECTIONS)
}

export function descendants(directives: ApacheDirective[], name: string): ApacheDirective[] {
  return directives.flatMap((d) => [...(d.name === name ? [d] : []), ...(d.body ? descendants(d.body, name) : [])])
}

export const within = (section: ApacheDirective, name: string): ApacheDirective[] => descendants(section.body ?? [], name)

export const firstArg = (section: ApacheDirective, name: string): string | null => within(section, name)[0]?.args[0] ?? null

export const virtualHosts = (directives: ApacheDirective[]): ApacheDirective[] => descendants(directives, 'virtualhost')

export function findVirtualHost(fileText: string, blockLine: number): ApacheDirective {
  const vhost = virtualHosts(parseApacheConfig(fileText)).find((v) => v.line === blockLine)
  if (!vhost) throw new Error(`The site at line ${blockLine} was not found in this file. Check again.`)
  return vhost
}

const SERVER_NAME_HOST = /^(?:[a-z][a-z0-9+.-]*:\/\/)?(\[[^\]]+\]|[^:/]+)/i

const hostOf = (serverName: string): string => SERVER_NAME_HOST.exec(serverName)?.[1] ?? serverName

export function vhostNames(vhost: ApacheDirective): string[] {
  const names = within(vhost, 'servername').map((d) => hostOf(d.args[0] ?? ''))
  const aliases = within(vhost, 'serveralias').flatMap((d) => d.args)
  return [...new Set([...names, ...aliases].filter(Boolean))]
}
