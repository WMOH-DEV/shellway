import type { ProbeDefinition } from '@/types/server/core'
import { ROOT_PRELUDE, firstLine, hasRoot, sections, sshClientPart } from './shell'

export const UFW_PROBE = 'security.ufw'

export type UfwAction = 'allow' | 'deny' | 'reject' | 'limit'
export type UfwPolicy = 'allow' | 'deny' | 'reject'

export interface UfwRule {
  number: number
  to: string
  action: UfwAction
  direction: 'in' | 'out' | 'fwd'
  from: string
  comment: string
  v6: boolean
  raw: string
}

export interface UfwRuleGroup {
  key: string
  to: string
  action: UfwAction
  direction: 'in' | 'out' | 'fwd'
  from: string
  comment: string
  rules: UfwRule[]
  protectedSsh: boolean
}

export interface PublishedPort {
  container: string
  binding: string
  publicBinding: boolean
}

export interface UfwFacts {
  installed: boolean
  root: boolean
  active: boolean
  enabledInConfig: boolean
  defaults: { incoming: string; outgoing: string; routed: string } | null
  rules: UfwRule[]
  sshPort: number | null
  dockerInstalled: boolean
  published: PublishedPort[]
}

const script = [
  ROOT_PRELUDE,
  'echo "@@installed"; if [ -x /usr/sbin/ufw ] || command -v ufw >/dev/null 2>&1; then echo yes; else echo no; fi',
  'echo "@@conf"; grep -E "^ENABLED=" /etc/ufw/ufw.conf 2>/dev/null',
  'echo "@@verbose"; asroot ufw status verbose 2>/dev/null',
  'echo "@@numbered"; asroot ufw status numbered 2>/dev/null',
  'echo "@@docker"; if command -v docker >/dev/null 2>&1; then echo yes; else echo no; fi',
  'echo "@@published"; if command -v docker >/dev/null 2>&1; then asroot docker ps --format "{{.Names}}\\t{{.Ports}}" 2>/dev/null; fi',
  'echo "@@session"; echo "$SSH_CONNECTION"'
].join('\n')

const RULE_LINE = /^\[\s*(\d+)\]\s+(.+?)\s+(ALLOW|DENY|REJECT|LIMIT)(?:\s+(IN|OUT|FWD))?\s+(.+?)\s*$/

export function parseUfwRule(line: string): UfwRule | null {
  const trimmed = line.replace(/\s+$/, '')
  const match = RULE_LINE.exec(trimmed.trim())
  if (!match) return null
  const [, number, to, action, direction, rest] = match
  const commentAt = rest.indexOf(' # ')
  const from = (commentAt >= 0 ? rest.slice(0, commentAt) : rest).trim()
  const comment = commentAt >= 0 ? rest.slice(commentAt + 3).trim() : ''
  return {
    number: Number(number),
    to: to.trim(),
    action: action.toLowerCase() as UfwAction,
    direction: (direction ?? 'IN').toLowerCase() as UfwRule['direction'],
    from,
    comment,
    v6: /\(v6\)/.test(to) || /\(v6\)/.test(from),
    raw: trimmed.trim()
  }
}

export function parseUfwDefaults(verbose: string): UfwFacts['defaults'] {
  const line = verbose.split('\n').find((candidate) => candidate.startsWith('Default:'))
  if (!line) return null
  const pick = (name: string) => new RegExp(`(\\w+) \\(${name}\\)`).exec(line)?.[1] ?? 'unknown'
  return { incoming: pick('incoming'), outgoing: pick('outgoing'), routed: pick('routed') }
}

export function parsePublished(lines: string[]): PublishedPort[] {
  return lines.flatMap((line) => {
    const [container, ports = ''] = line.split('\t')
    if (!container?.trim() || !ports.trim()) return []
    return ports.split(',').map((part) => part.trim()).filter((part) => part.includes('->')).map((binding) => ({
      container: container.trim(),
      binding,
      publicBinding: /^(0\.0\.0\.0|\[::\]|:::)/.test(binding)
    }))
  })
}

export function parseUfw(stdout: string): UfwFacts {
  const parts = sections(stdout)
  const verbose = (parts.get('verbose') ?? []).join('\n')
  const status = firstLine(parts, 'verbose')
  const port = Number(sshClientPart(firstLine(parts, 'session'), 3))
  const root = hasRoot(parts)
  const enabledInConfig = firstLine(parts, 'conf') === 'ENABLED=yes'
  return {
    installed: firstLine(parts, 'installed') === 'yes',
    root,
    active: root ? status === 'Status: active' : enabledInConfig,
    enabledInConfig,
    defaults: parseUfwDefaults(verbose),
    rules: (parts.get('numbered') ?? []).map(parseUfwRule).filter((rule): rule is UfwRule => rule !== null),
    sshPort: Number.isInteger(port) && port > 0 ? port : null,
    dockerInstalled: firstLine(parts, 'docker') === 'yes',
    published: parsePublished(parts.get('published') ?? [])
  }
}

const stripV6 = (value: string): string => value.replace(/\s*\(v6\)/, '').trim()

export function ruleTargetsPort(to: string, port: number): boolean {
  const base = stripV6(to)
  if (base === 'OpenSSH' && port === 22) return true
  const match = /^(\d+)(?::(\d+))?(?:\/(tcp|udp))?$/.exec(base)
  if (!match || match[3] === 'udp') return false
  const low = Number(match[1])
  const high = match[2] ? Number(match[2]) : low
  return port >= low && port <= high
}

export function groupUfwRules(rules: UfwRule[], sshPort: number | null): UfwRuleGroup[] {
  const groups = new Map<string, UfwRuleGroup>()
  for (const rule of rules) {
    const key = [stripV6(rule.to), rule.action, rule.direction, stripV6(rule.from), rule.comment].join('|')
    const existing = groups.get(key)
    if (existing) {
      existing.rules.push(rule)
      continue
    }
    groups.set(key, {
      key,
      to: stripV6(rule.to),
      action: rule.action,
      direction: rule.direction,
      from: stripV6(rule.from),
      comment: rule.comment,
      rules: [rule],
      protectedSsh: sshPort !== null && rule.action !== 'deny' && rule.action !== 'reject' && rule.direction === 'in' && ruleTargetsPort(rule.to, sshPort)
    })
  }
  return [...groups.values()]
}

export const ufwProbe: ProbeDefinition<UfwFacts> = {
  id: UFW_PROBE,
  area: 'security',
  root: false,
  timeoutSeconds: 20,
  script,
  parse: parseUfw
}
