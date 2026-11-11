import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { mockNovadeck } from '@/test/novadeck'
import { useUIStore } from '@/stores/uiStore'
import { DEFAULT_SETTINGS, type AppSettings } from '@/types/settings'
import { SearchSettings, formatBytes } from './SearchSettings'
import { SettingsView } from './SettingsView'

const clearSearchCache = vi.hoisted(() => vi.fn(async () => undefined))

vi.mock('@/search/cacheClient', () => ({ clearSearchCache }))

function renderSettings(overrides: Partial<AppSettings> = {}) {
  const update = vi.fn()
  const cacheStats = vi.fn(async () => ({ entries: 1234, bytes: 2048 }))
  mockNovadeck({ 'search.cacheStats': cacheStats })
  render(<SearchSettings settings={{ ...DEFAULT_SETTINGS, ...overrides }} update={update} />)
  return { update, cacheStats }
}

describe('SearchSettings', () => {
  beforeEach(() => {
    clearSearchCache.mockClear()
  })

  it('shows every scope switched on by default', () => {
    renderSettings()
    for (const label of ['Servers', 'Tables', 'Queries', 'Files', 'Commands', 'Sites', 'History', 'Settings']) {
      expect(screen.getByRole('switch', { name: `Search ${label}` })).toHaveAttribute('aria-checked', 'true')
    }
  })

  it('turns a scope off by adding it to the disabled list', async () => {
    const { update } = renderSettings({ searchDisabledScopes: ['files'] })
    await userEvent.click(screen.getByRole('switch', { name: 'Search Tables' }))
    expect(update).toHaveBeenCalledWith('searchDisabledScopes', ['files', 'tables'])
  })

  it('turns a scope back on by removing it from the disabled list', async () => {
    const { update } = renderSettings({ searchDisabledScopes: ['files', 'tables'] })
    expect(screen.getByRole('switch', { name: 'Search Files' })).toHaveAttribute('aria-checked', 'false')
    await userEvent.click(screen.getByRole('switch', { name: 'Search Files' }))
    expect(update).toHaveBeenCalledWith('searchDisabledScopes', ['tables'])
  })

  it('writes the excluded folders', async () => {
    const { update } = renderSettings({ searchExcludeGlobs: 'vendor' })
    await userEvent.type(screen.getByLabelText('Skipped when searching text in files'), 's')
    expect(update).toHaveBeenCalledWith('searchExcludeGlobs', 'vendors')
  })

  it('shows the index size', async () => {
    renderSettings()
    expect(await screen.findByText('1,234 entries · 2.0 KB')).toBeInTheDocument()
  })

  it('asks for confirmation, clears the index and refreshes the size', async () => {
    const { cacheStats } = renderSettings()
    await screen.findByText('1,234 entries · 2.0 KB')
    await userEvent.click(screen.getByRole('button', { name: 'Clear search index' }))
    expect(clearSearchCache).not.toHaveBeenCalled()
    await userEvent.click(await screen.findByRole('button', { name: 'Clear' }))
    await waitFor(() => expect(clearSearchCache).toHaveBeenCalledTimes(1))
    await waitFor(() => expect(cacheStats).toHaveBeenCalledTimes(2))
  })

  it('does not clear when the confirmation is cancelled', async () => {
    renderSettings()
    await userEvent.click(screen.getByRole('button', { name: 'Clear search index' }))
    await userEvent.click(await screen.findByRole('button', { name: 'Cancel' }))
    expect(clearSearchCache).not.toHaveBeenCalled()
  })
})

describe('formatBytes', () => {
  it('scales to the largest fitting unit', () => {
    expect(formatBytes(0)).toBe('0 B')
    expect(formatBytes(1536)).toBe('1.5 KB')
    expect(formatBytes(5 * 1024 * 1024)).toBe('5.0 MB')
    expect(formatBytes(120 * 1024)).toBe('120 KB')
  })
})

describe('SettingsView search section', () => {
  it('opens on the Search section when requested and clears the request', async () => {
    mockNovadeck({
      'settings.getAll': vi.fn(async () => DEFAULT_SETTINGS),
      'search.cacheStats': vi.fn(async () => ({ entries: 3, bytes: 100 }))
    })
    useUIStore.setState({ settingsSection: 'search' })
    render(<SettingsView open onClose={() => {}} />)
    expect(await screen.findByRole('switch', { name: 'Search Servers' })).toBeInTheDocument()
    expect(useUIStore.getState().settingsSection).toBeNull()
  })

  it('writes a scope change through the settings API', async () => {
    const settingsUpdate = vi.fn(async () => undefined)
    mockNovadeck({
      'settings.getAll': vi.fn(async () => DEFAULT_SETTINGS),
      'settings.update': settingsUpdate,
      'search.cacheStats': vi.fn(async () => ({ entries: 0, bytes: 0 }))
    })
    useUIStore.setState({ settingsSection: 'search' })
    render(<SettingsView open onClose={() => {}} />)
    await userEvent.click(await screen.findByRole('switch', { name: 'Search Sites' }))
    expect(settingsUpdate).toHaveBeenCalledWith({ searchDisabledScopes: ['sites'] })
  })
})
