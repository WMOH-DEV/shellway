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
    expect(config.activateSteps[0].command).toBe('php8.3 artisan migrate --force')
  })

  it('runs php and composer with the PHP version the site uses, since the default php may be another version', () => {
    const config = deploySiteConfig(baseInput({ phpVersion: '8.4' }))
    expect(config.buildSteps.map((step) => step.command)).toEqual(['php8.4 "$(command -v composer)" install --no-dev --optimize-autoloader --no-interaction', 'php8.4 artisan storage:link'])
    expect(config.activateSteps.map((step) => step.command)).toContain('php8.4 artisan config:cache')
  })

  it('leaves php unpinned on RHEL, which has one unversioned php', () => {
    const config = deploySiteConfig(baseInput({ server: { kind: 'apache', layout: 'rhel' } }))
    expect(config.activateSteps[0].command).toBe('php artisan migrate --force')
    expect(config.buildSteps[0].command).toMatch(/^composer install/)
  })

  it('pins the Compose project to the site name so every release reuses the same containers', () => {
    const commands = deploySiteConfig(baseInput({ template: 'compose' })).activateSteps.map((step) => step.command)
    expect(commands).toEqual(['docker compose -p shop pull', 'docker compose -p shop up -d --build'])
  })

  it('starts or restarts a Node.js app with pm2 from the site path after it goes live', () => {
    const config = deploySiteConfig(baseInput({ template: 'node', appPort: 3100 }))
    expect(config.activateSteps.map((step) => step.command)).toEqual([
      "if pm2 describe 'shop' >/dev/null 2>&1; then PORT=3100 pm2 restart 'shop' --update-env; else PORT=3100 pm2 start npm --name 'shop' --cwd '/var/www/shop' -- start; fi",
      'pm2 save'
    ])
  })

  it('uses the commands from the input as they are, so the user edits in the wizard are what runs', () => {
    const buildSteps = [{ command: 'make build', optional: true, timeoutSeconds: 60 }]
    const config = deploySiteConfig(baseInput({ buildSteps, activateSteps: [] }))
    expect(config.buildSteps).toEqual(buildSteps)
    expect(config.activateSteps).toEqual([])
  })

  it('rejects a health path or folder the validators refuse', () => {
    expect(() => deploySiteConfig(baseInput({ healthPath: 'health' }))).toThrow()
    expect(() => deploySiteConfig(baseInput({ folder: '/' }))).toThrow()
  })
})
