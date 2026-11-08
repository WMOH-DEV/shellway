import { describe, expect, it } from 'vitest'
import { makeBlock } from '../testReport'
import { siteOptions } from './siteOptions'

const app = makeBlock({ id: 'app.conf:1', file: '/etc/nginx/sites-enabled/app.conf', names: ['app.example.com'], root: '/var/www/app/public', tls: false })
const blog = makeBlock({ id: 'blog.conf:1', file: '/etc/nginx/sites-enabled/blog.conf', names: ['blog.example.com'], root: null, tls: false })
const secure = makeBlock({ id: 'shop.conf:1', names: ['shop.example.com'], tls: true })
const redirect = makeBlock({ id: 'shop.conf:9', names: ['shop.example.com'], tls: false })

const site = { name: 'example-app', path: '/var/www/app', healthUrl: 'https://app.example.com/up' }

describe('siteOptions', () => {
  it('lists Deploy sites first, then nginx blocks without a certificate', () => {
    const options = siteOptions([site], [blog, app], null)
    expect(options.map((o) => [o.kind, o.title, o.id])).toEqual([
      ['deploy', 'example-app', 'app.conf:1'],
      ['nginx', 'blog.example.com', 'blog.conf:1']
    ])
    expect(options[0].detail).toBe('/var/www/app · app.conf')
    expect(options[1].detail).toBe('blog.conf · no certificate')
  })

  it('leaves out blocks that already have TLS and redirect-only blocks of secured names', () => {
    expect(siteOptions([], [secure, redirect, blog], null).map((o) => o.id)).toEqual(['blog.conf:1'])
  })

  it('keeps the pre-selected block even when it has TLS', () => {
    expect(siteOptions([], [secure, blog], 'shop.conf:1').map((o) => o.id)).toEqual(['shop.conf:1', 'blog.conf:1'])
  })

  it('ignores Deploy sites without a block and lists a shared block once', () => {
    const other = { name: 'other', path: '/srv/none', healthUrl: '' }
    const twin = { name: 'twin', path: '/var/www/app', healthUrl: '' }
    expect(siteOptions([other, site, twin], [app], null).map((o) => o.title)).toEqual(['example-app'])
  })
})
