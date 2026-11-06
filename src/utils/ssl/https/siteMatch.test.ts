import { describe, expect, it } from 'vitest'
import type { ServerBlock } from '../../../types/ssl'
import { blockForHostname, blockForSite } from './siteMatch'

const makeBlock = (overrides: Partial<ServerBlock>): ServerBlock => ({
  id: 'app.conf:1',
  file: '/etc/nginx/sites-enabled/app.conf',
  line: 1,
  names: ['app.example.com'],
  tls: true,
  certPath: '',
  keyPath: '',
  probeAddress: '127.0.0.1:443',
  root: null,
  ...overrides
})

const app = makeBlock({ id: 'app.conf:1', names: ['app.example.com'], root: '/var/www/app/current/public', tls: false })
const blog = makeBlock({ id: 'blog.conf:1', names: ['blog.example.com'], root: '/var/www/blog', tls: false })

describe('blockForSite', () => {
  it('matches a block whose root equals the site path', () => {
    const block = makeBlock({ id: 'x:1', root: '/var/www/blog' })
    expect(blockForSite({ path: '/var/www/blog', healthUrl: '' }, [app, block])).toBe(block)
  })

  it('matches a block whose root is under the site path, ignoring a trailing slash', () => {
    expect(blockForSite({ path: '/var/www/app/', healthUrl: '' }, [blog, app])).toBe(app)
  })

  it('does not treat a sibling folder with the same prefix as under the path', () => {
    expect(blockForSite({ path: '/var/www/ap', healthUrl: '' }, [app])).toBeNull()
  })

  it('falls back to the block naming the health URL host', () => {
    const noRoot = makeBlock({ id: 'n:1', names: ['www.example.org', 'example.org'], root: null })
    expect(blockForSite({ path: '/srv/other', healthUrl: 'https://Example.org/health' }, [app, noRoot])).toBe(noRoot)
  })

  it('returns null when neither the root nor the host matches', () => {
    expect(blockForSite({ path: '/srv/other', healthUrl: 'http://127.0.0.1:3000/up' }, [app, blog])).toBeNull()
    expect(blockForSite({ path: '', healthUrl: 'not a url' }, [app])).toBeNull()
  })

  it('prefers a block with TLS so a redirect-only block does not hide HTTPS', () => {
    const redirect = makeBlock({ id: 'r:1', names: ['app.example.com'], root: null, tls: false })
    const secure = makeBlock({ id: 's:1', names: ['app.example.com'], root: null, tls: true })
    expect(blockForSite({ path: '/srv/x', healthUrl: 'https://app.example.com/' }, [redirect, secure])).toBe(secure)
  })
})

describe('blockForHostname', () => {
  it('matches a typed name case-insensitively and trims it', () => {
    expect(blockForHostname('  APP.example.com ', [blog, app])).toBe(app)
  })

  it('returns null for an unknown or empty name', () => {
    expect(blockForHostname('missing.example.com', [app])).toBeNull()
    expect(blockForHostname('  ', [app])).toBeNull()
  })
})
