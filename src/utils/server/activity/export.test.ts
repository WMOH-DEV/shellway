import { describe, expect, it } from 'vitest'
import { activityToJson, activityToText, exportFileName } from './export'
import { activityEntry } from './fixtures/activityEntry'

describe('activity export', () => {
  it('writes JSON that reads back to the same entries', () => {
    const entries = [activityEntry()]
    expect(JSON.parse(activityToJson(entries))).toEqual(entries)
  })

  it('writes plain text with the header, commands, exit codes and indented output', () => {
    const entry = activityEntry({
      at: Date.UTC(2026, 10, 7, 9, 12),
      status: 'failed',
      failure: { kind: 'exit', stepId: 's2', message: 'Test the config failed' },
      steps: [{ label: 'Test the config', display: 'sudo -n php-fpm8.3 -t', output: 'ERROR: bad value\nline 2\n', exitCode: 78, status: 'failed' }]
    })
    expect(activityToText([entry])).toBe([
      '2026-11-07T09:12:00.000Z | Failed | software | you | 2s',
      'Changed PHP 8.3 memory_limit',
      'Failed: Test the config failed',
      '  [failed] Test the config (exit 78)',
      '  $ sudo -n php-fpm8.3 -t',
      '    ERROR: bad value',
      '    line 2'
    ].join('\n'))
  })

  it('separates entries with a blank line and omits empty durations and output', () => {
    const text = activityToText([
      activityEntry({ id: 'a', durationMs: 0, steps: [] }),
      activityEntry({ id: 'b', durationMs: 0, steps: [] })
    ])
    expect(text.split('\n\n')).toHaveLength(2)
    expect(text).not.toContain('| 0')
  })

  it('builds a safe, dated file name', () => {
    const now = Date.UTC(2026, 10, 7, 12)
    expect(exportFileName('Test server (prod)', 'json', now)).toBe('test-server-prod-activity-2026-11-07.json')
    expect(exportFileName('***', 'txt', now)).toBe('server-activity-2026-11-07.txt')
    expect(exportFileName('a'.repeat(100), 'txt', now)).toMatch(/^a{40}-activity-2026-11-07\.txt$/)
  })
})
