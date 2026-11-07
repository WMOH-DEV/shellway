import { MASK } from './identifiers'
import { envValue } from './siteEnv'

export type EnvEntry = [key: string, value: string]

const SECRET_KEYS = ['DB_PASSWORD']

const activeKey = (line: string): string | null => /^([A-Z0-9_]+)=/.exec(line)?.[1] ?? null

const commentedKey = (line: string): string | null => /^#\s*([A-Z0-9_]+)=/.exec(line)?.[1] ?? null

export function setEnvKeys(content: string, entries: EnvEntry[]): string {
  const values = new Map(entries)
  const lines = content === '' ? [] : content.replace(/\n$/, '').split('\n')
  const active = new Set(lines.map(activeKey).filter((key): key is string => key !== null && values.has(key)))
  const written = new Set<string>()
  const updated = lines.map((line) => {
    const key = activeKey(line) ?? commentedKey(line)
    if (key === null || !values.has(key)) return line
    const isActive = activeKey(line) !== null
    if (!isActive && (active.has(key) || written.has(key))) return line
    written.add(key)
    return `${key}=${values.get(key)}`
  })
  const missing = entries.filter(([key]) => !written.has(key)).map(([key, value]) => `${key}=${value}`)
  return `${[...updated, ...missing].join('\n')}\n`
}

const shown = (key: string, value: string): string => (SECRET_KEYS.includes(key) ? MASK : value)

export function envDiff(content: string, entries: EnvEntry[]): string {
  return entries
    .flatMap(([key, value]) => {
      const previous = envValue(content, key)
      if (previous === value) return []
      return [...(previous ? [`- ${key}=${shown(key, previous)}`] : []), `+ ${key}=${shown(key, value)}`]
    })
    .join('\n')
}
