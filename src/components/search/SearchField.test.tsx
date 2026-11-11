import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'
import { useUIStore } from '@/stores/uiStore'
import { SearchButton } from './SearchField'

beforeEach(() => {
  useUIStore.setState({ searchOpen: false, searchInitial: '' })
})

describe('SearchButton', () => {
  it('shows a short label and the shortcut', () => {
    render(<SearchButton />)
    const button = screen.getByRole('button', { name: 'Search everything' })
    expect(button).toHaveTextContent(/^Search/)
    expect(button).not.toHaveTextContent('Search everything')
    expect(button.querySelector('kbd')).not.toBeNull()
  })

  it('opens the palette when clicked', () => {
    render(<SearchButton />)
    fireEvent.click(screen.getByRole('button', { name: 'Search everything' }))
    expect(useUIStore.getState().searchOpen).toBe(true)
  })
})
