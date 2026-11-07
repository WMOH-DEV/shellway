import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { OriginCert, SwitchLeftover } from '../../../../src/types/ssl'
import { backupGlob } from '../../../../src/utils/ssl/originCa/originPaths'
import { restoreIfChangedScript, undoScript } from '../../../../src/utils/ssl/originCa/scripts'
import { NOW, makeBlock, makeFacts, makeHost } from '../../../../src/utils/ssl/testReport'
import { blocksUsingLineage, readLeftover, undoRefusal } from './leftover'
import { runLineageRemoval, runUndo } from './undo'
import type { UndoDeps } from './undo'
import { BACKUP_PATH, CERT_PATH, FILE, KEY_PATH, NAMES, SITE, originCert, readyReport, recorder, switchedReport } from './testKit'
import type { Answer, Call } from './testKit'
import { nginxDriver } from '../../../../src/utils/webServer/nginx'

const NEWER = '/etc/ssl/shellway/backups/app.example.com-1800005000.conf'
const SAVE = '/etc/ssl/shellway/backups/undone/app.example.com-1800000000.conf'
const SWITCH = 'sudo -n timeout -k 10 60 sh -s'
const lister = (stdout: string, backupText = SITE) => (call: Call): Answer | undefined => {
  if (call.stdin?.includes(backupGlob('app.example.com'))) return { code: 0, stdout }
  if (call.command.startsWith("sudo -n cat '/etc/ssl/shellway/backups/")) return { code: 0, stdout: backupText }
  return undefined
}

