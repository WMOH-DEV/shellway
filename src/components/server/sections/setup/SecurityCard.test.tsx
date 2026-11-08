import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { SECURITY_DEFAULTS } from '@/utils/server/setup/catalog'
import { SecurityCard } from './SecurityCard'

describe('SecurityCard', () => {
  it('offers a swap file sized by memory', () => {
    render(<SecurityCard security={SECURITY_DEFAULTS} swapGb={2} keyLogin onChange={vi.fn()} />)
    expect(screen.getByRole('switch', { name: '2 GB swap file' })).toBeEnabled()
  })

  it('locks the swap row off when swap is already on', () => {
    render(<SecurityCard security={SECURITY_DEFAULTS} swapGb={null} keyLogin onChange={vi.fn()} />)
    const toggle = screen.getByRole('switch', { name: 'Swap is already on' })
    expect(toggle).toBeDisabled()
    expect(toggle).not.toBeChecked()
  })
})
