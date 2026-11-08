import { execFileSync } from 'node:child_process'
import { describe, expect, it } from 'vitest'
import { LARAVEL_LOG, parseTail, tailScript, validLogRequest } from './logs'

describe('validLogRequest', () => {
  it('accepts app logs inside the site and web server logs under /var/log', () => {
    expect(validLogRequest({ site: 'app', source: 'app', file: LARAVEL_LOG, lines: 9999 })).toEqual({ site: 'app', source: 'app', file: LARAVEL_LOG, lines: 500 })
    expect(validLogRequest({ site: 'app', source: 'error', file: '/var/log/nginx/error.log' }).lines).toBe(200)
  })

  it('rejects paths that escape the allow-list', () => {
    expect(() => validLogRequest({ site: 'app', source: 'app', file: '../../etc/shadow' })).toThrow('not allowed')
    expect(() => validLogRequest({ site: 'app', source: 'app', file: '/etc/shadow' })).toThrow('not allowed')
    expect(() => validLogRequest({ site: 'app', source: 'error', file: '/var/log/nginx/../auth.log' })).toThrow('not allowed')
    expect(() => validLogRequest({ site: 'app', source: 'access', file: '/var/log/auth.log' })).toThrow('not allowed')
    expect(() => validLogRequest({ site: 'App;', source: 'app', file: LARAVEL_LOG })).toThrow('Invalid site name')
    expect(() => validLogRequest({ site: 'app', source: 'other', file: LARAVEL_LOG })).toThrow('Invalid log source')
  })
})

describe('tailScript', () => {
  it('reads the site folder from the deploy config and never uses plain sudo', () => {
    const script = tailScript({ site: 'app', source: 'app', file: LARAVEL_LOG, lines: 200 })
    expect(script).toContain('"$HOME/.shellway-deploy/sites/app/site.conf"')
    expect(script).toContain('f="$base/storage/logs/laravel.log"')
    expect(script).not.toMatch(/sudo (?!-n)/)
    expect(() => execFileSync('sh', ['-n'], { input: script })).not.toThrow()
  })

  it('tails a web server log directly', () => {
    const script = tailScript({ site: 'app', source: 'error', file: '/var/log/nginx/error.log', lines: 50 })
    expect(script.split('\n')[0]).toBe("f='/var/log/nginx/error.log'")
    expect(script).toContain('tail -n 50 -- "$f"')
  })
})

describe('parseTail', () => {
  it('maps markers to states', () => {
    expect(parseTail('@@missing\n')).toEqual({ state: 'missing' })
    expect(parseTail('@@unknown-site\n')).toEqual({ state: 'unknown-site' })
    expect(parseTail('@@no-permission\n')).toEqual({ state: 'no-permission' })
    expect(parseTail('line 1\nline 2\n')).toEqual({ state: 'ok', text: 'line 1\nline 2\n' })
  })
})
