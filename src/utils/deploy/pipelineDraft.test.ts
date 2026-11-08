import { describe, it, expect } from 'vitest'
import { newSite } from './presets'
import { blankStep } from './pipelineSteps'
import {
  buildDescription,
  changesLabel,
  countChanges,
  draftIssue,
  joinQuietHours,
  notifyTarget,
  parseQuietHours,
  pollChoices,
  releaseSwitchCommand,
  sameConfig
} from './pipelineDraft'

const saved = { ...newSite('/var/www/example'), name: 'example-app', buildSteps: [blankStep('npm ci'), blankStep('npm run build')], activateSteps: [blankStep('php artisan migrate --force')] }

describe('counting unsaved changes', () => {
  it('is zero for an identical draft', () => {
    expect(countChanges(saved, structuredClone(saved))).toBe(0)
    expect(sameConfig(saved, structuredClone(saved))).toBe(true)
  })

  it('counts each changed setting once', () => {
    expect(countChanges(saved, { ...saved, branch: 'release', approveMigrations: true })).toBe(2)
    expect(countChanges(saved, { ...saved, sharedPaths: ['.env'] })).toBe(1)
  })

  it('counts changed, added and removed commands', () => {
    expect(countChanges(saved, { ...saved, buildSteps: [blankStep('npm ci'), { ...blankStep('npm run build'), optional: true }] })).toBe(1)
    expect(countChanges(saved, { ...saved, buildSteps: [...saved.buildSteps, blankStep('npm test')] })).toBe(1)
    expect(countChanges(saved, { ...saved, buildSteps: [saved.buildSteps[0]] })).toBe(1)
    expect(countChanges(saved, { ...saved, buildSteps: [saved.buildSteps[1], saved.buildSteps[0]] })).toBe(2)
  })

  it('counts a time limit as a change', () => {
    expect(countChanges(saved, { ...saved, activateSteps: [{ ...saved.activateSteps[0], timeoutSeconds: 120 }] })).toBe(1)
  })

  it('labels the count', () => {
    expect(changesLabel(0)).toBe('No unsaved changes')
    expect(changesLabel(1)).toBe('1 unsaved change')
    expect(changesLabel(3)).toBe('3 unsaved changes')
  })
})

describe('quiet hours text', () => {
  it('splits and joins a window', () => {
    expect(parseQuietHours('22:00-06:00')).toEqual({ from: '22:00', to: '06:00' })
    expect(joinQuietHours({ from: '22:00', to: '06:00' })).toBe('22:00-06:00')
  })

  it.each(['', '22:00', 'night'])('does not read %j as a window', (value) => {
    expect(parseQuietHours(value)).toBeNull()
  })
})

describe('draftIssue', () => {
  it('accepts a normal draft', () => {
    expect(draftIssue(saved)).toBeNull()
    expect(draftIssue({ ...saved, quietHours: '22:00-06:00', notifyUrl: 'https://example.com/hook' })).toBeNull()
  })

  it('rejects empty commands in either list', () => {
    expect(draftIssue({ ...saved, buildSteps: [blankStep('  ')] })).toBe('A command is empty')
    expect(draftIssue({ ...saved, activateSteps: [blankStep('')] })).toBe('A command is empty')
  })

  it('rejects quiet hours that cannot be a window', () => {
    expect(draftIssue({ ...saved, quietHours: '22:00-22:00' })).toContain('must differ')
    expect(draftIssue({ ...saved, quietHours: 'night' })).toContain('start and an end')
  })

  it('rejects a notification url that is not http', () => {
    expect(draftIssue({ ...saved, notifyUrl: 'example.com/hook' })).toContain('http')
  })
})

describe('small helpers', () => {
  it('keeps an unusual check interval in the choices', () => {
    expect(pollChoices(5)).toEqual([1, 2, 5, 10, 15, 30, 60])
    expect(pollChoices(7)).toEqual([1, 2, 5, 7, 10, 15, 30, 60])
  })

  it('shows the real switch for each layout', () => {
    expect(releaseSwitchCommand('releases')).toBe('ln -sfn releases/<new> current')
    expect(releaseSwitchCommand('inplace')).toBe('git reset --hard <new>')
  })
})

describe('notification target', () => {
  it.each<[string, string | null]>([
    ['https://hooks.slack.com/services/T0/B0/x', 'Slack'],
    ['https://discord.com/api/webhooks/1/x', 'Discord'],
    ['https://discordapp.com/api/webhooks/1/x', 'Discord'],
    ['https://example.com/notify', 'Webhook'],
    ['https://example.com/hooks.slack.com/x', 'Webhook'],
    ['', null],
    ['not a url', null]
  ])('reads %j as %s', (url, target) => expect(notifyTarget(url)).toBe(target))
})

describe('build stage description', () => {
  it('explains where commands run for each layout', () => {
    expect(buildDescription('releases')).toContain('new release')
    expect(buildDescription('inplace')).toContain('site folder')
  })
})
