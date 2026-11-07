import { describe, expect, it } from 'vitest'
import { commandsText, dayLabel, entryDetail, formatClock, formatDuration, groupByDay } from './format'
import { activityEntry } from './fixtures/activityEntry'

const at = (day: number, hour: number, minute = 0) => new Date(2026, 10, day, hour, minute).getTime()

describe('formatDuration', () => {
  it.each([
    [0, ''],
    [-5, ''],
    [400, '<1s'],
    [2000, '2s'],
    [41_400, '41s'],
    [60_000, '1m'],
    [72_000, '1m 12s'],
    [100_000, '1m 40s'],
    [3_600_000, '1h'],
    [3_900_000, '1h 5m']
  ])('formats %d ms as %j', (ms, text) => {
    expect(formatDuration(ms)).toBe(text)
  })
})

describe('day grouping', () => {
  it('formats the clock with leading zeros', () => {
    expect(formatClock(at(7, 3, 5))).toBe('03:05')
  })

  it('labels today, yesterday and older days', () => {
    const now = at(7, 18)
    expect(dayLabel(at(7, 0, 1), now)).toBe('Today')
    expect(dayLabel(at(6, 23, 59), now)).toBe('Yesterday')
    expect(dayLabel(at(3, 12), now)).toBe('Tue, Nov 3')
  })

  it('groups newest-first entries into consecutive days', () => {
    const entries = [
      activityEntry({ id: 'a', at: at(7, 9) }),
      activityEntry({ id: 'b', at: at(7, 3) }),
      activityEntry({ id: 'c', at: at(6, 22) }),
      activityEntry({ id: 'd', at: at(1, 10) })
    ]
    const days = groupByDay(entries, at(7, 18))
    expect(days.map((day) => [day.label, day.entries.map((entry) => entry.id)])).toEqual([
      ['Today', ['a', 'b']],
      ['Yesterday', ['c']],
      ['Sun, Nov 1', ['d']]
    ])
  })

  it('returns no groups for no entries', () => {
    expect(groupByDay([], at(7, 18))).toEqual([])
  })
})

describe('entry text', () => {
  it('describes a successful entry by its step labels', () => {
    expect(entryDetail(activityEntry())).toBe('Back up php.ini · Test the config')
  })

  it('describes a failed entry by its failure', () => {
    const entry = activityEntry({ status: 'failed', failure: { kind: 'exit', stepId: 's2', message: 'php-fpm8.3 -t exited with 78' } })
    expect(entryDetail(entry)).toBe('php-fpm8.3 -t exited with 78')
  })

  it('copies the commands without prompts so they can be pasted', () => {
    expect(commandsText(activityEntry())).toBe('sudo -n cp /etc/php/8.3/fpm/php.ini /home/deploy/.shellway/backups/php.ini\nsudo -n php-fpm8.3 -t')
  })
})
