import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { DEFAULT_SETTINGS } from '@/types/settings'
import { SqlTabsSettings } from './SqlTabsSettings'

function renderSettings() {
  const update = vi.fn()
  const onOpenShortcuts = vi.fn()
  render(<SqlTabsSettings settings={DEFAULT_SETTINGS} update={update} onOpenShortcuts={onOpenShortcuts} />)
  return { update, onOpenShortcuts }
}

describe('SqlTabsSettings', () => {
  it('marks the single row layout as selected by default', () => {
    renderSettings()
    expect(screen.getByRole('radio', { name: /Single row/ })).toHaveAttribute('aria-checked', 'true')
    expect(screen.getByRole('radio', { name: /Vertical list/ })).toHaveAttribute('aria-checked', 'false')
  })

  it('updates the layout when a card is clicked', async () => {
    const { update } = renderSettings()
    await userEvent.click(screen.getByRole('radio', { name: /Vertical list/ }))
    expect(update).toHaveBeenCalledWith('sqlTabLayout', 'vertical')
  })

  it('turns preview tabs off from the switch', async () => {
    const { update } = renderSettings()
    await userEvent.click(screen.getByRole('switch', { name: 'Preview tabs' }))
    expect(update).toHaveBeenCalledWith('sqlPreviewTabs', false)
  })

  it('stores the tab limit as a number', async () => {
    const { update } = renderSettings()
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Limit open tabs' }), 'No limit')
    expect(update).toHaveBeenCalledWith('sqlTabLimit', 0)
  })

  it('lists the tab shortcuts', () => {
    renderSettings()
    expect(screen.getByText('Reopen closed tab')).toBeInTheDocument()
  })

  it('opens the shortcuts section from the link', async () => {
    const { onOpenShortcuts } = renderSettings()
    await userEvent.click(screen.getByRole('button', { name: 'Change in Shortcuts' }))
    expect(onOpenShortcuts).toHaveBeenCalledTimes(1)
  })
})
