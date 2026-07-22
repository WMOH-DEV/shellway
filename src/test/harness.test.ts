import { describe, expect, it } from 'vitest'
import { cn } from '@/utils/cn'

describe('node test project', () => {
  it('resolves the @ alias to src', () => {
    expect(cn('a', 'b')).toBe('a b')
  })

  it('runs without a DOM', () => {
    expect(typeof globalThis.document).toBe('undefined')
  })
})