describe('readLeftover', () => {
  it('finds the newest backup and says the switch can be undone while the old certificate is valid', async () => {
    const { exec, calls } = recorder(lister(`${BACKUP_PATH}\n${NEWER}\n`))
    const leftover = await readLeftover(exec, switchedReport(), 'www.example.com', NOW)

    expect(leftover).toEqual({ name: 'www.example.com', blockId: 'app.conf:9', lineage: 'app.example.com', lineageShared: false, backupPath: NEWER, undoable: true })
    expect(calls[0].command).toBe('sudo -n sh -s')
  })

  it('is null for a site that is not on an Origin CA certificate that Shellway wrote', async () => {
    const { exec, calls } = recorder(lister(BACKUP_PATH))
    expect(await readLeftover(exec, readyReport(), 'app.example.com', NOW)).toBeNull()
    expect(await readLeftover(exec, switchedReport(), 'other.example.com', NOW)).toBeNull()
    const foreign = switchedReport()
    foreign.blocks = [makeBlock({ names: NAMES, certPath: '/etc/ssl/private/manual.pem', keyPath: '/etc/ssl/private/manual.key' })]
    expect(await readLeftover(exec, foreign, 'app.example.com', NOW)).toBeNull()
    expect(calls).toEqual([])
  })

  it('takes the certbot certificate from the backup, not from which names it covers', async () => {
    const report = switchedReport()
    report.hostnames = NAMES.map((name) => makeHost({ name, origin: originCert(), lineage: 'wide.example.com' }))
    report.lineages = [{ ...report.lineages[0], name: 'wide.example.com' }, ...report.lineages]
    const leftover = await readLeftover(recorder(lister(BACKUP_PATH)).exec, report, 'app.example.com', NOW)
    expect(leftover).toMatchObject({ lineage: 'app.example.com', backupPath: BACKUP_PATH, undoable: true })
  })

  it('uses the covering certificate only when there is no backup, and is null when none covers it', async () => {
    const report = switchedReport()
    report.hostnames = NAMES.map((name) => makeHost({ name, origin: originCert(), lineage: 'app.example.com' }))
    expect(await readLeftover(recorder(lister('')).exec, report, 'app.example.com', NOW)).toMatchObject({ lineage: 'app.example.com', backupPath: null })
    report.hostnames = NAMES.map((name) => makeHost({ name, origin: originCert(), lineage: null }))
    expect(await readLeftover(recorder(lister('')).exec, report, 'app.example.com', NOW)).toBeNull()
  })

  it('is null when the backup does not describe this site or does not point at a certbot certificate', async () => {
    const otherSite = SITE.replace('server_name app.example.com www.example.com', 'server_name other.example.com')
    expect(await readLeftover(recorder(lister(BACKUP_PATH, otherSite)).exec, switchedReport(), 'app.example.com', NOW)).toBeNull()
    const manual = SITE.replace(/\/etc\/letsencrypt\/live\/app.example.com\//g, '/etc/ssl/private/')
    expect(await readLeftover(recorder(lister(BACKUP_PATH, manual)).exec, switchedReport(), 'app.example.com', NOW)).toBeNull()
    expect(await readLeftover(recorder(lister(BACKUP_PATH, '')).exec, switchedReport(), 'app.example.com', NOW)).toBeNull()
  })

  it('cannot undo without a backup or once the certbot certificate has expired', async () => {
    const none = await readLeftover(recorder(lister('')).exec, switchedReport(), 'app.example.com', NOW)
    expect(none).toMatchObject({ backupPath: null, undoable: false })
    const expired = await readLeftover(recorder(lister(BACKUP_PATH)).exec, switchedReport(-1), 'app.example.com', NOW)
    expect(expired).toMatchObject({ backupPath: BACKUP_PATH, undoable: false })
    const unknownExpiry = switchedReport()
    unknownExpiry.lineages[0].notAfter = null
    expect(await readLeftover(recorder(lister(BACKUP_PATH)).exec, unknownExpiry, 'app.example.com', NOW)).toMatchObject({ undoable: false })
  })

  it('ignores listing lines that are not exactly this site\'s backups', async () => {
    const stray = '/etc/ssl/shellway/backups/app.example.com-1.example.net-1800099999.conf'
    expect(await readLeftover(recorder(lister(stray)).exec, switchedReport(), 'app.example.com', NOW)).toMatchObject({ backupPath: null })
  })

  it('treats a failed listing as no backup', async () => {
    const { exec } = recorder(() => ({ code: 1 }))
    expect(await readLeftover(exec, switchedReport(), 'app.example.com', NOW)).toMatchObject({ backupPath: null, undoable: false })
  })

  it('marks the lineage shared when another site still points at it', async () => {
    const report = switchedReport()
    report.blocks.push(makeBlock({ id: 'api.conf:3', names: ['api.example.com'], certPath: '/etc/letsencrypt/live/app.example.com/fullchain.pem' }))
    const leftover = await readLeftover(recorder(lister(BACKUP_PATH)).exec, report, 'app.example.com', NOW)
    expect(leftover?.lineageShared).toBe(true)
  })

  it('treats the certbot certificate as shared when nginx was not fully read', async () => {
    for (const nginxParse of ['partial', 'unavailable'] as const) {
      const report = switchedReport()
      report.facts = makeFacts({ nginxParse, sudo: { certbot: true, nginx: true, full: true } })
      const leftover = await readLeftover(recorder(lister(BACKUP_PATH)).exec, report, 'app.example.com', NOW)
      expect(leftover?.lineageShared).toBe(true)
    }
  })
})

describe('undoRefusal', () => {
  const ok: SwitchLeftover = { name: 'app.example.com', blockId: 'app.conf:9', lineage: 'app.example.com', lineageShared: false, backupPath: BACKUP_PATH, undoable: true }

  it('explains each reason', () => {
    expect(undoRefusal(ok)).toBeNull()
    expect(undoRefusal(null)).toMatch(/not using a Cloudflare Origin CA certificate/)
    expect(undoRefusal({ ...ok, backupPath: null, undoable: false })).toMatch(/backup .* is gone/)
    expect(undoRefusal({ ...ok, undoable: false })).toMatch(/has expired/)
  })
})

describe('blocksUsingLineage', () => {
  it('matches only the lineage\'s own live directory', () => {
    const blocks = [
      makeBlock({ id: 'a', certPath: '/etc/letsencrypt/live/app.example.com/fullchain.pem' }),
      makeBlock({ id: 'b', certPath: '', keyPath: '/etc/letsencrypt/live/app.example.com/privkey.pem' }),
      makeBlock({ id: 'c', certPath: '/etc/letsencrypt/live/app.example.com-0001/fullchain.pem', keyPath: '/etc/letsencrypt/live/app.example.com-0001/privkey.pem' }),
      makeBlock({ id: 'd', certPath: CERT_PATH, keyPath: KEY_PATH })
    ]
    expect(blocksUsingLineage(blocks, 'app.example.com').map((b) => b.id)).toEqual(['a', 'b'])
  })
})

describe('runUndo', () => {
  let probe: ReturnType<typeof vi.fn>
  let sleep: ReturnType<typeof vi.fn>
  const leftover: SwitchLeftover = { name: 'app.example.com', blockId: 'app.conf:9', lineage: 'app.example.com', lineageShared: false, backupPath: BACKUP_PATH, undoable: true }
  const SCRIPT = undoScript({ driver: nginxDriver, file: FILE, backupPath: BACKUP_PATH, savePath: SAVE })
  const served = (kind: OriginCert['kind']) => async () => Object.fromEntries(NAMES.map((name) => [name, originCert(kind)]))

  beforeEach(() => {
    probe = vi.fn(served('letsencrypt'))
    sleep = vi.fn(async () => {})
  })

  const undo = (responder: (call: Call) => Answer | undefined = () => undefined) => {
    const rec = recorder(responder)
    const deps: UndoDeps = { exec: rec.exec, onOutput: rec.onOutput, probe, httpGet: async () => ({ status: 200 }), sleep, now: () => 1_800_000_000_000 }
    return { rec, done: runUndo(deps, { driver: nginxDriver, file: FILE, names: NAMES, prefix: 'app.example.com', leftover }) }
  }

  it('restores the backup in one root exec and checks the server no longer serves the Origin CA certificate', async () => {
    const { rec, done } = undo()
    const result = await done

    expect(rec.calls).toEqual([{ command: SWITCH, stdin: SCRIPT }])
    expect(result).toMatchObject({ ok: true, failedStage: null, restored: false, backupPath: BACKUP_PATH })
    expect(result.verify.map((v) => v.served?.kind)).toEqual(['letsencrypt', 'letsencrypt'])
  })

  it('reports a failed nginx test as put back by the script', async () => {
    const result = await undo((call) => (call.stdin === SCRIPT ? { code: 4 } : undefined)).done
    expect(result).toMatchObject({ ok: false, failedStage: 'nginx-test', restored: true })
    expect(probe).not.toHaveBeenCalled()
  })

  it('reports a missing backup without verifying', async () => {
    const result = await undo((call) => (call.stdin === SCRIPT ? { code: 3 } : undefined)).done
    expect(result).toMatchObject({ ok: false, failedStage: 'apply', restored: false })
    expect(probe).not.toHaveBeenCalled()
  })

  it('fails the verification when the server still serves the Origin CA certificate', async () => {
    probe.mockImplementation(served('cloudflare-origin'))
    const result = await undo().done
    expect(result).toMatchObject({ ok: false, failedStage: 'verify' })
    expect(result.output).toContain('still serving')
  })

  describe('when the script stops part-way', () => {
    const SETTLE = restoreIfChangedScript({ driver: nginxDriver, file: FILE, backupPath: SAVE })
    const dropped = (settle: Answer | undefined) => (call: Call): Answer | undefined => {
      if (call.stdin === SCRIPT) return new Error('SSH connection is not active')
      return call.stdin === SETTLE ? settle : undefined
    }

    it('puts the version from before the undo back when the file was already changed', async () => {
      const { rec, done } = undo(dropped({ code: 6 }))
      const result = await done
      expect(rec.calls.map((c) => c.stdin)).toEqual([SCRIPT, SETTLE])
      expect(result).toMatchObject({ ok: false, failedStage: 'apply', restored: true })
      expect(probe).not.toHaveBeenCalled()
    })

    it('says nothing was restored when the file was never changed', async () => {
      const result = await undo(dropped({ code: 0 })).done
      expect(result).toMatchObject({ ok: false, failedStage: 'apply', restored: false })
    })

    it('settles after a timeout or a failing step too', async () => {
      for (const code of [1, 124, 137]) {
        const { rec, done } = undo((call) => (call.stdin === SCRIPT ? { code } : call.stdin === SETTLE ? { code: 6 } : undefined))
        expect(await done).toMatchObject({ failedStage: 'apply', restored: true })
        expect(rec.calls).toHaveLength(2)
      }
    })

    it('names the saved copy when even the check cannot be confirmed', async () => {
      const result = await undo(dropped(new Error('SSH connection is not active'))).done
      expect(result).toMatchObject({ ok: false, failedStage: 'apply', restored: false })
      expect(result.output).toContain(SAVE)
    })
  })
})

describe('runLineageRemoval', () => {
  it('deletes only the named certbot certificate, non-interactively, with a remote time limit', async () => {
    const { exec, calls, onOutput } = recorder(() => ({ code: 0, output: 'Deleted all files relating to certificate app.example.com.\n' }))
    const result = await runLineageRemoval(exec, 'app.example.com', onOutput)

    expect(calls.map((c) => c.command)).toEqual(['sudo -n timeout -k 10 90 certbot delete --cert-name app.example.com --non-interactive'])
    expect(result.code).toBe(0)
    expect(result.output).toContain('Deleted all files')
  })

  it('returns a failing code when certbot or the connection fails', async () => {
    expect((await runLineageRemoval(recorder(() => ({ code: 1 })).exec, 'app.example.com', () => {})).code).toBe(1)
    expect((await runLineageRemoval(recorder(() => new Error('down')).exec, 'app.example.com', () => {})).code).toBe(1)
  })
})
