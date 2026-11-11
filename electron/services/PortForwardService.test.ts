import { EventEmitter, once } from 'events'
import { connect, createServer, type AddressInfo, type Server, type Socket } from 'net'
import { Duplex } from 'stream'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { PortForwardSpec } from '../../src/types/portForward'
import type { SSHConnection } from './SSHService'
import { PortForwardService } from './PortForwardService'

vi.mock('./LogService', () => ({ getLogService: () => ({ log: () => {} }) }))

const servers: Server[] = []
const services: PortForwardService[] = []

afterEach(() => {
  for (const service of services.splice(0)) service.stopAll()
  for (const server of servers.splice(0)) server.close()
})

function listen(server: Server): Promise<number> {
  servers.push(server)
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve((server.address() as AddressInfo).port)))
}

const echoServer = () => listen(createServer((socket) => socket.pipe(socket)))

async function freePort(): Promise<number> {
  const server = createServer()
  const port = await listen(server)
  await new Promise((resolve) => server.close(resolve))
  servers.splice(servers.indexOf(server), 1)
  return port
}

function fakeClient() {
  const client = new EventEmitter() as EventEmitter & Record<string, ReturnType<typeof vi.fn>>
  client.forwardOut = vi.fn((_srcIP: string, _srcPort: number, host: string, port: number, cb: (err?: Error, stream?: Socket) => void) => {
    const socket = connect(port, host)
    socket.once('connect', () => cb(undefined, socket))
    socket.once('error', (err) => cb(err))
  })
  client.forwardIn = vi.fn((_host: string, _port: number, cb: (err?: Error) => void) => cb())
  client.unforwardIn = vi.fn()
  return client
}

function fakeConnection(id = 'c1') {
  const conn = new EventEmitter() as EventEmitter & { id: string; sessionId: string; status: string; _client: ReturnType<typeof fakeClient> }
  conn.id = id
  conn.sessionId = 's1'
  conn.status = 'connected'
  conn._client = fakeClient()
  return conn
}

function setup() {
  const onChange = vi.fn()
  const service = new PortForwardService(onChange)
  services.push(service)
  const conn = fakeConnection()
  return { service, onChange, conn, add: (spec: PortForwardSpec, target = conn) => service.add(target as unknown as SSHConnection, spec) }
}

const local = (sourcePort: number, destinationPort: number, id = 'r1'): PortForwardSpec => ({
  id,
  type: 'local',
  sourceHost: '127.0.0.1',
  sourcePort,
  destinationHost: '127.0.0.1',
  destinationPort
})

function roundTrip(port: number, message: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const socket = connect(port, '127.0.0.1', () => socket.write(message))
    socket.once('data', (data) => {
      resolve(data.toString())
      socket.destroy()
    })
    socket.once('error', reject)
  })
}

function canConnect(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = connect(port, '127.0.0.1', () => {
      socket.destroy()
      resolve(true)
    })
    socket.once('error', () => resolve(false))
  })
}

function sendBytes(socket: Socket, bytes: number[]): Promise<Buffer> {
  return new Promise((resolve) => {
    socket.once('data', (data: Buffer) => resolve(data))
    socket.write(Buffer.from(bytes))
  })
}

