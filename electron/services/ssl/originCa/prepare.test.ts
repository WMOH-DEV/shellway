import { createHash } from 'node:crypto'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { SwitchRequest } from '../../../../src/types/ssl'
import { certWriteScript, csrScript } from '../../../../src/utils/ssl/originCa/scripts'
import { makeBlock, makeFacts } from '../../../../src/utils/ssl/testReport'
import { runPrepare } from './prepare'
import type { PrepareHooks } from './prepare'
import { BACKUP_PATH, CERT_PATH, CSR, FILE, KEY_PATH, NAMES, PEM, SITE, readyReport, recorder } from './testKit'
import type { Answer, Call } from './testKit'

const request: SwitchRequest = { blockId: 'app.conf:9', keyType: 'ecc', validityYears: 15 }
const READ = `sudo -n cat '${FILE}'`
const REMOVE = `sudo -n rm -f '${KEY_PATH}' '${CERT_PATH}'`
const withoutToken = (script: string | undefined) => script?.replace(/SHELLWAY_[0-9a-f]{32}/g, 'TOKEN')
const isCsr = (call: Call) => call.stdin?.includes('openssl req') === true

const normal = (call: Call): Answer | undefined => {
  if (isCsr(call)) return { code: 0, stdout: CSR }
  if (call.command === READ) return { code: 0, stdout: SITE }
  return undefined
}

let createOriginCert: ReturnType<typeof vi.fn>
let hooks: PrepareHooks

beforeEach(() => {
  createOriginCert = vi.fn(async () => ({ certificate: PEM, notAfter: 2_300_000_000 }))
  hooks = { now: () => 1_800_000_000_000, newId: () => 'switch-1', onOutput: () => {} }
})

const prepare = (responder = normal, report = readyReport(), req = request) => {
  const rec = recorder(responder)
  hooks.onOutput = rec.onOutput
  return { rec, done: runPrepare({ exec: rec.exec, cloudflare: { createOriginCert }, report, request: req }, hooks) }
}

