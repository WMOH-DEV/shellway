import { splitLines } from '../../ssl/originCa/diff'

export interface VhostEntry {
  address: string
  port: number
  name: string
  aliases: string[]
  file: string
  line: number
  isDefault: boolean
}

export interface VhostDump {
  entries: VhostEntry[]
  files: string[]
}

interface ListenAddress {
  address: string
  port: number
}

interface DumpState {
  entries: VhostEntry[]
  group: ListenAddress | null
  last: VhostEntry | null
}

const ANY_PORT = 0
const LISTEN_ADDRESS = /^(?:\[([^\]]+)\]|([^\s:]+)):(\d+|\*)$/
const NAME_VIRTUAL_HOST = /^(\S+)\s+is a NameVirtualHost$/
const SINGLE_VHOST = /^(\S+)\s+(\S+) \((.+):(\d+)\)$/
const DEFAULT_SERVER = /^default server (\S+) \((.+):(\d+)\)$/
const NAME_VHOST = /^port (\d+|\*) namevhost (\S+) \((.+):(\d+)\)$/
const ALIAS = /^(?:wild )?alias (\S+)$/
const MODULE_LINE = /^\s+(\w+)_module \((?:static|shared)\)$/

const portOf = (value: string): number => (value === '*' ? ANY_PORT : Number(value))

function parseListenAddress(spec: string): ListenAddress | null {
  const match = LISTEN_ADDRESS.exec(spec)
  return match ? { address: match[1] ?? match[2], port: portOf(match[3]) } : null
}

function entry(listen: ListenAddress, name: string, file: string, line: string, isDefault: boolean): VhostEntry {
  return { address: listen.address, port: listen.port, name, aliases: [], file, line: Number(line), isDefault }
}

function startGroup(state: DumpState, spec: string): boolean {
  const listen = parseListenAddress(spec)
  if (!listen) return false
  state.group = listen
  state.last = null
  return true
}

function addSingle(state: DumpState, match: RegExpExecArray): boolean {
  const listen = parseListenAddress(match[1])
  if (!listen) return false
  state.group = null
  state.last = entry(listen, match[2], match[3], match[4], true)
  state.entries.push(state.last)
  return true
}

function addDefault(state: DumpState, group: ListenAddress, match: RegExpExecArray): void {
  state.last = entry(group, match[1], match[2], match[3], true)
  state.entries.push(state.last)
}

function addNamed(state: DumpState, group: ListenAddress, match: RegExpExecArray): void {
  const named = entry({ address: group.address, port: portOf(match[1]) }, match[2], match[3], match[4], false)
  const same = state.entries.find((e) => e.file === named.file && e.line === named.line && e.address === named.address && e.port === named.port)
  state.last = same ?? named
  if (!same) state.entries.push(named)
}

function readTopLine(state: DumpState, line: string): void {
  const group = NAME_VIRTUAL_HOST.exec(line)
  const single = SINGLE_VHOST.exec(line)
  if (group && startGroup(state, group[1])) return
  if (single && addSingle(state, single)) return
  state.group = null
  state.last = null
}

function readIndentedLine(state: DumpState, line: string): void {
  const fallback = DEFAULT_SERVER.exec(line)
  const named = NAME_VHOST.exec(line)
  const alias = ALIAS.exec(line)
  if (fallback && state.group) addDefault(state, state.group, fallback)
  else if (named && state.group) addNamed(state, state.group, named)
  else if (alias && state.last) state.last.aliases.push(alias[1])
}

export function parseVhostDump(text: string): VhostDump {
  const state: DumpState = { entries: [], group: null, last: null }
  for (const line of splitLines(text)) {
    if (/^\s/.test(line)) readIndentedLine(state, line.trim())
    else readTopLine(state, line)
  }
  return { entries: state.entries, files: [...new Set(state.entries.map((e) => e.file))] }
}

export function parseModules(text: string): string[] {
  return splitLines(text).flatMap((line) => MODULE_LINE.exec(line)?.[1] ?? [])
}

export const isConfigTestOk = (code: number | null, output: string): boolean => code === 0 && !/syntax error/i.test(output)
