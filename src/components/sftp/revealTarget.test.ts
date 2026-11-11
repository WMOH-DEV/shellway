import { describe, expect, it } from 'vitest'
import { baseName, splitRevealTarget } from './revealTarget'

describe('splitRevealTarget', () => {
  it('splits a file path into its folder and the file', () => {
    expect(splitRevealTarget('/var/www/shop/app/Order.php')).toEqual({
      directory: '/var/www/shop/app',
      file: '/var/www/shop/app/Order.php'
    })
  })

  it('treats a trailing slash as a folder to open', () => {
    expect(splitRevealTarget('/var/www/shop/')).toEqual({ directory: '/var/www/shop', file: null })
  })

  it('keeps files in the root folder in the root', () => {
    expect(splitRevealTarget('/index.php')).toEqual({ directory: '/', file: '/index.php' })
  })
})

describe('baseName', () => {
  it('returns the last path segment', () => {
    expect(baseName('/var/www/shop/Order.php')).toBe('Order.php')
  })
})
