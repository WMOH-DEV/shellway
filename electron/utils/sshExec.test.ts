import { EventEmitter } from 'events'
import { describe, expect, it, vi } from 'vitest'
import type { SSHConnection } from '../services/SSHService'
import { ExecAbortedError, sshExec } from './sshExec'

function fakeStream() {
  const stream: any = new EventEmitter()
  stream.stderr = new EventEmitter()
  stream.writable = true
  stream.delivered = []
  stream.end = vi.fn(() => {
    stream.writable = false
  })
  stream.destroy = vi.fn()
  stream.signal = vi.fn((name: string) => {
    if (stream.writable) stream.delivered.push(name)
  })
  return stream
}

function fakeConnection(onExec?: (stream: any) => void) {
  const stream = fakeStream()
  const exec = vi.fn((_command: string, callback: (err: Error | undefined, stream: any) => void) => {
    callback(undefined, stream)
    onExec?.(stream)
  })
  const conn = { status: 'connected', _client: { exec } } as unknown as SSHConnection
  return { conn, exec, stream }
}

describe('sshExec abort signal', () => {
  it('rejects without running the command when already aborted', async () => {
    const { conn, exec } = fakeConnection()
    const controller = new AbortController()
    controller.abort()
    await expect(sshExec(conn, 'ls', { signal: controller.signal })).rejects.toBeInstanceOf(ExecAbortedError)
    expect(exec).not.toHaveBeenCalled()
  })

  it('destroys the stream and rejects when aborted mid-run', async () => {
    const { conn, stream } = fakeConnection()
    const controller = new AbortController()
    const pending = sshExec(conn, 'ls', { signal: controller.signal })
    stream.emit('data', Buffer.from('partial'))
    controller.abort()
    await expect(pending).rejects.toBeInstanceOf(ExecAbortedError)
    expect(stream.delivered).toEqual(['TERM'])
    expect(stream.destroy).toHaveBeenCalledTimes(1)
  })

  it('ignores output and close after the abort', async () => {
    const { conn, stream } = fakeConnection()
    const controller = new AbortController()
    const pending = sshExec(conn, 'ls', { signal: controller.signal })
    controller.abort()
    stream.emit('close', 0)
    await expect(pending).rejects.toBeInstanceOf(ExecAbortedError)
    expect(stream.destroy).toHaveBeenCalledTimes(1)
  })

  it('stops listening to the signal once the command finished', async () => {
    const { conn, stream } = fakeConnection()
    const controller = new AbortController()
    const pending = sshExec(conn, 'ls', { signal: controller.signal })
    stream.emit('data', Buffer.from('done'))
    stream.emit('close', 0)
    await expect(pending).resolves.toMatchObject({ stdout: 'done', code: 0 })
    controller.abort()
    expect(stream.destroy).not.toHaveBeenCalled()
  })

  it('stops a command whose signal was aborted while the exec was starting', async () => {
    const controller = new AbortController()
    const { conn, stream } = fakeConnection(() => controller.abort())
    await expect(sshExec(conn, 'ls', { signal: controller.signal })).rejects.toBeInstanceOf(ExecAbortedError)
    expect(stream.destroy).toHaveBeenCalledTimes(1)
  })

  it('behaves as before without a signal', async () => {
    const { conn, stream } = fakeConnection()
    const pending = sshExec(conn, 'ls')
    expect(stream.end).toHaveBeenCalledTimes(1)
    stream.emit('data', Buffer.from('ok'))
    stream.emit('close', 0)
    await expect(pending).resolves.toMatchObject({ stdout: 'ok', code: 0 })
  })

  it('still sends given stdin to a cancellable command', async () => {
    const { conn, stream } = fakeConnection()
    const pending = sshExec(conn, 'cat', { stdin: 'hello', signal: new AbortController().signal })
    expect(stream.end).toHaveBeenCalledWith('hello')
    stream.emit('close', 0)
    await expect(pending).resolves.toMatchObject({ code: 0 })
  })
})
