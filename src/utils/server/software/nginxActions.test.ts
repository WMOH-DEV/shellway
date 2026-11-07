import { describe, expect, it } from 'vitest'
import type { ActionDefinition, ServerFacts } from '@/types/server/core'
import { IDENTITY_PROBE } from '@/types/server/identity'
import { softwareArea } from '../areas/software'
import { NGINX_CONF } from './fixtures/nginxConf'
import { parseNginx } from './nginx'
import { NGINX_PROBE } from './types'

const ok = (data: unknown) => ({ status: 'ok' as const, data, at: 1 })

const SHA = 'c'.repeat(64)

const identity = ok({ os: { family: 'ubuntu', id: 'ubuntu', versionId: '24.04', codename: 'noble', prettyName: 'Ubuntu 24.04 LTS' } })

const nginxFacts = (conf: string) => ok(parseNginx(`@@conf\nsha=${SHA}\nb64=${Buffer.from(conf).toString('base64')}\n`))

const FACTS: ServerFacts = { [IDENTITY_PROBE]: identity, [NGINX_PROBE]: nginxFacts(NGINX_CONF) }

const action = (type: string): ActionDefinition => {
  const found = softwareArea.actions.find((item) => item.type === type)
  if (!found) throw new Error(`missing ${type}`)
  return found
}

const plan = (type: string, raw: unknown, facts: ServerFacts = FACTS) => {
  const definition = action(type)
  return definition.plan(definition.validate(raw), facts)
}

describe('software.nginx-test', () => {
  it('runs nginx -t as a single read-only command', () => {
    const result = plan('software.nginx-test', {})
    expect(result.blocked).toBeNull()
    expect(result.steps).toHaveLength(1)
    expect(result.steps[0]).toMatchObject({ kind: 'command', root: true, display: 'nginx -t 2>&1' })
  })

  it('is blocked when nginx is missing or unchecked', () => {
    expect(plan('software.nginx-test', {}, { ...FACTS, [NGINX_PROBE]: ok(parseNginx('@@none\n')) }).blocked?.message).toBe('nginx is not installed.')
    expect(plan('software.nginx-test', {}, { [IDENTITY_PROBE]: identity }).blocked?.message).toContain('not been checked')
  })
})

describe('software.nginx-settings', () => {
  it('builds a checked file edit that tests and reloads nginx', () => {
    const result = plan('software.nginx-settings', { values: { server_tokens: 'off', client_max_body_size: '64M' } })
    expect(result.blocked).toBeNull()
    const [step] = result.steps
    expect(step.kind).toBe('file-edit')
    expect(step.display).toBe("cp -p '/etc/nginx/nginx.conf' \"/var/backups/shellway/$SHELLWAY_RUN_ID/etc/nginx/nginx.conf\"\nwrite '/etc/nginx/nginx.conf'\nnginx -t\nsystemctl reload nginx")
    expect(step.script).toContain(SHA)
    expect(step.script).toContain('chmod 0644')
    expect(step.script).toContain('chown root:root')
    expect(step.diff).toContain('+\tserver_tokens off;')
    expect(step.diff).toContain('+\tclient_max_body_size 64M;')
  })

  it('blocks when the values are already set', () => {
    expect(plan('software.nginx-settings', { values: { gzip: 'on' } }).blocked?.message).toBe('These values are already set.')
  })

  it('blocks without an http block', () => {
    const facts = { ...FACTS, [NGINX_PROBE]: nginxFacts('events {\n}\n') }
    expect(plan('software.nginx-settings', { values: { gzip: 'on' } }, facts).blocked?.message).toContain('no http block')
  })

  it('blocks when nginx is not installed or unchecked', () => {
    expect(plan('software.nginx-settings', { values: { gzip: 'off' } }, { ...FACTS, [NGINX_PROBE]: ok(parseNginx('@@none\n')) }).blocked?.message).toBe('nginx is not installed.')
    expect(plan('software.nginx-settings', { values: { gzip: 'off' } }, { [IDENTITY_PROBE]: identity }).blocked?.kind).toBe('precondition')
  })

  it('blocks on an unsupported operating system', () => {
    const fedora = ok({ os: { family: 'rhel', id: 'fedora', versionId: '40', codename: '', prettyName: 'Fedora 40' } })
    expect(plan('software.nginx-settings', { values: { gzip: 'off' } }, { ...FACTS, [IDENTITY_PROBE]: fedora }).blocked?.kind).toBe('unsupported')
  })

  it.each([
    [{ client_max_body_size: '64M; } evil {' }],
    [{ client_max_body_size: '-1' }],
    [{ client_max_body_size: '' }],
    [{ keepalive_timeout: '10m' }],
    [{ keepalive_timeout: '12345' }],
    [{ gzip: 'yes' }],
    [{ server_tokens: 'build' }],
    [{ worker_processes: '4' }],
    [{}]
  ])('rejects %j', (values) => {
    expect(() => action('software.nginx-settings').validate({ values })).toThrow()
  })

  it.each([[{ client_max_body_size: '1g' }], [{ client_max_body_size: '0' }], [{ keepalive_timeout: '65s' }], [{ gzip: 'off' }], [{ server_tokens: 'on' }]])('accepts %j', (values) => {
    expect(() => action('software.nginx-settings').validate({ values })).not.toThrow()
  })

  it('rejects params that are not an object with values', () => {
    expect(() => action('software.nginx-settings').validate(null)).toThrow()
    expect(() => action('software.nginx-settings').validate({})).toThrow()
  })
})
