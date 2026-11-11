import type { Socket } from 'net'

export interface SocksTarget {
  host: string
  port: number
}

const VERSION = 5
const NO_AUTH = 0
const NO_ACCEPTABLE_METHOD = 0xff
const CONNECT = 1

export const SOCKS_REPLY = {
  succeeded: 0,
  generalFailure: 1,
  connectionRefused: 5,
  commandNotSupported: 7,
  addressTypeNotSupported: 8
} as const

export function replySocks(socket: Socket, code: number): void {
  if (socket.destroyed) return
  socket.write(Buffer.from([VERSION, code, 0, 1, 0, 0, 0, 0, 0, 0]))
}

type Parsed<T> = { value: T; rest: Buffer } | 'incomplete' | { error: string; reply?: number }

function parseGreeting(buffer: Buffer): Parsed<boolean> {
  if (buffer.length < 2) return 'incomplete'
  if (buffer[0] !== VERSION) return { error: 'Only SOCKS5 clients are supported' }
  const end = 2 + buffer[1]
  if (buffer.length < end) return 'incomplete'
  return { value: buffer.subarray(2, end).includes(NO_AUTH), rest: buffer.subarray(end) }
}

function addressLength(buffer: Buffer): number | 'incomplete' | null {
  switch (buffer[3]) {
    case 1:
      return 4
    case 4:
      return 16
    case 3:
      return buffer.length < 5 ? 'incomplete' : 1 + buffer[4]
    default:
      return null
  }
}

function readHost(buffer: Buffer, length: number): string {
  const raw = buffer.subarray(4, 4 + length)
  if (buffer[3] === 1) return Array.from(raw).join('.')
  if (buffer[3] === 3) return raw.subarray(1).toString('utf8')
  const groups: string[] = []
  for (let i = 0; i < 16; i += 2) groups.push(raw.readUInt16BE(i).toString(16))
  return groups.join(':')
}

function parseRequest(buffer: Buffer): Parsed<SocksTarget> {
  if (buffer.length < 4) return 'incomplete'
  if (buffer[0] !== VERSION) return { error: 'Malformed SOCKS request' }
  if (buffer[1] !== CONNECT) return { error: 'Only SOCKS CONNECT is supported', reply: SOCKS_REPLY.commandNotSupported }
  const length = addressLength(buffer)
  if (length === null) return { error: 'Unsupported SOCKS address type', reply: SOCKS_REPLY.addressTypeNotSupported }
  if (length === 'incomplete' || buffer.length < 4 + length + 2) return 'incomplete'
  const host = readHost(buffer, length)
  const port = buffer.readUInt16BE(4 + length)
  return { value: { host, port }, rest: buffer.subarray(4 + length + 2) }
}

export function acceptSocks(socket: Socket): Promise<SocksTarget> {
  return new Promise((resolve, reject) => {
    let buffer: Buffer = Buffer.alloc(0)
    let greeted = false

    const detach = () => {
      socket.off('data', onData)
      socket.off('error', onEnd)
      socket.off('close', onEnd)
    }
    const fail = (error: string, reply?: number) => {
      detach()
      if (reply !== undefined) replySocks(socket, reply)
      socket.end()
      reject(new Error(error))
    }
    const onEnd = () => {
      detach()
      reject(new Error('SOCKS client closed the connection'))
    }

    const onData = (chunk: Buffer) => {
      buffer = Buffer.concat([buffer, chunk])
      if (!greeted) {
        const greeting = parseGreeting(buffer)
        if (greeting === 'incomplete') return
        if ('error' in greeting) return fail(greeting.error)
        if (!greeting.value) {
          socket.write(Buffer.from([VERSION, NO_ACCEPTABLE_METHOD]))
          return fail('SOCKS client needs authentication, which is not supported')
        }
        socket.write(Buffer.from([VERSION, NO_AUTH]))
        greeted = true
        buffer = greeting.rest
      }
      const request = parseRequest(buffer)
      if (request === 'incomplete') return
      if ('error' in request) return fail(request.error, request.reply)
      detach()
      socket.pause()
      if (request.rest.length > 0) socket.unshift(request.rest)
      resolve(request.value)
    }

    socket.on('data', onData)
    socket.on('error', onEnd)
    socket.on('close', onEnd)
  })
}
