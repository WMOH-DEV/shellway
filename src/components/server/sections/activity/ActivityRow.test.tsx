import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { activityEntry } from '@/utils/server/activity/fixtures/activityEntry'
import { ActivityRow } from './ActivityRow'

const failedEntry = activityEntry({
  status: 'failed',
  failure: { kind: 'exit', stepId: 's2', message: 'Test the config failed' },
  undo: { type: 'software.php-ini', params: { version: '8.3', key: 'memory_limit', value: '128M' } },
  steps: [
    { label: 'Back up php.ini', display: 'sudo -n cp a b', output: 'copied', exitCode: 0, status: 'done' },
    { label: 'Test the config', display: 'sudo -n php-fpm8.3 -t', output: 'ERROR: bad value', exitCode: 78, status: 'failed' }
  ]
})

function renderRow(canUndo = true, entry = failedEntry) {
  const onUndo = vi.fn()
  render(<ActivityRow entry={entry} open canUndo={canUndo} onToggle={() => {}} onUndo={onUndo} />)
  return onUndo
}

describe('ActivityRow', () => {
  it('opens the failed step and keeps the others closed', () => {
    renderRow()
    expect(screen.getByText('ERROR: bad value', { exact: false })).toBeInTheDocument()
    expect(screen.queryByText('copied', { exact: false })).not.toBeInTheDocument()
    expect(screen.getByText('exit 78')).toBeInTheDocument()
  })

  it('launches the undo for the entry', () => {
    const onUndo = renderRow()
    fireEvent.click(screen.getByRole('button', { name: 'Undo this change' }))
    expect(onUndo).toHaveBeenCalledWith(failedEntry)
  })

  it('disables undo while disconnected', () => {
    renderRow(false)
    expect(screen.getByRole('button', { name: 'Undo this change' })).toBeDisabled()
  })

  it('has no undo button when the entry cannot be undone', () => {
    renderRow(true, activityEntry())
    expect(screen.queryByRole('button', { name: 'Undo this change' })).not.toBeInTheDocument()
  })
})
