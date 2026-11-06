import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { OriginCert, SwitchPrepared } from '../../../../src/types/ssl'
import { restoreIfChangedScript, restoreScript } from '../../../../src/utils/ssl/originCa/scripts'
import { runApply } from './apply'
import type { ApplyDeps } from './apply'
import { BACKUP_PATH, CERT_PATH, FILE, KEY_PATH, NAMES, originCert, recorder } from './testKit'
import type { Answer, Call } from './testKit'

const SCRIPT = 'set -e\necho reviewed script\n'
const SWITCH = 'sudo -n timeout -k 10 60 sh -s'
const REMOVE = `sudo -n rm -f '${KEY_PATH}' '${CERT_PATH}'`
const RESTORE = restoreScript({ file: FILE, backupPath: BACKUP_PATH })
const SETTLE = restoreIfChangedScript({ file: FILE, backupPath: BACKUP_PATH })

const prepared: SwitchPrepared = {
  switchId: 'switch-1', blockId: 'app.conf:9', file: FILE, blockLine: 9, names: NAMES, certPath: CERT_PATH, keyPath: KEY_PATH,
  keyType: 'ecc', validityYears: 15, notAfter: 2_300_000_000, backupPath: BACKUP_PATH, diff: [], script: SCRIPT
}

let probe: ReturnType<typeof vi.fn>
let httpGet: ReturnType<typeof vi.fn>
let sleep: ReturnType<typeof vi.fn>

const served = (kind: OriginCert['kind']) => async () => Object.fromEntries(NAMES.map((name) => [name, originCert(kind)]))

beforeEach(() => {
  probe = vi.fn(served('cloudflare-origin'))
  httpGet = vi.fn(async () => ({ status: 200 }))
  sleep = vi.fn(async () => {})
})

const apply = (responder: (call: Call) => Answer | undefined = () => undefined) => {
  const rec = recorder(responder)
  const deps: ApplyDeps = { exec: rec.exec, onOutput: rec.onOutput, probe, httpGet, sleep }
  return { rec, done: runApply(deps, prepared) }
}

const scriptExit = (code: number) => (call: Call): Answer | undefined => (call.stdin === SCRIPT ? { code } : undefined)

