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
    expect(script).toContain(`if ! [ -f '/run/php/php8.3-fpm.pid' ] && kill -USR2 "$(cat '/run/php/php8.3-fpm.pid')"; then`)
    expect(script).toContain("if [ ! -S '/run/php/php8.3-fpm-shop.sock' ]; then")
  })
})

describe('removePoolScript', () => {
  it('leaves a pool that changed after Shellway wrote it', () => {
    const script = removePoolScript(baseInput(), 'a'.repeat(64))
    expect(script).toContain(`!= '${'a'.repeat(64)}'`)
    expect(script).toContain('changed after Shellway wrote it')
  })
})