describe('runPrepare', () => {
  it('makes the key and request, has Cloudflare sign for the block names, saves the certificate and reads the site file', async () => {
    const { rec, done } = prepare()
    const prepared = await done

    expect(rec.calls.map((c) => c.command)).toEqual(['sudo -n sh -s', 'sudo -n sh -s', READ])
    expect(rec.calls[0].stdin).toBe(csrScript(NAMES, 'ecc', KEY_PATH))
    expect(createOriginCert).toHaveBeenCalledWith(CSR, NAMES, 'ecc', 15)
    expect(withoutToken(rec.calls[1].stdin)).toBe(withoutToken(certWriteScript(PEM, CERT_PATH)))
    expect(prepared).toMatchObject({
      switchId: 'switch-1', blockId: 'app.conf:9', file: FILE, blockLine: 9, names: NAMES, certPath: CERT_PATH, keyPath: KEY_PATH,
      keyType: 'ecc', validityYears: 15, notAfter: 2_300_000_000, backupPath: BACKUP_PATH
    })
  })

  it('builds the diff and a script that refuses unless the file still has the reviewed checksum', async () => {
    const prepared = await prepare().done
    const sha = createHash('sha256').update(SITE).digest('hex')

    expect(prepared.diff.filter((l) => l.kind === 'add').map((l) => l.text)).toEqual([`    ssl_certificate ${CERT_PATH};`, `    ssl_certificate_key ${KEY_PATH};`])
    expect(prepared.diff.filter((l) => l.kind === 'remove')).toHaveLength(2)
    expect(prepared.script).toContain(`!= '${sha}'`)
    expect(prepared.script).toContain(`cp -p '${FILE}' '${BACKUP_PATH}'`)
    expect(prepared.script).toContain('include /etc/letsencrypt/options-ssl-nginx.conf; # managed by Certbot')
  })

  it('says nothing about Cloudflare until it asks Cloudflare, and never shows the request or key', async () => {
    const { rec, done } = prepare()
    await done
    const text = rec.streamed.join('')
    const asking = text.indexOf('Asking Cloudflare to sign the certificate for app.example.com, www.example.com\n')

    expect(asking).toBeGreaterThan(0)
    expect(text.slice(0, asking)).not.toMatch(/cloudflare/i)
    expect(text).not.toContain('BEGIN CERTIFICATE REQUEST')
    expect(text).not.toContain('PRIVATE KEY')
  })

  it('refuses before touching the server when the switch is not allowed', async () => {
    const { rec, done } = prepare(normal, readyReport({ blocks: [makeBlock({ names: NAMES, tls: false, certPath: '' })] }))
    await expect(done).rejects.toThrow('no HTTPS configuration')
    expect(rec.calls).toEqual([])
    expect(createOriginCert).not.toHaveBeenCalled()
  })

  it('removes the new key and certificate when Cloudflare refuses', async () => {
    createOriginCert.mockRejectedValueOnce(new Error('Cloudflare refused to create the certificate.'))
    const { rec, done } = prepare()
    await expect(done).rejects.toThrow('Cloudflare refused')
    expect(rec.calls.map((c) => c.command)).toEqual(['sudo -n sh -s', REMOVE])
  })

  it('removes the key when the request cannot be created', async () => {
    const { rec, done } = prepare((call) => (isCsr(call) ? { code: 1 } : undefined))
    await expect(done).rejects.toThrow('Could not create the private key')
    expect(createOriginCert).not.toHaveBeenCalled()
    expect(rec.calls.at(-1)?.command).toBe(REMOVE)
  })

  it('removes the key and certificate when the site file cannot be read', async () => {
    const { rec, done } = prepare((call) => (call.command === READ ? { code: 1 } : normal(call)))
    await expect(done).rejects.toThrow(`Could not read ${FILE}`)
    expect(rec.calls.at(-1)?.command).toBe(REMOVE)
  })

  it('removes the key and certificate when the certificate lines cannot be swapped', async () => {
    const report = readyReport({ blocks: [makeBlock({ names: NAMES, keyPath: '' })] })
    const { rec, done } = prepare((call) => (call.command === READ ? { code: 0, stdout: SITE.replace(/ssl_certificate_key[^\n]*\n/, '') } : normal(call)), report)
    await expect(done).rejects.toThrow('no ssl_certificate_key line')
    expect(rec.calls.at(-1)?.command).toBe(REMOVE)
  })

  describe('when the site file is not the one that was scanned', () => {
    const CHANGED = 'The site file changed while preparing. Check again.'
    const edits: Record<string, (text: string) => string> = {
      'a different certificate': (text) => text.replace('live/app.example.com/fullchain.pem', 'live/other.example.com/fullchain.pem'),
      'a different key': (text) => text.replace('live/app.example.com/privkey.pem', 'live/other.example.com/privkey.pem'),
      'different names': (text) => text.replace('www.example.com;', 'shop.example.com;'),
      'an extra name': (text) => text.replace('www.example.com;', 'www.example.com api.example.com;'),
      'lines added above the site': (text) => `# new\n${text}`,
      'no site at that line': () => '# nothing here\n'
    }

    it.each(Object.keys(edits))('removes the new key and certificate when it has %s', async (label) => {
      const { rec, done } = prepare((call) => (call.command === READ ? { code: 0, stdout: edits[label](SITE) } : normal(call)))
      await expect(done).rejects.toThrow(CHANGED)
      expect(rec.calls.at(-1)?.command).toBe(REMOVE)
    })

    it('accepts a differently cased name list', async () => {
      const { done } = prepare((call) => (call.command === READ ? { code: 0, stdout: SITE.replace('app.example.com www', 'APP.example.com www') } : normal(call)))
      await expect(done).resolves.toMatchObject({ switchId: 'switch-1' })
    })
  })

  it('refuses before touching the server when nginx was not fully read', async () => {
    for (const nginxParse of ['partial', 'unavailable'] as const) {
      const facts = makeFacts({ nginxParse, sudo: { certbot: true, nginx: true, apache: false, full: true } })
      const { rec, done } = prepare(normal, readyReport({ facts }))
      await expect(done).rejects.toThrow('could not read the whole web server configuration')
      expect(rec.calls).toEqual([])
    }
  })

  it('uses the RSA request type when asked', async () => {
    await prepare(normal, readyReport(), { ...request, keyType: 'rsa', validityYears: 1 }).done
    expect(createOriginCert).toHaveBeenCalledWith(CSR, NAMES, 'rsa', 1)
  })
})
