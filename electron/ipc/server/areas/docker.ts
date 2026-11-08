import { ipcMain } from 'electron'
import { PassThrough } from 'stream'
import type { ServerResult } from '../../../../src/types/server/core'
import { LOG_BYTE_LIMIT, logsCommand, manifestCommand } from '../../../../src/utils/server/docker/logs'
import { parseManifest, type ManifestCheck } from '../../../../src/utils/server/docker/manifest'
import { containerRef, imageReference } from '../../../../src/utils/server/docker/validate'
import type { RemoteExec } from '../../../services/deploy/DeployService'
import type { ServerIpcContext } from '../../../services/server/context'

export const DOCKER_LOGS_DATA = 'server:docker:logs-data'
export const DOCKER_LOGS_END = 'server:docker:logs-end'

const FOLLOW_TIMEOUT_MS = 30 * 60_000
const SNAPSHOT_TIMEOUT_MS = 30_000
const MANIFEST_TIMEOUT_MS = 30_000
const STREAM_KEY = /^[\w:.-]{1,128}$/

interface LogStream {
  id: string
  input: PassThrough
}

function handle<T>(channel: string, fn: (...args: unknown[]) => Promise<T> | T): void {
  ipcMain.handle(channel, async (_event, ...args: unknown[]): Promise<ServerResult<T>> => {
    try {
      return { success: true, data: await fn(...args) }
    } catch (err) {
      return { success: false, error: (err as Error).message }
    }
  })
}

function text(value: unknown, field: string): string {
  if (typeof value !== 'string' || value === '') throw new Error(`Invalid ${field}`)
  return value
}

function streamKey(value: unknown): string {
  const key = text(value, 'stream key')
  if (!STREAM_KEY.test(key)) throw new Error('Invalid stream key')
  return key
}

function requireExec(ctx: ServerIpcContext, connectionId: unknown): RemoteExec {
  const exec = ctx.execFor(text(connectionId, 'connection'))
  if (!exec) throw new Error('The server is not connected')
  return exec
}

function endMessage(error: unknown, limited: boolean): string | null {
  if (limited) return 'Stopped after 8 MB of output. Start again to keep following.'
  if (!error) return null
  return /timed out/i.test((error as Error).message) ? 'Stopped after 30 minutes. Start again to keep following.' : (error as Error).message
}

export function createLogStreams(ctx: ServerIpcContext) {
  const streams = new Map<string, LogStream>()
  let counter = 0

  const isCurrent = (key: string, id: string): boolean => streams.get(key)?.id === id

  function stop(key: string): void {
    const stream = streams.get(key)
    if (!stream) return
    streams.delete(key)
    stream.input.end()
  }

  function start(exec: RemoteExec, key: string, container: string, follow: boolean): string {
    stop(key)
    counter += 1
    const id = `${key}#${counter}`
    const input = new PassThrough()
    streams.set(key, { id, input })
    let bytes = 0
    let limited = false
    const onOutput = (chunk: string) => {
      if (!isCurrent(key, id)) return
      bytes += Buffer.byteLength(chunk)
      ctx.broadcast(DOCKER_LOGS_DATA, id, chunk)
      if (bytes < LOG_BYTE_LIMIT) return
      limited = true
      stop(key)
    }
    const finish = (error: unknown) => {
      if (isCurrent(key, id)) streams.delete(key)
      ctx.broadcast(DOCKER_LOGS_END, id, endMessage(error, limited))
    }
    exec(logsCommand(container, follow), { stdin: input, timeoutMs: follow ? FOLLOW_TIMEOUT_MS : SNAPSHOT_TIMEOUT_MS, onOutput }).then(() => finish(null), finish)
    return id
  }

  return { start, stop }
}

export async function checkManifest(exec: RemoteExec, reference: string): Promise<ManifestCheck> {
  const result = await exec(manifestCommand(reference), { timeoutMs: MANIFEST_TIMEOUT_MS })
  return parseManifest(result.stdout, result.stderr, result.code)
}

export function registerDockerIPC(ctx: ServerIpcContext): void {
  const logs = createLogStreams(ctx)
  handle('server:docker:logs-start', (connectionId, key, container, follow) =>
    logs.start(requireExec(ctx, connectionId), streamKey(key), containerRef(container), follow === true))
  handle('server:docker:logs-stop', (key) => logs.stop(streamKey(key)))
  handle('server:docker:manifest', (connectionId, reference) => checkManifest(requireExec(ctx, connectionId), imageReference(reference)))
}
