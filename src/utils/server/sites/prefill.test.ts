import { describe, expect, it } from 'vitest'
import { createPrefill } from './prefill'

describe('createPrefill', () => {
  it('keeps valid template, port and domain from a deep link', () => {
    expect(createPrefill({ template: 'compose', port: '3001', domain: ' Status.Example.com ' })).toEqual({ template: 'compose', appPort: 3001, domain: 'status.example.com' })
  })

  it('drops anything invalid', () => {
    expect(createPrefill({ template: 'rails', port: '70000', domain: 'not a domain' })).toEqual({})
    expect(createPrefill(undefined)).toEqual({})
  })
})
