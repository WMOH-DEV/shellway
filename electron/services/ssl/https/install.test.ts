import { readFileSync } from 'fs'
import { join } from 'path'
import { describe, expect, it } from 'vitest'
import { installPlan, installScript } from '../../../../src/utils/ssl/https/installPlan'
import type { ExecOptions } from '../../../utils/sshExec'
import type { RemoteExec } from '../../deploy/DeployService'
import { runInstall } from './install'
import { parsePrepFacts, PATH_LINE } from './prepFacts'

const fixture = (name: string) => readFileSync(join(__dirname, 'fixtures', name), 'utf8')

interface Call {
  command: string
  options: ExecOptions | undefined
}

function fakeExec(prep: string, installCode = 0): { exec: RemoteExec; calls: Call[] } {
  const calls: Call[] = []
  const exec: RemoteExec = async (command, options) => {
    calls.push({ command, options })
    if (command === 'sh -s') return { stdout: prep, stdoutBytes: 0, stderr: '', code: 0 }
    options?.onOutput?.('Setting up certbot\n')
    return { stdout: '', stdoutBytes: 0, stderr: '', code: installCode }
  }
  return { exec, calls }
}

describe('runInstall', () => {
  it('rebuilds the plan from a fresh detection and runs it as one sudo script', async () => {
    const prep = fixture('prep-debian12-no-snapd.txt')
    const { exec, calls } = fakeExec(prep)
    const chunks: string[] = []

    const result = await runInstall(exec, 'distro', (chunk) => chunks.push(chunk))

    const script = installScript(installPlan(parsePrepFacts(prep), 'distro'))
    expect(calls.map((c) => c.command)).toEqual(['sh -s', 'sudo -n sh -s'])
    const install = calls[1].options
    expect(install?.timeoutMs).toBe(15 * 60_000)
    expect(install?.stdin).toContain(PATH_LINE)
    expect(install?.stdin).toContain(script)
    expect(script).toContain('apt-get update')
    expect(result).toEqual({ code: 0, output: 'Setting up certbot\n' })
    expect(chunks).toEqual(['Setting up certbot\n'])
  })

  it('returns the exit code of a failed install without retrying', async () => {
    const { exec, calls } = fakeExec(fixture('prep-debian12-no-snapd.txt'), 100)
    await expect(runInstall(exec, 'distro', () => {})).resolves.toMatchObject({ code: 100 })
    expect(calls.filter((c) => c.command === 'sudo -n sh -s')).toHaveLength(1)
  })

  it('refuses without full passwordless sudo and runs nothing', async () => {
    const { exec, calls } = fakeExec(fixture('prep-ubuntu-no-sudo.txt'))
    await expect(runInstall(exec, 'distro', () => {})).rejects.toThrow('Installing needs passwordless sudo. Run these commands yourself, then Check again.')
    expect(calls.map((c) => c.command)).toEqual(['sh -s'])
  })

  it('refuses a route the server cannot use', async () => {
    const { exec, calls } = fakeExec(fixture('prep-debian12-no-snapd.txt'))
    await expect(runInstall(exec, 'snap', () => {})).rejects.toThrow('The snap route is not available on this server.')
    expect(calls).toHaveLength(1)
  })

  it('refuses systems the plan cannot cover', async () => {
    const { exec, calls } = fakeExec(fixture('prep-alpine.txt'))
    await expect(runInstall(exec, 'snap', () => {})).rejects.toThrow(/no install commands for Alpine Linux v3.19/)
    expect(calls).toHaveLength(1)
  })
})
