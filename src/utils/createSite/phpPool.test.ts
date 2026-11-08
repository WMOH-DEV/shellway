import { spawnSync } from 'node:child_process'
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { assertPoolOwner, createPoolScript, poolLayout, poolText, removePoolScript } from './phpPool'
import { baseInput } from './testFixtures'

describe('poolLayout', () => {
  it('puts a Debian pool next to the PHP version it uses, on its own socket', () => {
    expect(poolLayout(baseInput())).toEqual({
      file: '/etc/php/8.3/fpm/pool.d/shop.conf',
      socket: '/run/php/php8.3-fpm-shop.sock',
      test: 'php-fpm8.3 -t',
      pidFile: '/run/php/php8.3-fpm.pid',
      service: 'php8.3-fpm',
      webUser: 'www-data'
    })
  })

  it('uses the single unversioned PHP-FPM on RHEL, where Apache runs as apache', () => {
    expect(poolLayout(baseInput({ server: { kind: 'apache', layout: 'rhel' } }))).toMatchObject({ file: '/etc/php-fpm.d/shop.conf', socket: '/run/php-fpm/shop.sock', webUser: 'apache' })
  })
})

describe('poolText', () => {
  it('runs the site as the login user and lets only the web server use the socket', () => {
    expect(poolText(baseInput())).toBe([
      '[shop]',
      'user = deploy',
      'listen = /run/php/php8.3-fpm-shop.sock',
      'listen.owner = www-data',
      'listen.group = www-data',
      'listen.mode = 0660',
      'pm = ondemand',
      'pm.max_children = 10',
      'pm.process_idle_timeout = 10s',
      'pm.max_requests = 500',
      ''
    ].join('\n'))
  })

  it('keeps the path cache short on Apache so a new release is used right after the switch', () => {
    expect(poolText(baseInput({ server: { kind: 'apache', layout: 'debian' } }))).toContain('php_admin_value[realpath_cache_ttl] = 2')
  })

  it('refuses root, which PHP-FPM will not run a pool as', () => {
    expect(() => assertPoolOwner('root')).toThrow(/root/)
    expect(() => poolText(baseInput({ owner: 'root' }))).toThrow(/root/)
  })
})

describe('createPoolScript', () => {
  const script = createPoolScript(baseInput())

  it('never overwrites a pool that is already there', () => {
    expect(script).toContain("if [ -e '/etc/php/8.3/fpm/pool.d/shop.conf' ] || [ -L '/etc/php/8.3/fpm/pool.d/shop.conf' ]; then")
  })

  it('removes the pool again when PHP-FPM rejects it, cannot reload, or never opens the socket', () => {
    expect(script).toMatch(/if ! php-fpm8\.3 -t; then\n {2}rm -f '\/etc\/php\/8\.3\/fpm\/pool\.d\/shop\.conf'/)
    expect(script).toContain("if ! { if command -v systemctl >/dev/null 2>&1 && systemctl is-active --quiet 'php8.3-fpm'; then systemctl reload 'php8.3-fpm'; else [ -f '/run/php/php8.3-fpm.pid' ] && kill -USR2 \"$(cat '/run/php/php8.3-fpm.pid')\"; fi; }; then")
    expect(script).toContain("if [ ! -S '/run/php/php8.3-fpm-shop.sock' ]; then")
  })
})

describe('reloading PHP-FPM', () => {
  const reloadOf = (script: string): string => script.split('\n').find((line) => line.startsWith('if ! {'))!.slice('if ! '.length, -'; then'.length)

  const run = (fakeSystemctl: string | null): { code: number; calls: string } => {
    const dir = mkdtempSync(join(tmpdir(), 'fpm-reload-'))
    try {
      if (fakeSystemctl !== null) {
        writeFileSync(join(dir, 'systemctl'), `#!/bin/sh\necho "$@" >> '${dir}/calls'\n${fakeSystemctl}\n`)
        chmodSync(join(dir, 'systemctl'), 0o755)
      }
      const result = spawnSync('/bin/sh', ['-c', reloadOf(createPoolScript(baseInput()))], { env: { PATH: `${dir}:/usr/bin:/bin` }, encoding: 'utf8' })
      return { code: result.status ?? -1, calls: existsSync(join(dir, 'calls')) ? readFileSync(join(dir, 'calls'), 'utf8') : '' }
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  }

  it('reloads through systemd when PHP-FPM runs there without a pid file, as the ondrej PPA does', () => {
    expect(run('exit 0')).toEqual({ code: 0, calls: 'is-active --quiet php8.3-fpm\nreload php8.3-fpm\n' })
  })

  it('fails when PHP-FPM is neither running under systemd nor has a pid file', () => {
    expect(run('exit 3').code).not.toBe(0)
    expect(run(null).code).not.toBe(0)
  })
})

describe('removePoolScript', () => {
  it('leaves a pool that changed after Shellway wrote it', () => {
    const script = removePoolScript(baseInput(), 'a'.repeat(64))
    expect(script).toContain(`!= '${'a'.repeat(64)}'`)
    expect(script).toContain('changed after Shellway wrote it')
  })
})
