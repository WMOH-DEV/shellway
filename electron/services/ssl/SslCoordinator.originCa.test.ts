import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { OriginCert, ServerBlock, SslReport, SwitchRequest } from '../../../src/types/ssl'
import { makeBlock, makeFacts } from '../../../src/utils/ssl/testReport'
import { SslCoordinator } from './SslCoordinator'
import type { SslLocalStore } from './SslLocalStore'
import type { SslService } from './SslService'
import { BACKUP_PATH, CERT_PATH, CSR, FILE, KEY_PATH, NAMES, PEM, SITE, originCert, readyReport, recorder, switchedReport } from './originCa/testKit'
import type { Answer, Call } from './originCa/testKit'

const request: SwitchRequest = { blockId: 'app.conf:9', keyType: 'ecc', validityYears: 15 }
const REMOVE = `sudo -n rm -f '${KEY_PATH}' '${CERT_PATH}'`

let rec: ReturnType<typeof recorder>
let createOriginCert: ReturnType<typeof vi.fn>
let config: { facts: ReturnType<typeof makeFacts>; blocks: ServerBlock[] }
let probed: OriginCert['kind']
let token: string | null
let broadcast: ReturnType<typeof vi.fn>
let ssl: SslCoordinator

const responder = (call: Call): Answer | undefined => {
  if (call.stdin?.includes('openssl req')) return { code: 0, stdout: CSR }
  if (call.command === `sudo -n cat '${FILE}'`) return { code: 0, stdout: SITE }
  if (call.stdin?.includes('for f in')) return { code: 0, stdout: `${BACKUP_PATH}\n` }
  return undefined
}

function build(answer = responder): void {
  rec = recorder(answer)
  createOriginCert = vi.fn(async () => ({ certificate: PEM, notAfter: 2_300_000_000 }))
  config = { facts: makeFacts({ sudo: { certbot: true, nginx: true, full: true } }), blocks: [] }
  broadcast = vi.fn()
  const store = { cloudflareToken: () => token } as unknown as SslLocalStore
  const service = {
    readConfig: async () => config,
    probeNames: async (names: string[]) => Object.fromEntries(names.map((name) => [name, originCert(probed)]))
  } as unknown as SslService
  ssl = new SslCoordinator({
    execFor: (id) => (id === 'c1' || id === 'c2' ? rec.exec : null),
    store,
    cloudflare: () => ({ createOriginCert }) as never,
    serviceFor: () => service,
    httpGet: async () => ({ status: 200 }),
    newId: (() => { let n = 0; return () => `switch-${++n}` })(),
    sleep: async () => {},
    broadcast,
    notify: vi.fn(),
    now: () => 1_800_000_000_000
  })
}

const reportIs = (report: SslReport) => vi.spyOn(ssl, 'check').mockResolvedValue(report)

beforeEach(() => {
  probed = 'cloudflare-origin'
  token = 'token'
  build()
})