describe('PortForwardService local forwards', () => {
  it('opens the port and carries data through the SSH connection', async () => {
    const { add, service } = setup()
    const target = await echoServer()
    const port = await freePort()

    const entry = await add(local(port, target))

    expect(entry.status).toBe('active')
    expect(await roundTrip(port, 'ping')).toBe('ping')
    expect(service.list('c1')[0].bytes).toBeGreaterThan(0)
  })

  it('reports a port that is already taken in plain words', async () => {
    const { add, service } = setup()
    const taken = await echoServer()

    const entry = await add(local(taken, 1))

    expect(entry).toMatchObject({ status: 'error', error: `Port ${taken} is already in use on this computer` })
    expect(service.list('c1')).toHaveLength(1)
  })

  it('keeps a running rule when it is started again', async () => {
    const { add, onChange } = setup()
    const port = await freePort()
    const spec = local(port, await echoServer())
    await add(spec)
    onChange.mockClear()

    const again = await add(spec)

    expect(again.status).toBe('active')
    expect(onChange).not.toHaveBeenCalled()
    expect(await roundTrip(port, 'still')).toBe('still')
  })

  it('starts one listener when the same rule is started twice at once', async () => {
    const { add, service } = setup()
    const port = await freePort()
    const spec = local(port, await echoServer())

    const [first, second] = await Promise.all([add(spec), add(spec)])

    expect(first.status).toBe('active')
    expect(second.status).toBe('active')
    expect(service.list('c1')).toHaveLength(1)
  })

  it('moves a rule to its new port when the settings change', async () => {
    const { add } = setup()
    const target = await echoServer()
    const oldPort = await freePort()
    await add(local(oldPort, target))
    const newPort = await freePort()

    await add(local(newPort, target))

    expect(await canConnect(oldPort)).toBe(false)
    expect(await roundTrip(newPort, 'moved')).toBe('moved')
  })

  it('frees the port and tells the windows when a rule is stopped', async () => {
    const { add, service, onChange } = setup()
    const port = await freePort()
    await add(local(port, await echoServer()))
    onChange.mockClear()

    expect(service.remove('c1', 'r1')).toBe(true)

    expect(onChange).toHaveBeenCalledWith('c1')
    expect(service.list('c1')).toEqual([])
    expect(await canConnect(port)).toBe(false)
  })

  it('replaces a rule left over from an older connection with the same id', async () => {
    const { add } = setup()
    const target = await echoServer()
    const port = await freePort()
    await add(local(port, target))

    const entry = await add(local(port, target), fakeConnection('c1'))

    expect(entry.status).toBe('active')
    expect(await roundTrip(port, 'fresh')).toBe('fresh')
  })

  it('remembers why the server could not reach the destination', async () => {
    const { add, service } = setup()
    const port = await freePort()
    const closed = await freePort()
    await add(local(port, closed))

    await canConnect(port)
    await vi.waitFor(() => expect(service.list('c1')[0].lastError).toMatch(`Could not reach 127.0.0.1:${closed} from the server`))
  })

  it('refuses tunnels while the SSH connection is down', async () => {
    const { add, conn } = setup()
    const port = await freePort()
    await add(local(port, await echoServer()))
    conn.status = 'reconnecting'

    await expect(roundTrip(port, 'x')).rejects.toBeTruthy()
    expect(conn._client.forwardOut).not.toHaveBeenCalled()
  })
})

describe('PortForwardService start and stop races', () => {
  it('closes the server-side channel when the app hung up before the tunnel opened', async () => {
    const { add, conn } = setup()
    let open: (err: Error | undefined, stream: Duplex) => void = () => {}
    conn._client.forwardOut.mockImplementation((_a: string, _b: number, _h: string, _p: number, cb: typeof open) => {
      open = cb
    })
    const port = await freePort()
    await add(local(port, 1))
    const socket = connect(port, '127.0.0.1')
    await vi.waitFor(() => expect(conn._client.forwardOut).toHaveBeenCalled())
    socket.destroy()
    await new Promise((resolve) => setTimeout(resolve, 20))

    const channel = new Duplex({ read() {}, write: (_c, _e, done) => done() })
    const destroy = vi.spyOn(channel, 'destroy')
    open(undefined, channel)

    expect(destroy).toHaveBeenCalled()
  })

  it('drops a local rule whose connection closed while it was starting', async () => {
    const { add, service } = setup()
    const port = await freePort()
    const starting = add(local(port, 1))

    service.removeAll('c1')

    expect((await starting).status).toBe('error')
    expect(service.list('c1')).toEqual([])
    expect(await canConnect(port)).toBe(false)
  })
})

describe('PortForwardService SOCKS proxy', () => {
  async function openProxy() {
    const { add } = setup()
    const port = await freePort()
    await add({ id: 'socks', type: 'dynamic', sourceHost: '127.0.0.1', sourcePort: port })
    const socket = connect(port, '127.0.0.1')
    await new Promise((resolve) => socket.once('connect', resolve))
    return socket
  }

  it('connects a SOCKS5 client to the host it asks for', async () => {
    const target = await echoServer()
    const socket = await openProxy()

    expect([...(await sendBytes(socket, [5, 1, 0]))]).toEqual([5, 0])
    const host = Buffer.from('localhost')
    const reply = await sendBytes(socket, [5, 1, 0, 3, host.length, ...host, target >> 8, target & 0xff])
    expect(reply[1]).toBe(0)
    expect((await sendBytes(socket, [...Buffer.from('hello')])).toString()).toBe('hello')
    socket.destroy()
  })

  it('refuses SOCKS commands other than CONNECT', async () => {
    const socket = await openProxy()
    await sendBytes(socket, [5, 1, 0])

    const reply = await sendBytes(socket, [5, 2, 0, 1, 127, 0, 0, 1, 0, 80])

    expect(reply[1]).toBe(7)
    socket.destroy()
  })

  it('refuses clients that need a password', async () => {
    const socket = await openProxy()

    expect([...(await sendBytes(socket, [5, 1, 2]))]).toEqual([5, 0xff])
    socket.destroy()
  })
})

