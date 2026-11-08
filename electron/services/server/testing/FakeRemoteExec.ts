import type { ExecOptions, ExecResult } from '../../../utils/sshExec'
import type { RemoteExec } from '../../deploy/DeployService'

export interface FakeCall {
  command: string
  stdin: string | null
  timeoutMs: number | undefined
}

export type FakeReply = Partial<ExecResult> | Error

export type FakeAnswer = FakeReply | Promise<FakeReply>

export type FakeResponder = (call: FakeCall) => FakeAnswer | undefined

const stdinText = (stdin: ExecOptions['stdin']): string | null =>
  stdin === undefined ? null : typeof stdin === 'string' ? stdin : Buffer.isBuffer(stdin) ? stdin.toString('utf8') : '[stream]'

export class FakeRemoteExec {
  readonly calls: FakeCall[] = []
  private readonly responders: FakeResponder[] = []

  on(match: string | RegExp | ((call: FakeCall) => boolean), reply: FakeReply | ((call: FakeCall) => FakeAnswer)): this {
    const test = typeof match === 'function' ? match : (call: FakeCall) => (typeof match === 'string' ? call.command.includes(match) || (call.stdin ?? '').includes(match) : match.test(call.command) || match.test(call.stdin ?? ''))
    this.responders.push((call) => (test(call) ? (typeof reply === 'function' ? reply(call) : reply) : undefined))
    return this
  }

  private answer(call: FakeCall): FakeAnswer | undefined {
    for (const respond of this.responders) {
      const answer = respond(call)
      if (answer !== undefined) return answer
    }
    return undefined
  }

  readonly exec: RemoteExec = async (command, options = {}) => {
    const call: FakeCall = { command, stdin: stdinText(options.stdin), timeoutMs: options.timeoutMs }
    this.calls.push(call)
    const reply = (await this.answer(call)) ?? {}
    if (reply instanceof Error) throw reply
    const stdout = reply.stdout ?? ''
    if (stdout) options.onOutput?.(stdout)
    if (reply.stderr) options.onOutput?.(reply.stderr)
    return { stdout, stdoutBytes: Buffer.byteLength(stdout), stderr: reply.stderr ?? '', code: reply.code ?? 0 }
  }
}