describe('runApply', () => {
  it('runs the reviewed script in one root exec, then checks the served certificate and the HTTPS answer for every name', async () => {
    const { rec, done } = apply()
    const result = await done

    expect(rec.calls).toEqual([{ command: SWITCH, stdin: SCRIPT }])
    expect(probe).toHaveBeenCalledWith(NAMES)
    expect(httpGet.mock.calls.map((c) => c[0])).toEqual(['https://app.example.com/', 'https://www.example.com/'])
    expect(result).toMatchObject({ ok: true, failedStage: null, restored: false, backupPath: BACKUP_PATH })
    expect(result.verify.map((v) => [v.name, v.served?.kind, v.https.state])).toEqual([['app.example.com', 'cloudflare-origin', 'ok'], ['www.example.com', 'cloudflare-origin', 'ok']])
  })

  it('streams every command it runs', async () => {
    const { rec, done } = apply((call) => (call.stdin === SCRIPT ? { code: 0, output: 'nginx: configuration file test is successful\n' } : undefined))
    await done
    expect(rec.streamed.join('')).toContain('nginx: configuration file test is successful')
  })

  it('refuses when the file changed since review: nothing written, key and certificate removed, no verification', async () => {
    const { rec, done } = apply(scriptExit(3))
    const result = await done

    expect(rec.calls.map((c) => c.command)).toEqual([SWITCH, REMOVE])
    expect(result).toMatchObject({ ok: false, failedStage: 'apply', restored: false, backupPath: null })
    expect(probe).not.toHaveBeenCalled()
    expect(httpGet).not.toHaveBeenCalled()
  })

  it('reports an nginx test failure as restored by the script', async () => {
    const { rec, done } = apply(scriptExit(4))
    const result = await done

    expect(rec.calls.map((c) => c.command)).toEqual([SWITCH, REMOVE])
    expect(result).toMatchObject({ ok: false, failedStage: 'nginx-test', restored: true, backupPath: BACKUP_PATH })
    expect(probe).not.toHaveBeenCalled()
  })

  it('reports a failed reload as restored by the script', async () => {
    const result = await apply(scriptExit(5)).done
    expect(result).toMatchObject({ ok: false, failedStage: 'apply', restored: true })
  })

  it('restores the backup, tests and reloads when the server still serves the old certificate', async () => {
    probe.mockImplementation(served('letsencrypt'))
    const { rec, done } = apply()
    const result = await done

    expect(rec.calls).toEqual([{ command: SWITCH, stdin: SCRIPT }, { command: SWITCH, stdin: RESTORE }, { command: REMOVE, stdin: undefined }])
    expect(result).toMatchObject({ ok: false, failedStage: 'verify', restored: true, backupPath: BACKUP_PATH })
    expect(probe).toHaveBeenCalledTimes(3)
    expect(sleep).toHaveBeenCalledTimes(2)
    expect(result.output).toContain('app.example.com is not serving the new Cloudflare Origin CA certificate.')
  })

  it('waits for nginx to pick up the certificate instead of failing on the first probe', async () => {
    probe.mockImplementationOnce(served('letsencrypt'))
    const { rec, done } = apply()
    const result = await done
    expect(result.ok).toBe(true)
    expect(probe).toHaveBeenCalledTimes(2)
    expect(rec.calls).toHaveLength(1)
  })

  it.each([525, 526])('restores when the PC gets a %i from Cloudflare', async (status) => {
    httpGet.mockResolvedValue({ status })
    const { rec, done } = apply()
    const result = await done

    expect(rec.calls.map((c) => c.stdin)).toEqual([SCRIPT, RESTORE, undefined])
    expect(result).toMatchObject({ ok: false, failedStage: 'verify', restored: true })
    expect(result.output).toContain(`(${status})`)
  })

  it('does not blame the new certificate for an application error or for a PC that cannot connect', async () => {
    httpGet.mockResolvedValueOnce({ status: 502 }).mockRejectedValueOnce(new Error('getaddrinfo ENOTFOUND'))
    const result = await apply().done
    expect(result.ok).toBe(true)
    expect(result.verify.map((v) => v.https.state)).toEqual(['ok', 'unknown'])
  })

  it('keeps the key and says so when the restore itself fails', async () => {
    probe.mockImplementation(served('letsencrypt'))
    const { rec, done } = apply((call) => (call.stdin === RESTORE ? { code: 1 } : undefined))
    const result = await done

    expect(result).toMatchObject({ ok: false, failedStage: 'verify', restored: false, backupPath: BACKUP_PATH })
    expect(rec.calls.map((c) => c.command)).not.toContain(REMOVE)
  })

  it('puts the original back after a dropped connection if the file was changed', async () => {
    const { rec, done } = apply((call) => {
      if (call.stdin === SCRIPT) return new Error('SSH connection is not active')
      return call.stdin === SETTLE ? { code: 6 } : undefined
    })
    const result = await done

    expect(rec.calls.filter((c) => c.stdin === SCRIPT)).toHaveLength(1)
    expect(result).toMatchObject({ ok: false, failedStage: 'apply', restored: true })
    expect(probe).not.toHaveBeenCalled()
  })

  it('reports an unknown state when the connection stays down', async () => {
    const { rec, done } = apply((call) => (call.stdin === SCRIPT || call.stdin === SETTLE ? new Error('SSH connection is not active') : undefined))
    const result = await done

    expect(result).toMatchObject({ ok: false, failedStage: 'apply', restored: false, backupPath: BACKUP_PATH })
    expect(result.output).toContain(`Could not confirm the state of ${FILE}`)
    expect(rec.calls.map((c) => c.command)).not.toContain(REMOVE)
  })

  it('treats a timeout kill with an untouched file as unchanged', async () => {
    const { rec, done } = apply((call) => (call.stdin === SCRIPT ? { code: 124 } : undefined))
    const result = await done
    expect(result).toMatchObject({ ok: false, failedStage: 'apply', restored: false, backupPath: null })
    expect(rec.calls.map((c) => c.command)).toContain(REMOVE)
  })
})
