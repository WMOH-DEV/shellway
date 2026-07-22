import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { mockNovadeck } from '@/test/novadeck'

describe('dom test project', () => {
  it('renders JSX and registers jest-dom matchers', () => {
    render(<button type="button">Run</button>)
    expect(screen.getByRole('button', { name: 'Run' })).toBeInTheDocument()
  })

  it('stubs any window.novadeck path without setup', async () => {
    mockNovadeck()
    await expect(window.novadeck.sql.disconnect('x')).resolves.toBeUndefined()
  })

  it('honours a dotted-path override', async () => {
    const configGetStandalone = vi.fn().mockResolvedValue(['a'])
    mockNovadeck({ 'sql.configGetStandalone': configGetStandalone })
    await expect(window.novadeck.sql.configGetStandalone()).resolves.toEqual(['a'])
    expect(configGetStandalone).toHaveBeenCalledOnce()
  })

  it('returns a synchronous unsubscribe function for on* leaves', () => {
    mockNovadeck()
    const unsubscribe = window.novadeck.sql.onQueryExecuted(() => {})
    expect(unsubscribe).not.toBeInstanceOf(Promise)
    expect(() => unsubscribe()).not.toThrow()
  })

  it('gives two calls to the same on* leaf distinct unsubscribe functions', () => {
    mockNovadeck()
    const first = window.novadeck.sql.onQueryExecuted(() => {})
    const second = window.novadeck.sql.onQueryExecuted(() => {})
    expect(first).not.toBe(second)
  })

  it('still resolves a non-on leaf as a promise', async () => {
    mockNovadeck()
    await expect(window.novadeck.sql.isConnected('x')).resolves.toBeUndefined()
  })

  it('honours a dotted-path override on an on* leaf', () => {
    const onQueryExecuted = vi.fn(() => vi.fn())
    mockNovadeck({ 'sql.onQueryExecuted': onQueryExecuted })
    window.novadeck.sql.onQueryExecuted(() => {})
    expect(onQueryExecuted).toHaveBeenCalledOnce()
  })
})
