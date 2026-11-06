import { describe, expect, it } from 'vitest'
import { edgeOf, makeHost } from '../testReport'
import { switchCheck } from '../originCa/switchCheck'
import { prepareStage, stepDetails, stepState } from './steps'
import { applyOutcome, certificateSummary, diffCounts, nameRows, removeOutcome, switchFailureView, undoOutcome, validUntilText } from './switchView'
import { switchApplied, switchBlock, switchFailed, switchReport, SWITCH_DIFF } from './testFixtures'

describe('steps', () => {
  it('marks earlier steps done and later ones todo', () => {
    expect(stepState('explain', 'review')).toBe('done')
    expect(stepState('review', 'review')).toBe('current')
    expect(stepState('apply', 'review')).toBe('todo')
  })

  it('reads the signing stage from the streamed output', () => {
    expect(prepareStage('Generating an ECC key')).toBe('key')
    expect(prepareStage('Generating an ECC key\nAsking Cloudflare to sign')).toBe('sign')
  })

  it('describes each step from the choices', () => {
    expect(stepDetails({ keyType: 'rsa', years: 1, nameCount: 1 })).toMatchObject({ explain: '1 year · RSA', review: '1 name' })
  })
})

describe('switchView', () => {
  it('summarises the certificate', () => {
    expect(certificateSummary('ecc', 15)).toBe('Cloudflare Origin CA · ECC · 15 years')
    expect(certificateSummary('rsa', 1)).toBe('Cloudflare Origin CA · RSA · 1 year')
  })

  it('shows an unknown expiry as such', () => {
    expect(validUntilText(null)).toBe('Unknown')
    expect(validUntilText(1_800_000_000)).toMatch(/^[A-Z][a-z]{2} \d{1,2}, 20\d{2}$/)
  })

  it('counts added and removed lines', () => {
    expect(diffCounts(SWITCH_DIFF)).toEqual({ added: 2, removed: 2 })
    expect(diffCounts([])).toEqual({ added: 0, removed: 0 })
  })

  it('names the zone for names that pass and the reason for names that do not', () => {
    const report = switchReport({
      hostnames: [
        makeHost({ name: 'app.example.com', blockId: switchBlock.id }),
        makeHost({ name: 'www.app.example.com', blockId: switchBlock.id, edge: edgeOf({ state: 'dns-only' }) })
      ]
    })
    expect(nameRows(report, switchCheck(report, switchBlock.id))).toEqual([
      { name: 'app.example.com', ok: true, detail: 'proxied · zone example.com' },
      { name: 'www.app.example.com', ok: false, detail: 'not proxied by Cloudflare' }
    ])
  })

  it('says the backup was restored only when it was', () => {
    expect(switchFailureView(switchFailed({ restored: true })).note).toContain('restored the backup')
    const unrestored = switchFailureView(switchFailed({ restored: false, failedStage: 'verify' }))
    expect(unrestored.title).toBe('The new certificate did not verify')
    expect(unrestored.note).toContain('not restored automatically')
    expect(unrestored.note).toContain('/etc/ssl/shellway/backups/app.example.com-20261106.conf')
  })

  it('does not name a backup path that does not exist', () => {
    expect(switchFailureView(switchFailed({ restored: false, backupPath: null })).note).not.toContain('Your original file')
  })

  it('builds run outcomes for apply, undo and removal', () => {
    expect(applyOutcome(switchApplied(), null)).toEqual({ success: true, message: 'Switched to Cloudflare Origin CA' })
    expect(applyOutcome(null, 'Connection lost')).toEqual({ success: false, message: 'The switch could not run: Connection lost' })
    expect(applyOutcome(null, null)).toBeNull()
    expect(undoOutcome(switchApplied(), null)?.message).toBe('Switch undone')
    expect(undoOutcome(switchFailed(), null)?.success).toBe(false)
    expect(removeOutcome({ code: 0, output: '' }, null)?.message).toBe('certbot certificate removed')
    expect(removeOutcome({ code: 1, output: '' }, null)?.message).toBe('The removal failed (exit 1)')
  })
})
