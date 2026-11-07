import type { ProbeDefinition } from '@/types/server/core'
import { REDIS_PROBE } from './facts'
import { hasSection, sectionLines, splitSections, toInt } from './sections'
import type { RedisFacts, RedisKeyspace } from './types'

const SCRIPT = `command -v redis-cli >/dev/null 2>&1 || { echo @@missing; exit 0; }
echo @@info
timeout 5 redis-cli INFO 2>&1 | head -n 300
`

function emptyRedis(status: RedisFacts['status'], reason: string): RedisFacts {
  return { status, reason, version: '', port: null, uptimeSeconds: 0, usedMemory: '', maxMemory: '', clients: 0, keyspace: [] }
}

function infoValues(lines: string[]): Map<string, string> {
  const values = new Map<string, string>()
  for (const line of lines) {
    const separator = line.indexOf(':')
    if (separator > 0 && !line.startsWith('#')) values.set(line.slice(0, separator), line.slice(separator + 1).trim())
  }
  return values
}

function keyspace(values: Map<string, string>): RedisKeyspace[] {
  return [...values]
    .filter(([key]) => /^db\d+$/.test(key))
    .map(([db, value]) => {
      const fields = new Map(value.split(',').map((pair) => pair.split('=') as [string, string]))
      return { db, keys: toInt(fields.get('keys')), expires: toInt(fields.get('expires')) }
    })
}

function failure(text: string): RedisFacts | null {
  if (/NOAUTH|Authentication required/i.test(text)) return emptyRedis('needs-password', 'Redis requires a password, so Shellway cannot read its details.')
  if (/could not connect|connection refused/i.test(text)) return emptyRedis('stopped', 'Redis is installed but not running.')
  return null
}

export function parseRedis(stdout: string): RedisFacts {
  const sections = splitSections(stdout)
  if (hasSection(sections, 'missing')) return emptyRedis('missing', 'Redis is not installed.')
  const lines = sectionLines(sections, 'info')
  const failed = failure(lines.slice(0, 3).join(' '))
  if (failed) return failed
  const values = infoValues(lines)
  if (!values.has('redis_version')) return emptyRedis('stopped', lines[0] ?? 'Redis did not answer.')
  return {
    status: 'ok',
    reason: '',
    version: values.get('redis_version') ?? '',
    port: values.has('tcp_port') ? toInt(values.get('tcp_port')) : null,
    uptimeSeconds: toInt(values.get('uptime_in_seconds')),
    usedMemory: values.get('used_memory_human') ?? '',
    maxMemory: values.get('maxmemory_human') ?? '',
    clients: toInt(values.get('connected_clients')),
    keyspace: keyspace(values)
  }
}

export const redisProbe: ProbeDefinition<RedisFacts> = {
  id: REDIS_PROBE,
  area: 'databases',
  root: false,
  timeoutSeconds: 15,
  script: SCRIPT,
  parse: parseRedis
}
