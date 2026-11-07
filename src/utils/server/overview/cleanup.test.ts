import { describe, expect, it } from 'vitest'
import type { ServerFacts } from '@/types/server/core'
import { APT_GET } from '../apt'
import { aptCleanPlan, autoremovePlan, cleanupActions, journalVacuumPlan, parseCleanup, parseJournalUsage, type CleanupInfo } from './cleanup'
import { APT_CLEAN_ACTION, AUTOREMOVE_ACTION, CLEANUP_PROBE, JOURNAL_VACUUM_ACTION } from './ids'

const MB = 1024 ** 2
const GB = 1024 ** 3

const OUTPUT = [
  'apt_cache=421888',
  '@@autoremove',
  '312000 linux-image-6.8.0-45-generic',
  '1200 libfoo1',
  '@@end',
  'journal=Archived and active journals take up 6.1G in the file system.'
].join('\n')

const factsWith = (data: CleanupInfo): ServerFacts => ({ [CLEANUP_PROBE]: { status: 'ok', data, at: 1 } })

describe('parseCleanup', () => {
  it('reads the apt cache, unused packages with sizes and journal usage', () => {
    expect(parseCleanup(OUTPUT)).toEqual({
      apt: {
        cacheBytes: 421888 * 1024,
        autoremove: [
          { name: 'linux-image-6.8.0-45-generic', sizeBytes: 312000 * 1024 },
          { name: 'libfoo1', sizeBytes: 1200 * 1024 }
        ]
      },
      journalBytes: Math.round(6.1 * GB)
    })
  })

  it('marks apt and journal missing when their sections are absent', () => {
    expect(parseCleanup('')).toEqual({ apt: null, journalBytes: null })
  })

  it('reads an empty autoremove list', () => {
    expect(parseCleanup('apt_cache=0\n@@autoremove\n@@end\n').apt).toEqual({ cacheBytes: 0, autoremove: [] })
  })
})

describe('parseJournalUsage', () => {
  it.each([
    ['Archived and active journals take up 56.0M in the file system.', 56 * MB],
    ['Journals take up 8.0K on disk.', 8 * 1024],
    ['Archived and active journals take up 512B in the file system.', 512],
    ['No journal files were found.', null]
  ])('%s', (line, bytes) => {
    expect(parseJournalUsage(line)).toBe(bytes)
  })
})

describe('cleanup plans', () => {
  const info = parseCleanup(OUTPUT)

  it('registers the three actions on the cleanup probe', () => {
    expect(cleanupActions.map((a) => a.type)).toEqual([APT_CLEAN_ACTION, AUTOREMOVE_ACTION, JOURNAL_VACUUM_ACTION])
    expect(cleanupActions.every((a) => a.needs.includes(CLEANUP_PROBE))).toBe(true)
  })

  it('apt clean shows the command and the size it frees', () => {
    const plan = aptCleanPlan({}, factsWith(info))
    expect(plan.blocked).toBeNull()
    expect(plan.steps[0]).toMatchObject({ root: true, display: 'apt-get clean' })
    expect(plan.summary).toContain('412 MB')
  })

  it('autoremove lists the packages and runs noninteractive apt in the background', () => {
    const plan = autoremovePlan({}, factsWith(info))
    expect(plan.blocked).toBeNull()
    expect(plan.summary).toContain('linux-image-6.8.0-45-generic, libfoo1')
    expect(plan.summary).toContain('306 MB')
    expect(plan.steps[0].display).toBe(`${APT_GET} autoremove --purge`)
    expect(plan.steps[0].script).toContain('DEBIAN_FRONTEND=noninteractive')
    expect(plan.steps[0]).toMatchObject({ detached: true, timeoutSeconds: 900 })
  })

  it('autoremove is blocked when nothing is unused', () => {
    expect(autoremovePlan({}, factsWith({ apt: { cacheBytes: 0, autoremove: [] }, journalBytes: null })).blocked).toEqual({ kind: 'precondition', message: 'No unused packages to remove.' })
  })

  it('journal vacuum keeps 200 MB and reports the difference', () => {
    const plan = journalVacuumPlan({}, factsWith(info))
    expect(plan.blocked).toBeNull()
    expect(plan.steps[0].display).toBe('journalctl --vacuum-size=200M')
    expect(plan.summary).toContain('5.9 GB')
  })

  it('journal vacuum is blocked when logs are already small or missing', () => {
    expect(journalVacuumPlan({}, factsWith({ apt: null, journalBytes: 100 * MB })).blocked?.kind).toBe('precondition')
    expect(journalVacuumPlan({}, factsWith({ apt: null, journalBytes: null })).blocked?.kind).toBe('unsupported')
  })

  it('apt actions are blocked on servers without apt', () => {
    const facts = factsWith({ apt: null, journalBytes: null })
    expect(aptCleanPlan({}, facts).blocked?.kind).toBe('unsupported')
    expect(autoremovePlan({}, facts).blocked?.kind).toBe('unsupported')
  })

  it('every plan is blocked with the probe reason when the check could not run', () => {
    const facts: ServerFacts = { [CLEANUP_PROBE]: { status: 'unavailable', reason: 'sudo needs a password', at: 1 } }
    for (const plan of [aptCleanPlan({}, facts), autoremovePlan({}, facts), journalVacuumPlan({}, facts)]) {
      expect(plan.blocked).toEqual({ kind: 'precondition', message: 'sudo needs a password' })
    }
    expect(aptCleanPlan({}, {}).blocked?.kind).toBe('precondition')
  })
})
