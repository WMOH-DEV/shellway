import { describe, expect, it } from 'vitest'
import type { ServerTools, TemplateId } from '@/types/createSite'
import { templateAvailability } from './availability'
import { allTools } from './testFixtures'

const NOTHING: Partial<ServerTools> = { phpFpm: null, composer: false, node: null, pm2: false, docker: false }

describe('templateAvailability', () => {
  it.each([
    ['laravel', {}, 'ok', 'PHP 8.3-fpm and composer found'],
    ['laravel', { composer: false }, 'installs', 'PHP 8.3-fpm found · composer will be installed'],
    ['laravel', { phpFpm: null }, 'blocked', 'PHP-FPM not installed'],
    ['laravel', { phpFpm: null, composer: false }, 'blocked', 'PHP-FPM not installed'],
    ['php', {}, 'ok', 'PHP 8.3-fpm and composer found'],
    ['php', { phpFpm: '8.2', composer: false }, 'installs', 'PHP 8.2-fpm found · composer will be installed'],
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
