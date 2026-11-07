import { spawnSync } from 'child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { describe, expect, it } from 'vitest'
import { NGINX_CONF } from './fixtures/nginxConf'
import { includedSettingsScript, NGINX_SCRIPT, parseIncludedSettings, parseNginx, parseNginxValues, setNginxDirectives } from './nginx'

const SERVER_BLOCK = NGINX_CONF.slice(NGINX_CONF.indexOf('\tserver {'), NGINX_CONF.indexOf('\tinclude /etc/nginx/conf.d'))

const base64 = (text: string): string => Buffer.from(text).toString('base64')

describe('parseNginxValues', () => {
  it('reads only directives directly inside http', () => {
    expect(parseNginxValues(NGINX_CONF)).toEqual({ gzip: 'on', keepalive_timeout: '65' })
  })

  it('ignores commented directives and returns nothing without an http block', () => {
    expect(parseNginxValues('# gzip on;\nevents {\n}\n')).toEqual({})
  })

  it('handles braces and hashes inside quoted strings', () => {
    const conf = "http {\n  log_format main '{ # }';\n  gzip off;\n}\n"
    expect(parseNginxValues(conf)).toEqual({ gzip: 'off' })
  })
})

describe('setNginxDirectives', () => {
  it('replaces an active directive and keeps indentation and trailing comments', () => {
    const result = setNginxDirectives('http {\n    keepalive_timeout 65; # idle\n}\n', { keepalive_timeout: '30s' })
    expect(result).toBe('http {\n    keepalive_timeout 30s; # idle\n}\n')
  })

  it('adds an active line right after a commented directive', () => {
    const result = setNginxDirectives(NGINX_CONF, { server_tokens: 'off' }) ?? ''
    expect(result).toContain('\t# server_tokens off;\n\tserver_tokens off;\n\n\t# server_names_hash_bucket_size')
    expect(parseNginxValues(result).server_tokens).toBe('off')
  })

  it('inserts missing directives after the http line using the next line indentation', () => {
    const result = setNginxDirectives(NGINX_CONF, { client_max_body_size: '64M' }) ?? ''
    expect(result).toContain('http {\n\tclient_max_body_size 64M;\n\n\t##')
    expect(parseNginxValues(result).client_max_body_size).toBe('64M')
  })

  it('inserts several missing directives in the order given', () => {
    const result = setNginxDirectives('http {\n  sendfile on;\n}\n', { gzip: 'on', server_tokens: 'off' })
    expect(result).toBe('http {\n  gzip on;\n  server_tokens off;\n  sendfile on;\n}\n')
  })

  it('indents deeper than http when the block is empty', () => {
    expect(setNginxDirectives('http {\n}\n', { gzip: 'on' })).toBe('http {\n    gzip on;\n}\n')
  })

  it('never touches server or location blocks', () => {
    const result = setNginxDirectives(NGINX_CONF, { client_max_body_size: '8m', keepalive_timeout: '20', gzip: 'off', server_tokens: 'off' }) ?? ''
    expect(result).toContain(SERVER_BLOCK)
    expect(result.split('client_max_body_size')).toHaveLength(4)
    expect(parseNginxValues(result)).toEqual({ client_max_body_size: '8m', keepalive_timeout: '20', gzip: 'off', server_tokens: 'off' })
  })

  it('does not match directives that only share a prefix', () => {
    const result = setNginxDirectives('http {\n  gzip_vary on;\n}\n', { gzip: 'on' })
    expect(result).toBe('http {\n  gzip on;\n  gzip_vary on;\n}\n')
  })

  it('leaves the file identical when the values already match', () => {
    expect(setNginxDirectives(NGINX_CONF, { gzip: 'on', keepalive_timeout: '65' })).toBe(NGINX_CONF)
  })

  it('returns null when there is no http block', () => {
    expect(setNginxDirectives('events {\n}\n', { gzip: 'on' })).toBeNull()
    expect(setNginxDirectives('# http {\n', { gzip: 'on' })).toBeNull()
  })
})

describe('nginx probe', () => {
  it('reads the config file and its values', () => {
    const facts = parseNginx(`@@conf\nsha=${'c'.repeat(64)}\nb64=${base64(NGINX_CONF)}\n`)
    expect(facts.installed).toBe(true)
    expect(facts.conf.sha256).toBe('c'.repeat(64))
    expect(facts.conf.content).toBe(NGINX_CONF)
    expect(facts.values).toEqual({ gzip: 'on', keepalive_timeout: '65' })
  })

  it('reports nginx as not installed when the script found nothing', () => {
    expect(parseNginx('@@none\n')).toEqual({ installed: false, conf: { sha256: null, content: '' }, values: {}, elsewhere: {} })
  })

  it('reads settings that included files define at http level', () => {
    const facts = parseNginx(`@@conf\nsha=${'c'.repeat(64)}\nb64=${base64(NGINX_CONF)}\n@@included\n/etc/nginx/conf.d/uploads.conf|client_max_body_size|100M\n`)
    expect(facts.elsewhere).toEqual({ client_max_body_size: { value: '100M', path: '/etc/nginx/conf.d/uploads.conf' } })
  })

  it('checks the nginx binary by path because sbin is not on every login PATH', () => {
    expect(NGINX_SCRIPT).toContain('/usr/sbin/nginx')
  })
})

describe('parseIncludedSettings', () => {
  it('keeps the first file per known key and skips unknown or malformed lines', () => {
    const lines = ['/etc/nginx/conf.d/a.conf|gzip|off', '/etc/nginx/conf.d/b.conf|gzip|on', '/etc/nginx/conf.d/a.conf|worker_connections|512', 'garbage', '/etc/nginx/conf.d/a.conf|server_tokens|']
    expect(parseIncludedSettings(lines)).toEqual({ gzip: { value: 'off', path: '/etc/nginx/conf.d/a.conf' } })
  })
})

describe('included settings probe', () => {
  it('follows includes from the http block, ignores server blocks and braces inside quotes', () => {
    const dir = mkdtempSync(join(tmpdir(), 'shellway-nginx-'))
    try {
      mkdirSync(join(dir, 'conf.d'))
      mkdirSync(join(dir, 'sites'))
      mkdirSync(join(dir, 'snippets'))
      writeFileSync(join(dir, 'nginx.conf'), `include ${dir}/snippets/top.conf;\nevents {}\nhttp {\n  include conf.d/*.conf;\n  include "${dir}/sites/*";\n  server { include ${dir}/snippets/inner.conf; }\n}\n`)
      writeFileSync(join(dir, 'conf.d', 'uploads.conf'), 'client_max_body_size 100M; # big\ninclude snippets/nested.conf;\n')
      writeFileSync(join(dir, 'sites', 'app'), 'server {\n  return 200 "}";\n  gzip off;\n}\nkeepalive_timeout 30s;\n')
      writeFileSync(join(dir, 'snippets', 'nested.conf'), "server_tokens off;\nlog_format x '{';\n")
      writeFileSync(join(dir, 'snippets', 'inner.conf'), 'gzip on;\n')
      writeFileSync(join(dir, 'snippets', 'top.conf'), 'gzip on;\n')
      const run = spawnSync('/bin/sh', ['-s'], { input: includedSettingsScript(dir), encoding: 'utf8' })
      expect(parseIncludedSettings(run.stdout.split('\n'))).toEqual({
        client_max_body_size: { value: '100M', path: join(dir, 'conf.d', 'uploads.conf') },
        keepalive_timeout: { value: '30s', path: join(dir, 'sites', 'app') },
        server_tokens: { value: 'off', path: join(dir, 'snippets', 'nested.conf') }
      })
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
