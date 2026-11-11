import { connect as netConnect, createServer, type Socket } from 'net'
import type { Duplex } from 'stream'
import type { PortForwardEntry, PortForwardSpec } from '../../src/types/portForward'
import type { SSHConnection } from './SSHService'
import { getLogService } from './LogService'
import { SOCKS_REPLY, acceptSocks, replySocks } from './socks5'

export type { PortForwardEntry, PortForwardSpec }

interface Forward {
  entry: PortForwardEntry
  conn: SSHConnection
  sockets: Set<Duplex>
  stop: () => void
}

type TcpConnectionInfo = { destPort: number }
type AcceptTcp = () => Duplex

const address = (host: string | undefined, port: number | undefined) => `${host}:${port}`

function describe(entry: PortForwardEntry): string {
  const source = address(entry.sourceHost, entry.sourcePort)
  const destination = address(entry.destinationHost, entry.destinationPort)
  if (entry.type === 'dynamic') return `SOCKS proxy active: ${source}`
  if (entry.type === 'remote') return `Remote forward active: server ${source} -> ${destination}`
  return `Local forward active: ${source} -> ${destination}`
}

function listenErrorMessage(err: NodeJS.ErrnoException, host: string, port: number): string {
  if (err.code === 'EADDRINUSE') return `Port ${port} is already in use on this computer`
  if (err.code === 'EACCES') return `Port ${port} needs administrator rights on this computer`
  if (err.code === 'EADDRNOTAVAIL') return `${host} is not an address of this computer`
  return err.message
}

function sameSpec(entry: PortForwardEntry, spec: PortForwardSpec): boolean {
  return (
    entry.type === spec.type &&
    entry.sourceHost === spec.sourceHost &&
    entry.sourcePort === spec.sourcePort &&
    entry.destinationHost === spec.destinationHost &&
    entry.destinationPort === spec.destinationPort
  )
}

function snapshot(forward: Forward): PortForwardEntry {
  return { ...forward.entry, openConnections: forward.sockets.size }
}

const startKey = (connectionId: string, ruleId: string) => `${connectionId}:${ruleId}`

function discard(forward: Forward): void {
  for (const socket of forward.sockets) socket.destroy()
  forward.sockets.clear()
  forward.stop()
}

export class PortForwardService {
  private forwards = new Map<string, Map<string, Forward>>()
  private starting = new Map<string, Promise<PortForwardEntry>>()
  private cancelled = new Set<string>()

  constructor(private readonly onChange: (connectionId: string) => void = () => {}) {}

  add(conn: SSHConnection, spec: PortForwardSpec): Promise<PortForwardEntry> {
    const key = startKey(conn.id, spec.id)
    const pending = this.starting.get(key)
    if (pending) return pending

    const current = this.forwards.get(conn.id)?.get(spec.id)
    if (current?.conn === conn && current.entry.status === 'active' && sameSpec(current.entry, spec)) {
      return Promise.resolve(snapshot(current))
    }
    if (current) this.remove(conn.id, spec.id)

    const started = this.start(conn, spec).finally(() => this.starting.delete(key))
    this.starting.set(key, started)
    return started
  }

  remove(connectionId: string, ruleId: string): boolean {
    const key = startKey(connectionId, ruleId)
    const isStarting = this.starting.has(key)
    if (isStarting) this.cancelled.add(key)

    const forward = this.forwards.get(connectionId)?.get(ruleId)
    if (!forward) return isStarting

    discard(forward)

    const connForwards = this.forwards.get(connectionId)!
    connForwards.delete(ruleId)
    if (connForwards.size === 0) this.forwards.delete(connectionId)

    getLogService().log(
      forward.conn.sessionId,
      'info',
      'portforward',
      `Forward removed: ${address(forward.entry.sourceHost, forward.entry.sourcePort)}`
    )
    this.onChange(connectionId)
    return true
  }

  list(connectionId: string): PortForwardEntry[] {
    return Array.from(this.forwards.get(connectionId)?.values() ?? [], snapshot)
  }

  removeAll(connectionId: string): void {
    for (const key of this.starting.keys()) {
      if (key.startsWith(`${connectionId}:`)) this.cancelled.add(key)
    }
    for (const ruleId of Array.from(this.forwards.get(connectionId)?.keys() ?? [])) {
      this.remove(connectionId, ruleId)
    }
  }

  stopAll(): void {
    for (const connectionId of Array.from(this.forwards.keys())) this.removeAll(connectionId)
  }

  private async start(conn: SSHConnection, spec: PortForwardSpec): Promise<PortForwardEntry> {
    const forward: Forward = {
      entry: { ...spec, connectionId: conn.id, status: 'active', openConnections: 0, bytes: 0 },
      conn,
      sockets: new Set(),
      stop: () => {}
    }

    try {
      forward.stop = spec.type === 'remote' ? await this.bindRemote(forward) : await this.listenLocal(forward)
      getLogService().log(conn.sessionId, 'info', 'portforward', describe(forward.entry))
    } catch (err) {
      this.recordFailure(forward, err instanceof Error ? err.message : String(err))
    }

    if (this.cancelled.delete(startKey(conn.id, spec.id))) {
      discard(forward)
      return { ...snapshot(forward), status: 'error', error: 'Stopped before it finished starting' }
    }

    if (!this.forwards.has(conn.id)) this.forwards.set(conn.id, new Map())
    this.forwards.get(conn.id)!.set(spec.id, forward)
    this.onChange(conn.id)
    return snapshot(forward)
  }

