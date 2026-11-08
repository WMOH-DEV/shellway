import { describe, expect, it } from 'vitest'
import { nextStep, previousStep, stepDetails, stepState } from './steps'

describe('steps', () => {
  it('moves through the four steps', () => {
    expect(nextStep('site', false)).toBe('prepare')
    expect(nextStep('prepare', false)).toBe('issue')
    expect(nextStep('issue', false)).toBe('verify')
    expect(previousStep('issue', false)).toBe('prepare')
    expect(previousStep('site', false)).toBe('site')
  })

  it('jumps over Prepare server when it is skipped', () => {
    expect(nextStep('site', true)).toBe('issue')
    expect(previousStep('issue', true)).toBe('site')
  })

  it('marks a skipped Prepare server as done while it is not current', () => {
    expect(stepState('prepare', 'site', true)).toBe('done')
    expect(stepState('prepare', 'site', false)).toBe('todo')
    expect(stepState('site', 'issue', false)).toBe('done')
    expect(stepState('issue', 'issue', false)).toBe('current')
  })

  it('describes each step for the sidebar', () => {
    const base = { siteTitle: 'example-app', nameCount: 2, certbotVersion: '3.0.1', prepareSkipped: true, staging: true }
    expect(stepDetails(base)).toEqual({
      site: 'example-app · 2 names',
      prepare: 'certbot 3.0.1 ready',
      issue: 'staging test first',
      verify: 'HTTPS + renewal test'
    })
    expect(stepDetails({ ...base, siteTitle: null, nameCount: 0, prepareSkipped: false, staging: false })).toMatchObject({
      site: 'pick a site', prepare: 'install certbot', issue: 'issue directly'
    })
  })
})
