import { describe, expect, it } from 'vitest'
import { decodeServerText, hasUnreadableText } from './serverText'

const b64 = (bytes: number[] | string): string => Buffer.from(typeof bytes === 'string' ? Buffer.from(bytes) : Uint8Array.from(bytes)).toString('base64')

describe('decodeServerText', () => {
  it('reads valid UTF-8, including a real replacement character, as readable', () => {
    const text = decodeServerText(b64('APP_NAME=Caf�\n'))
    expect(text).toBe('APP_NAME=Caf�\n')
    expect(hasUnreadableText(text)).toBe(false)
  })

  it('marks text that is not valid UTF-8 as unreadable', () => {
    expect(hasUnreadableText(decodeServerText(b64([0x63, 0x61, 0x66, 0xe9, 0x0a])))).toBe(true)
  })

  it('drops a byte-order mark and Windows line endings so parsers see plain lines', () => {
    expect(decodeServerText(b64('﻿a=1\r\nb=2\r\n'))).toBe('a=1\nb=2\n')
  })

  it('returns an empty string for an empty file', () => {
    expect(decodeServerText('')).toBe('')
  })
})