  private async listenLocal(forward: Forward): Promise<() => void> {
    const { sourceHost, sourcePort } = forward.entry
    const server = createServer((socket) => this.acceptLocal(forward, socket))

    await new Promise<void>((resolve, reject) => {
      server.once('error', (err: NodeJS.ErrnoException) => reject(new Error(listenErrorMessage(err, sourceHost, sourcePort))))
      server.listen(sourcePort, sourceHost, () => resolve())
    })
    server.removeAllListeners('error')
    server.on('error', (err) => this.noteError(forward, err.message))
    return () => server.close()
  }

  private acceptLocal(forward: Forward, socket: Socket): void {
    this.track(forward, socket)
    socket.on('error', () => socket.destroy())
    const { type, destinationHost, destinationPort } = forward.entry
    if (type !== 'dynamic') {
      this.tunnel(forward, socket, destinationHost!, destinationPort!, false)
      return
    }
    acceptSocks(socket).then(
      (target) => this.tunnel(forward, socket, target.host, target.port, true),
      () => socket.destroy()
    )
  }

  private tunnel(forward: Forward, socket: Socket, host: string, port: number, socks: boolean): void {
    const fail = (reply: number) => {
      if (socks) replySocks(socket, reply)
      socket.destroy()
    }
    if (forward.conn.status !== 'connected') return fail(SOCKS_REPLY.generalFailure)

    const unreachable = (err: unknown) => {
      const reason = err instanceof Error ? err.message : String(err)
      this.noteError(forward, `Could not reach ${address(host, port)} from the server: ${reason}`)
      fail(SOCKS_REPLY.connectionRefused)
    }

    try {
      forward.conn._client.forwardOut(socket.remoteAddress ?? '127.0.0.1', socket.remotePort ?? 0, host, port, (err, stream) => {
        if (err) return unreachable(err)
        if (socket.destroyed) return void stream.destroy()
        forward.entry.lastError = undefined
        if (socks) replySocks(socket, SOCKS_REPLY.succeeded)
        this.pipe(forward, socket, stream)
      })
    } catch (err) {
      unreachable(err)
    }
  }

  private async bindRemote(forward: Forward): Promise<() => void> {
    const { conn, entry } = forward
    let client: SSHConnection['_client'] | null = null
    let stopped = false

    const onTcp = (info: TcpConnectionInfo, accept: AcceptTcp) => {
      if (info.destPort !== entry.sourcePort) return
      const channel = accept()
      this.track(forward, channel)
      const local = netConnect(entry.destinationPort!, entry.destinationHost!)
      local.once('connect', () => {
        entry.lastError = undefined
      })
      local.on('error', (err) =>
        this.noteError(forward, `Could not reach ${address(entry.destinationHost, entry.destinationPort)} on this computer: ${err.message}`)
      )
      this.pipe(forward, channel, local)
    }

    const unforward = (target: SSHConnection['_client']) => {
      try {
        target.unforwardIn(entry.sourceHost, entry.sourcePort, () => {})
      } catch {}
    }

    const bind = () =>
      new Promise<void>((resolve, reject) => {
        client?.off('tcp connection', onTcp)
        const bound = conn._client
        client = bound
        bound.forwardIn(entry.sourceHost, entry.sourcePort, (err) => {
          if (err) return reject(new Error(`The server refused to listen on ${address(entry.sourceHost, entry.sourcePort)}: ${err.message}`))
          if (stopped) unforward(bound)
          else bound.on('tcp connection', onTcp)
          resolve()
        })
      })

    const onStatus = (status: string) => {
      if (status !== 'connected' || conn._client === client) return
      bind().then(
        () => stopped || this.markActive(forward),
        (err: Error) => stopped || this.markError(forward, err.message)
      )
    }

    await bind()
    conn.on('status', onStatus)

    return () => {
      stopped = true
      conn.off('status', onStatus)
      client?.off('tcp connection', onTcp)
      if (conn.status === 'connected' && client === conn._client) unforward(client)
    }
  }

  private pipe(forward: Forward, outer: Duplex, inner: Duplex): void {
    const closeBoth = () => {
      for (const stream of [outer, inner]) {
        stream.destroy()
        stream.resume()
      }
    }
    for (const stream of [outer, inner]) {
      stream.on('data', (chunk: Buffer) => {
        forward.entry.bytes += chunk.length
      })
      stream.on('error', closeBoth)
      stream.on('close', closeBoth)
    }
    outer.pipe(inner)
    inner.pipe(outer)
  }

  private track(forward: Forward, socket: Duplex): void {
    forward.sockets.add(socket)
    socket.once('close', () => forward.sockets.delete(socket))
  }

  private noteError(forward: Forward, message: string): void {
    forward.entry.lastError = message
    getLogService().log(forward.conn.sessionId, 'error', 'portforward', `Tunnel error: ${message}`)
  }

  private markActive(forward: Forward): void {
    forward.entry.status = 'active'
    forward.entry.error = undefined
    getLogService().log(forward.conn.sessionId, 'info', 'portforward', describe(forward.entry))
    this.onChange(forward.conn.id)
  }

  private markError(forward: Forward, message: string): void {
    this.recordFailure(forward, message)
    this.onChange(forward.conn.id)
  }

  private recordFailure(forward: Forward, message: string): void {
    forward.entry.status = 'error'
    forward.entry.error = message
    getLogService().log(
      forward.conn.sessionId,
      'error',
      'portforward',
      `Forward ${address(forward.entry.sourceHost, forward.entry.sourcePort)} failed: ${message}`
    )
  }
}
