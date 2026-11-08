import { randomUUID } from 'crypto'
import { ipcMain } from 'electron'
import { PassThrough } from 'stream'
import type { ServerResult } from '../../../../src/types/server/core'
import { LOG_CHANNEL, type LogEnd, type LogReadResult, type LogSource } from '../../../../src/utils/server/services/logChannel'
import { followLogScript, MISSING_LOG_MARKER, parseLogLines, parseLogSource, readLogScript } from '../../../../src/utils/server/services/logSources'
import { shellQuote } from '../../../../src/utils/server/services/sections'
import type { ServerIpcContext } from '../../../services/server/context'

const READ_TIMEOUT_MS = 30_000
const FOLLOW_LIMIT_MS = 30 * 60_000
const FOLLOW_BYTE_LIMIT = 32 * 1024 * 1024
const FLUSH_MS = 150
const MAX_FOLLOWERS = 8

interface Follower {
  id: string
  stdin: PassThrough
  end: LogEnd | null
}

const ok = <T>(data: T): ServerResult<T> => ({ success: true, data })
const fail = (error: unknown): ServerResult<never> => ({ success: false, error: error instanceof Error ? error.message : String(error) })

function lastLines(stdout: string, count: number): string[] {
  const lines = stdout.replace(/\r/g, '').split('\n')
  if (lines[lines.length - 1] === '') lines.pop()
  return lines.slice(-count)
}

export function createLogStreams(ctx: ServerIpcContext) {
  const followers = new Map<string, Follower>()

  async function read(connectionId: unknown, rawSource: unknown, rawLines: unknown): Promise<ServerResult<LogReadResult>> {
    try {
      const source = parseLogSource(rawSource)
      const lines = parseLogLines(rawLines)
      const exec = typeof connectionId === 'string' ? ctx.execFor(connectionId) : null
      if (!exec) return fail('Not connected')
      const result = await exec(`sh -c ${shellQuote(readLogScript(source, lines))}`, { timeoutMs: READ_TIMEOUT_MS })
      if (result.stdout.includes(MISSING_LOG_MARKER)) return ok({ lines: [], missing: true })
      if (result.code !== 0 && !result.stdout.trim()) return fail(result.stderr.trim() || `The log command exited with code ${result.code}`)
      return ok({ lines: lastLines(result.stdout, lines), missing: false })
    } catch (error) {
      return fail(error)
    }
  }

  function finish(tabId: string, follower: Follower, end: LogEnd): void {
    if (followers.get(tabId) === follower) followers.delete(tabId)
    ctx.broadcast(LOG_CHANNEL.end, follower.id, follower.end ?? end)
  }

  function stopTab(tabId: string, reason: LogEnd): void {
    const follower = followers.get(tabId)
    if (!follower) return
    follower.end ??= reason
    follower.stdin.end()
  }

  function outputPump(follower: Follower, tabId: string) {
    let pending = ''
    let bytes = 0
    let timer: ReturnType<typeof setTimeout> | null = null
    let missing = false
    const flush = () => {
      timer = null
      if (pending) ctx.broadcast(LOG_CHANNEL.chunk, follower.id, pending)
      pending = ''
    }
    const push = (chunk: string) => {
      if (chunk.includes(MISSING_LOG_MARKER)) missing = true
      pending += chunk.split(MISSING_LOG_MARKER).join('')
      bytes += chunk.length
      if (bytes > FOLLOW_BYTE_LIMIT) stopTab(tabId, { reason: 'limit', message: 'Live view stopped after 32 MB of output. Start it again to keep watching.' })
      timer ??= setTimeout(flush, FLUSH_MS)
    }
    const close = () => {
      if (timer) clearTimeout(timer)
      flush()
      return missing
    }
    return { push, close }
  }

  function start(exec: NonNullable<ReturnType<ServerIpcContext['execFor']>>, tabId: string, source: LogSource): string {
    const follower: Follower = { id: randomUUID(), stdin: new PassThrough(), end: null }
    followers.set(tabId, follower)
    const pump = outputPump(follower, tabId)
    exec(`sh -c ${shellQuote(followLogScript(source))}`, { stdin: follower.stdin, timeoutMs: FOLLOW_LIMIT_MS, onOutput: pump.push })
      .then((result) => {
        const missing = pump.close()
        if (missing) return finish(tabId, follower, { reason: 'missing', message: 'This log does not exist on the server.' })
        finish(tabId, follower, { reason: 'ended', message: result.code === 0 ? 'The log stream ended.' : `The log stream ended with code ${result.code}.` })
      })
      .catch((error: unknown) => {
        pump.close()
        finish(tabId, follower, { reason: 'error', message: error instanceof Error ? error.message : String(error) })
      })
    return follower.id
  }

  function follow(connectionId: unknown, tabId: unknown, rawSource: unknown): ServerResult<{ followId: string }> {
    try {
      const source = parseLogSource(rawSource)
      if (typeof tabId !== 'string' || !tabId) return fail('Invalid tab')
      const exec = typeof connectionId === 'string' ? ctx.execFor(connectionId) : null
      if (!exec) return fail('Not connected')
      const others = followers.size - (followers.has(tabId) ? 1 : 0)
      if (others >= MAX_FOLLOWERS) return fail('Too many live logs are open. Stop one first.')
      stopTab(tabId, { reason: 'stopped', message: 'Stopped.' })
      return ok({ followId: start(exec, tabId, source) })
    } catch (error) {
      return fail(error)
    }
  }

  function stop(followId: unknown): ServerResult {
    const entry = [...followers.entries()].find(([, follower]) => follower.id === followId)
    if (entry) stopTab(entry[0], { reason: 'stopped', message: 'Stopped.' })
    return { success: true, data: undefined }
  }

  return { read, follow, stop }
}

export function registerServicesIPC(ctx: ServerIpcContext): void {
  const streams = createLogStreams(ctx)
  ipcMain.handle(LOG_CHANNEL.read, (_event, connectionId: unknown, source: unknown, lines: unknown) => streams.read(connectionId, source, lines))
  ipcMain.handle(LOG_CHANNEL.follow, (_event, connectionId: unknown, tabId: unknown, source: unknown) => streams.follow(connectionId, tabId, source))
  ipcMain.handle(LOG_CHANNEL.stop, (_event, followId: unknown) => streams.stop(followId))
}
