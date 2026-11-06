import type { RemoteExec } from '../../deploy/DeployService'
import type { OutputSink } from '../SslService'
import { teeOutput } from '../https/teeOutput'
import type { OutputLog } from '../https/teeOutput'

export const SHORT_TIMEOUT_MS = 30_000
export const SCRIPT_LIMIT_S = 60
export const SCRIPT_TIMEOUT_MS = 90_000
export const SUDO_SCRIPT = `sudo -n timeout -k 10 ${SCRIPT_LIMIT_S} sh -s`
export const SUDO_SHELL = 'sudo -n sh -s'

export interface RunOutcome {
  code: number | null
  stdout: string
}

export interface RunOptions {
  stdin?: string
  shown?: string
  stream?: boolean
}

export class RemoteRunner {
  readonly log: OutputLog

  constructor(private readonly exec: RemoteExec, onOutput: OutputSink) {
    this.log = teeOutput(onOutput)
  }

  note(text: string): void {
    this.log.write(`${text}\n`)
  }

  async run(command: string, timeoutMs: number, { stdin, shown = command, stream = true }: RunOptions = {}): Promise<RunOutcome> {
    this.note(`$ ${shown}`)
    try {
      const result = await this.exec(command, { timeoutMs, stdin, onOutput: stream ? this.log.write : undefined })
      if (!stream && result.stderr) this.log.write(result.stderr)
      return { code: result.code, stdout: result.stdout }
    } catch (err) {
      this.note((err as Error).message)
      return { code: null, stdout: '' }
    }
  }
}
