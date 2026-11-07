import { describe, expect, it } from 'vitest'
import { validateSiteConfig } from '../deploy/siteFiles'
import type { TemplateId } from '../../../src/types/createSite'
import { deploySiteConfig } from '../../../src/utils/createSite/deploySite'
import { baseInput } from '../../../src/utils/createSite/testFixtures'

const TEMPLATE_IDS: TemplateId[] = ['laravel', 'node', 'static', 'php', 'compose', 'blank']

describe('deploySiteConfig', () => {
  it.each(TEMPLATE_IDS)('gives the Deploy runner a valid releases site for %s', (template) => {
    const config = deploySiteConfig(baseInput({ template }))
    expect(validateSiteConfig(config)).toBeNull()
    expect(config).toMatchObject({ name: 'shop', path: '/var/www/shop', layout: 'releases', healthUrl: 'https://shop.example.com/', sourceMode: 'auto', pollMinutes: 2 })
  })

  it('keeps the Laravel shared paths and activate steps', () => {
    const config = deploySiteConfig(baseInput())
    expect(config.sharedPaths).toEqual(['.env', 'storage'])
    expect(config.activateSteps[0].command).toBe('php artisan migrate --force')
  })

  it('pins the Compose project to the site name so every release reuses the same containers', () => {
    const commands = deploySiteConfig(baseInput({ template: 'compose' })).activateSteps.map((step) => step.command)
    expect(commands).toEqual(['docker compose -p shop pull', 'docker compose -p shop up -d --build'])
  })

  it('rejects a health path or folder the validators refuse', () => {
    expect(() => deploySiteConfig(baseInput({ healthPath: 'health' }))).toThrow()
    expect(() => deploySiteConfig(baseInput({ folder: '/' }))).toThrow()
  })
})
