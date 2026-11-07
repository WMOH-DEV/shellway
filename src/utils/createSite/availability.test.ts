import { describe, expect, it } from 'vitest'
import type { ServerTools, TemplateId } from '@/types/createSite'
import { templateAvailability } from './availability'
import { allTools } from './testFixtures'

const NO_PHP = { installed: [], installable: [], missingPackages: {} }
const CAN_INSTALL_PHP = { installed: [], installable: ['8.5'], missingPackages: {} }

const NOTHING: Partial<ServerTools> = { php: NO_PHP, composer: false, node: null, pm2: false, docker: false }

describe('templateAvailability', () => {
  it.each([
    ['laravel', {}, 'ok', 'PHP-FPM 8.3 and composer found'],
    ['laravel', { composer: false }, 'installs', 'PHP-FPM 8.3 found · composer will be installed'],
    ['laravel', { php: NO_PHP }, 'blocked', 'PHP-FPM not installed'],
    ['laravel', { php: NO_PHP, composer: false }, 'blocked', 'PHP-FPM not installed'],
    ['laravel', { php: CAN_INSTALL_PHP, composer: false }, 'installs', 'PHP-FPM and composer will be installed'],
    ['laravel', { php: { installed: ['8.4', '8.3'], installable: [], missingPackages: {} } }, 'ok', 'PHP-FPM 8.4, 8.3 and composer found'],
    ['php', {}, 'ok', 'PHP-FPM 8.3 and composer found'],
    ['php', { php: { installed: ['8.2'], installable: [], missingPackages: {} }, composer: false }, 'installs', 'PHP-FPM 8.2 found · composer will be installed'],
    ['node', {}, 'ok', 'node 20 and pm2 found'],
    ['node', { pm2: false }, 'installs', 'node 20 found · pm2 will be installed'],
    ['node', { node: null }, 'blocked', 'node not installed'],
    ['compose', {}, 'ok', 'docker found'],
    ['compose', { docker: false }, 'blocked', 'docker not installed'],
    ['static', NOTHING, 'ok', 'Nothing else needed'],
    ['blank', NOTHING, 'ok', 'Nothing else needed']
  ] as Array<[TemplateId, Partial<ServerTools>, string, string]>)('%s with %j is %s', (template, tools, state, reason) => {
    expect(templateAvailability(template, allTools(tools))).toEqual({ state, reason })
  })
})
