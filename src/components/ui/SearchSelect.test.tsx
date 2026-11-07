import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { SearchSelect } from './SearchSelect'

const MANY = ['bcmath', 'curl', 'gd', 'intl', 'mbstring', 'mysql', 'redis', 'zip'].map((name) => ({ value: name, label: name }))
const FEW = [
  { value: 'a', label: 'Alpha' },
  { value: 'b', label: 'Beta', disabled: true },
  { value: 'c', label: 'Gamma' }
]

function setup(props: Partial<React.ComponentProps<typeof SearchSelect>> = {}) {
  const onChange = vi.fn()
  render(<SearchSelect value="" onChange={onChange} options={MANY} placeholder="Pick one" aria-label="Extension" {...props} />)
  return { onChange, user: userEvent.setup(), trigger: screen.getByRole('button', { name: 'Extension' }) }
}

describe('SearchSelect', () => {
  it('shows the placeholder, then the selected label', () => {
    const { trigger } = setup()
    expect(trigger).toHaveTextContent('Pick one')
    expect(trigger).toHaveAttribute('aria-haspopup', 'listbox')
    expect(trigger).toHaveAttribute('aria-expanded', 'false')
  })

  it('shows the label of the current value', () => {
    const { trigger } = setup({ value: 'gd' })
    expect(trigger).toHaveTextContent('gd')
  })

  it('opens on click and lists every option', async () => {
    const { user, trigger } = setup()
    await user.click(trigger)
    expect(trigger).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByRole('listbox')).toBeInTheDocument()
    expect(screen.getAllByRole('option')).toHaveLength(MANY.length)
    expect(screen.getByRole('combobox')).toHaveFocus()
  })

  it('filters by a case-insensitive substring and shows an empty state', async () => {
    const { user, trigger } = setup()
    await user.click(trigger)
    await user.type(screen.getByRole('combobox'), 'MB')
    expect(screen.getAllByRole('option').map((option) => option.textContent)).toEqual(['mbstring'])
    await user.clear(screen.getByRole('combobox'))
    await user.type(screen.getByRole('combobox'), 'zzz')
    expect(screen.queryAllByRole('option')).toHaveLength(0)
    expect(screen.getByText('No matches')).toBeInTheDocument()
  })

  it('selects with the keyboard and returns focus to the trigger', async () => {
    const { user, trigger, onChange } = setup()
    await user.click(trigger)
    await user.keyboard('{ArrowDown}{Enter}')
    expect(onChange).toHaveBeenCalledWith('curl')
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
    expect(trigger).toHaveFocus()
  })

  it('points aria-activedescendant at the highlighted option', async () => {
    const { user, trigger } = setup()
    await user.click(trigger)
    await user.keyboard('{ArrowDown}')
    const active = document.getElementById(screen.getByRole('combobox').getAttribute('aria-activedescendant') as string)
    expect(active).toHaveTextContent('curl')
  })

  it('selects by clicking and passes the value directly', async () => {
    const { user, trigger, onChange } = setup()
    await user.click(trigger)
    await user.click(screen.getByRole('option', { name: 'redis' }))
    expect(onChange).toHaveBeenCalledWith('redis')
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
  })

  it('marks the selected option', async () => {
    const { user, trigger } = setup({ value: 'gd' })
    await user.click(trigger)
    expect(screen.getByRole('option', { name: 'gd' })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByRole('option', { name: 'zip' })).toHaveAttribute('aria-selected', 'false')
  })

  it('closes on Escape and refocuses the trigger', async () => {
    const { user, trigger } = setup()
    await user.click(trigger)
    await user.keyboard('{Escape}')
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
    expect(trigger).toHaveFocus()
  })

  it('closes on Tab and on outside click', async () => {
    const { user, trigger } = setup()
    await user.click(trigger)
    await user.keyboard('{Tab}')
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
    await user.click(trigger)
    fireEvent.mouseDown(document.body)
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
  })

  it('opens with typed text when the closed trigger has focus', async () => {
    const { user, trigger } = setup()
    trigger.focus()
    await user.keyboard('re')
    expect(screen.getByRole('combobox')).toHaveValue('re')
    expect(screen.getAllByRole('option').map((option) => option.textContent)).toEqual(['redis'])
  })

  it('does not select a disabled option', async () => {
    const { user, trigger, onChange } = setup({ options: FEW })
    await user.click(trigger)
    await user.click(screen.getByRole('option', { name: 'Beta' }))
    expect(onChange).not.toHaveBeenCalled()
    expect(screen.getByRole('listbox')).toBeInTheDocument()
  })

  it('skips disabled options with the arrow keys', async () => {
    const { user, trigger, onChange } = setup({ options: FEW })
    await user.click(trigger)
    await user.keyboard('{ArrowDown}{Enter}')
    expect(onChange).toHaveBeenCalledWith('c')
  })

  it('hides the search box for short lists but keeps keyboard navigation', async () => {
    const { user, trigger, onChange } = setup({ options: FEW })
    await user.click(trigger)
    expect(screen.getByRole('combobox')).toHaveClass('sr-only')
    await user.keyboard('{Enter}')
    expect(onChange).toHaveBeenCalledWith('a')
  })

  it('associates the label with the trigger', () => {
    render(<SearchSelect label="Protocol" value="a" onChange={() => {}} options={FEW} />)
    expect(screen.getByLabelText('Protocol')).toHaveTextContent('Alpha')
  })

  it('does not open when disabled', async () => {
    const { user, trigger } = setup({ disabled: true })
    await user.click(trigger)
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
  })
})