describe('SslCoordinator Origin CA switch', () => {
  it('prepares, applies once, and refreshes the report afterwards', async () => {
    const check = reportIs(readyReport())

    const prepared = await ssl.originPrepare('c1', 's1', request, 'run-1')
    expect(prepared).toMatchObject({ switchId: 'switch-1', certPath: CERT_PATH, keyPath: KEY_PATH })
    const result = await ssl.originApply('c1', 's1', 'switch-1', 'run-2')

    expect(result.ok).toBe(true)
    expect(check).toHaveBeenCalledTimes(2)
    expect(rec.calls.filter((c) => c.stdin === prepared.script)).toHaveLength(1)
    expect(broadcast).toHaveBeenCalledWith('ssl:output', 'run-2', expect.any(String))
    await expect(ssl.originApply('c1', 's1', 'switch-1', 'run-3')).rejects.toThrow('no longer prepared')
  })

  it('refuses to apply a switch prepared on another connection', async () => {
    reportIs(readyReport())
    await ssl.originPrepare('c1', 's1', request, 'run-1')
    await expect(ssl.originApply('c2', 's1', 'switch-1', 'run-2')).rejects.toThrow('no longer prepared')
    expect(rec.calls.filter((c) => c.command.includes('timeout'))).toEqual([])
  })

  it('forgets prepared switches when the connection closes', async () => {
    reportIs(readyReport())
    await ssl.originPrepare('c1', 's1', request, 'run-1')
    ssl.forget('c1')
    await expect(ssl.originApply('c1', 's1', 'switch-1', 'run-2')).rejects.toThrow('no longer prepared')
  })

  it('needs a Cloudflare token to prepare', async () => {
    reportIs(readyReport())
    token = null
    await expect(ssl.originPrepare('c1', 's1', request, 'run-1')).rejects.toThrow('Add a Cloudflare token first.')
    expect(rec.calls).toEqual([])
  })

  it('cancel removes the unused key and certificate and drops the switch', async () => {
    reportIs(readyReport())
    await ssl.originPrepare('c1', 's1', request, 'run-1')
    await ssl.originCancel('c1', 'switch-1')

    expect(rec.calls.at(-1)?.command).toBe(REMOVE)
    await expect(ssl.originApply('c1', 's1', 'switch-1', 'run-2')).rejects.toThrow('no longer prepared')
    await expect(ssl.originCancel('c1', 'switch-1')).rejects.toThrow('no longer prepared')
  })

  it('removes the key when Cloudflare says no during prepare', async () => {
    reportIs(readyReport())
    createOriginCert.mockRejectedValueOnce(new Error('Cloudflare refused to create the certificate.'))
    await expect(ssl.originPrepare('c1', 's1', request, 'run-1')).rejects.toThrow('Cloudflare refused')
    expect(rec.calls.at(-1)?.command).toBe(REMOVE)
  })

  it('runs one task at a time per server', async () => {
    reportIs(readyReport())
    let release: () => void = () => {}
    const gate = new Promise<void>((resolve) => { release = resolve })
    createOriginCert.mockImplementationOnce(async () => { await gate; return { certificate: PEM, notAfter: null } })

    const first = ssl.originPrepare('c1', 's1', request, 'run-1')
    await vi.waitFor(() => expect(createOriginCert).toHaveBeenCalled())
    await expect(ssl.originPrepare('c1', 's1', request, 'run-2')).rejects.toThrow('already running')
    await expect(ssl.originCancel('c1', 'switch-1')).rejects.toThrow('already running')
    release()
    await first
  })

  it('offers undo information only for a site that was switched', async () => {
    expect(await ssl.originLeftover('c1', 'app.example.com')).toBeNull()
    vi.spyOn(ssl, 'lastReport').mockReturnValue(switchedReport())
    expect(await ssl.originLeftover('c1', 'app.example.com')).toMatchObject({ lineage: 'app.example.com', backupPath: BACKUP_PATH, undoable: true })
  })

  it('refuses to undo a site that is not on an Origin CA certificate, without touching the file', async () => {
    reportIs(readyReport())
    await expect(ssl.originUndo('c1', 's1', 'app.example.com', 'run-1')).rejects.toThrow('not using a Cloudflare Origin CA certificate')
    expect(rec.calls).toEqual([])
  })

  it('refuses to undo when the backup is gone or the old certificate expired', async () => {
    reportIs(switchedReport())
    build((call) => (call.stdin?.includes('for f in') ? { code: 0, stdout: '' } : undefined))
    reportIs(switchedReport())
    await expect(ssl.originUndo('c1', 's1', 'app.example.com', 'run-1')).rejects.toThrow('backup of the original site file is gone')
    build()
    reportIs(switchedReport(-1))
    await expect(ssl.originUndo('c1', 's1', 'app.example.com', 'run-1')).rejects.toThrow('has expired')
    expect(rec.calls.every((c) => !c.command.includes('timeout'))).toBe(true)
  })

  it('undoes a switch, then refreshes the report', async () => {
    probed = 'letsencrypt'
    const check = reportIs(switchedReport())
    const result = await ssl.originUndo('c1', 's1', 'app.example.com', 'run-1')
    expect(result.ok).toBe(true)
    expect(check).toHaveBeenCalledTimes(2)
    expect(rec.calls.filter((c) => c.command === 'sudo -n timeout -k 10 60 sh -s')).toHaveLength(1)
  })

  it('refuses to remove a certbot certificate that a site still uses', async () => {
    config.blocks = [makeBlock({ id: 'api.conf:3', names: ['api.example.com'] })]
    await expect(ssl.originRemoveLineage('c1', 'app.example.com', 'run-1')).rejects.toThrow('still used by api.example.com')
    expect(rec.calls).toEqual([])
  })

  it('refuses to remove a certbot certificate without full sudo or with a bad name', async () => {
    config.facts = makeFacts({ sudo: { certbot: true, nginx: true, full: false } })
    await expect(ssl.originRemoveLineage('c1', 'app.example.com', 'run-1')).rejects.toThrow('full passwordless sudo')
    expect(() => ssl.originRemoveLineage('c1', 'app.example.com; rm -rf /', 'run-1')).toThrow('Invalid certificate name')
    expect(rec.calls).toEqual([])
  })

  it('removes an unused certbot certificate', async () => {
    config.blocks = [makeBlock({ names: NAMES, certPath: CERT_PATH, keyPath: KEY_PATH })]
    const result = await ssl.originRemoveLineage('c1', 'app.example.com', 'run-1')
    expect(result.code).toBe(0)
    expect(rec.calls.map((c) => c.command)).toEqual(['sudo -n timeout -k 10 90 certbot delete --cert-name app.example.com --non-interactive'])
  })
})