describe('PortForwardService remote forwards', () => {
  const remote = (destinationPort: number): PortForwardSpec => ({
    id: 'rem',
    type: 'remote',
    sourceHost: '127.0.0.1',
    sourcePort: 9000,
    destinationHost: '127.0.0.1',
    destinationPort
  })

  async function channelPair(): Promise<[Socket, Socket]> {
    const server = createServer()
    const port = await listen(server)
    const accepted = new Promise<Socket>((resolve) => server.once('connection', resolve))
    const outside = connect(port, '127.0.0.1')
    await once(outside, 'connect')
    return [await accepted, outside]
  }

  it('asks the server to listen and sends its connections to this computer', async () => {
    const { add, conn } = setup()
    const target = await echoServer()

    const entry = await add(remote(target))

    expect(entry.status).toBe('active')
    expect(conn._client.forwardIn).toHaveBeenCalledWith('127.0.0.1', 9000, expect.any(Function))
    const [channel, serverSide] = await channelPair()
    conn._client.emit('tcp connection', { destPort: 9000 }, () => channel)
    const echoed = new Promise<string>((resolve) => serverSide.once('data', (d) => resolve(d.toString())))
    serverSide.write('remote')
    expect(await echoed).toBe('remote')
    serverSide.destroy()
  })

  it('counts a remote connection as closed once this computer hangs up', async () => {
    const { add, conn, service } = setup()
    const hangsUp = await listen(createServer((socket) => socket.end('bye')))
    await add(remote(hangsUp))
    const channel = new Duplex({ read() {}, write: (_chunk, _encoding, done) => done(), emitClose: false, autoDestroy: false })
    channel.destroy = () => {
      channel.end()
      channel.push(null)
      return channel
    }
    channel.once('end', () => channel.emit('close'))

    conn._client.emit('tcp connection', { destPort: 9000 }, () => channel)

    await vi.waitFor(() => expect(service.list('c1')[0].openConnections).toBe(0))
  })

  it('ignores connections meant for another remote port', async () => {
    const { add, conn } = setup()
    await add(remote(await echoServer()))
    const accept = vi.fn()

    conn._client.emit('tcp connection', { destPort: 9001 }, accept)

    expect(accept).not.toHaveBeenCalled()
  })

  it('listens again on the server after a reconnect', async () => {
    const { add, conn } = setup()
    await add(remote(await echoServer()))
    const next = fakeClient()

    conn._client = next
    conn.emit('status', 'connected')

    await vi.waitFor(() => expect(next.forwardIn).toHaveBeenCalledWith('127.0.0.1', 9000, expect.any(Function)))
  })

  it('stops listening on the server when the rule is stopped', async () => {
    const { add, conn, service } = setup()
    await add(remote(await echoServer()))

    service.remove('c1', 'rem')

    expect(conn._client.unforwardIn).toHaveBeenCalledWith('127.0.0.1', 9000, expect.any(Function))
    expect(conn._client.listenerCount('tcp connection')).toBe(0)
    expect(conn.listenerCount('status')).toBe(0)
  })

  it('drops a rule that is stopped while the server is still opening its port', async () => {
    const { add, conn, service } = setup()
    let answer: (err?: Error) => void = () => {}
    conn._client.forwardIn.mockImplementation((_h: string, _p: number, cb: (err?: Error) => void) => {
      answer = cb
    })
    const starting = add(remote(1))

    expect(service.remove('c1', 'rem')).toBe(true)
    answer()

    expect((await starting).status).toBe('error')
    expect(service.list('c1')).toEqual([])
    expect(conn._client.listenerCount('tcp connection')).toBe(0)
    expect(conn._client.unforwardIn).toHaveBeenCalled()
  })

  it('does not listen again when the rule was stopped during a reconnect', async () => {
    const { add, conn, service, onChange } = setup()
    await add(remote(await echoServer()))
    const next = fakeClient()
    let answer: (err?: Error) => void = () => {}
    next.forwardIn.mockImplementation((_h: string, _p: number, cb: (err?: Error) => void) => {
      answer = cb
    })
    conn._client = next
    conn.emit('status', 'connected')

    service.remove('c1', 'rem')
    onChange.mockClear()
    answer()
    await Promise.resolve()

    expect(next.listenerCount('tcp connection')).toBe(0)
    expect(next.unforwardIn).toHaveBeenCalledWith('127.0.0.1', 9000, expect.any(Function))
    expect(onChange).not.toHaveBeenCalled()
  })

  it('reports when the server refuses to listen', async () => {
    const { add, conn } = setup()
    conn._client.forwardIn.mockImplementation((_h: string, _p: number, cb: (err?: Error) => void) => cb(new Error('remote port forwarding failed')))

    const entry = await add(remote(1))

    expect(entry).toMatchObject({ status: 'error', error: 'The server refused to listen on 127.0.0.1:9000: remote port forwarding failed' })
  })
})
