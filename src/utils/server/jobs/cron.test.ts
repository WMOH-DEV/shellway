import { describe, expect, it } from 'vitest'
import { describeCron, formatRun, nextRuns, parseCron, presetExpression, presetOf, safeTimeZone, type ParsedCron } from './cron'

const parsed = (expression: string): ParsedCron => {
  const result = parseCron(expression)
  if (!result.ok) throw new Error(result.error)
  return result.cron
}

const values = (expression: string, field: 'minute' | 'hour' | 'day' | 'month' | 'weekday'): number[] => {
  const cron = parsed(expression)
  if (cron.reboot) throw new Error('reboot')
  return [...cron[field].values].sort((a, b) => a - b)
}

describe('parseCron', () => {
  it('reads ranges, steps, lists and names', () => {
    expect(values('*/15 * * * *', 'minute')).toEqual([0, 15, 30, 45])
    expect(values('0 9-17/4 * * *', 'hour')).toEqual([9, 13, 17])
    expect(values('0 0 1,15 * *', 'day')).toEqual([1, 15])
    expect(values('0 0 * jan-mar *', 'month')).toEqual([1, 2, 3])
    expect(values('0 0 * * mon-fri', 'weekday')).toEqual([1, 2, 3, 4, 5])
    expect(values('0 0 * * 7', 'weekday')).toEqual([0])
  })

  it('expands macros and knows @reboot', () => {
    expect(values('@hourly', 'minute')).toEqual([0])
    expect(values('@daily', 'hour')).toEqual([0])
    expect(parsed('@reboot')).toEqual({ reboot: true })
  })

  it.each([
    ['* * * *', 'A schedule has 5 parts'],
    ['60 * * * *', 'minute must be between 0 and 59'],
    ['* 24 * * *', 'hour must be between 0 and 23'],
    ['5/10 * * * *', 'needs a range or * before the step'],
    ['*/0 * * * *', 'not a valid step'],
    ['5-1 * * * *', 'runs backwards'],
    ['* * * foo *', 'not a valid month'],
    ['@sometimes', 'not a known schedule']
  ])('rejects %s', (expression, message) => {
    const result = parseCron(expression)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toContain(message)
  })
})

describe('describeCron', () => {
  it.each([
    ['* * * * *', 'Every minute'],
    ['*/5 * * * *', 'Every 5 minutes'],
    ['0 * * * *', 'Every hour'],
    ['15 * * * *', 'Every hour at :15'],
    ['0 */12 * * *', 'Every 12 hours'],
    ['0 3 * * *', 'Every day at 03:00'],
    ['30 6 * * *', 'Every day at 06:30'],
    ['0 0,12 * * *', 'Every day at 00:00 and 12:00'],
    ['0 3 * * 1', 'Every Monday at 03:00'],
    ['0 3 * * 1-5', 'Weekdays at 03:00'],
    ['0 3 * * 1,3', 'Every Mon and Wed at 03:00'],
    ['0 3 1 * *', 'Monthly on day 1 at 03:00'],
    ['0 3 25 12 *', 'Every year on Dec 25 at 03:00'],
    ['@daily', 'Every day at 00:00'],
    ['@reboot', 'At startup'],
    ['1-5 2-4 * * *', 'Custom schedule'],
    ['nope', 'Invalid schedule']
  ])('%s → %s', (expression, text) => {
    expect(describeCron(expression)).toBe(text)
  })
})

describe('nextRuns', () => {
  const now = new Date('2026-11-07T05:00:30Z')

  it('lists the next 3 daily runs in UTC', () => {
    expect(nextRuns(parsed('30 6 * * *'), now, 'UTC').map((run) => run.toISOString())).toEqual([
      '2026-11-07T06:30:00.000Z',
      '2026-11-08T06:30:00.000Z',
      '2026-11-09T06:30:00.000Z'
    ])
  })

  it('starts from the next minute', () => {
    expect(nextRuns(parsed('* * * * *'), now, 'UTC', 2).map((run) => run.toISOString())).toEqual(['2026-11-07T05:01:00.000Z', '2026-11-07T05:02:00.000Z'])
  })

  it('uses the server timezone', () => {
    expect(nextRuns(parsed('0 9 * * *'), now, 'Europe/Berlin', 1)[0].toISOString()).toBe('2026-11-07T08:00:00.000Z')
  })

  it('skips a time that does not exist when clocks go forward', () => {
    const before = new Date('2026-03-28T12:00:00Z')
    const runs = nextRuns(parsed('30 2 * * *'), before, 'Europe/Berlin', 2).map((run) => run.toISOString())
    expect(runs).toEqual(['2026-03-30T00:30:00.000Z', '2026-03-31T00:30:00.000Z'])
  })

  it('ORs day of month and day of week when both are set', () => {
    const runs = nextRuns(parsed('0 0 13 * 5'), new Date('2026-11-01T00:00:00Z'), 'UTC', 3).map((run) => run.toISOString().slice(0, 10))
    expect(runs).toEqual(['2026-11-06', '2026-11-13', '2026-11-20'])
  })

  it('finds rare dates', () => {
    expect(nextRuns(parsed('0 0 29 2 *'), now, 'UTC', 1)[0].toISOString()).toBe('2028-02-29T00:00:00.000Z')
  })

  it('has no runs for @reboot', () => {
    expect(nextRuns(parsed('@reboot'), now, 'UTC')).toEqual([])
  })
})

describe('formatRun', () => {
  const now = new Date('2026-11-07T05:00:00Z')
  it('says today, tomorrow or the date', () => {
    expect(formatRun(new Date('2026-11-07T06:30:00Z'), now, 'UTC')).toBe('today 06:30')
    expect(formatRun(new Date('2026-11-08T06:30:00Z'), now, 'UTC')).toBe('tomorrow 06:30')
    expect(formatRun(new Date('2026-11-09T06:30:00Z'), now, 'UTC')).toBe('Nov 9 06:30')
  })
})

describe('presets', () => {
  const input = { time: '06:30', weekday: 1, day: 15 }
  it('builds expressions', () => {
    expect(presetExpression('minute', input)).toBe('* * * * *')
    expect(presetExpression('five', input)).toBe('*/5 * * * *')
    expect(presetExpression('hourly', input)).toBe('0 * * * *')
    expect(presetExpression('daily', input)).toBe('30 6 * * *')
    expect(presetExpression('weekly', input)).toBe('30 6 * * 1')
    expect(presetExpression('monthly', input)).toBe('30 6 15 * *')
    expect(presetExpression('daily', { ...input, time: '25:00' })).toBeNull()
  })

  it('reads a preset back from an expression', () => {
    expect(presetOf('30 6 * * *')).toEqual({ preset: 'daily', input: { time: '06:30', weekday: 1, day: 1 } })
    expect(presetOf('0 3 * * 5').preset).toBe('weekly')
    expect(presetOf('0 3 10 * *').input.day).toBe(10)
    expect(presetOf('*/5 * * * *').preset).toBe('five')
    expect(presetOf('0 */2 * * *').preset).toBe('custom')
  })

  it('falls back to UTC for unknown timezones', () => {
    expect(safeTimeZone('Not/AZone')).toBe('UTC')
    expect(safeTimeZone(undefined)).toBe('UTC')
    expect(safeTimeZone('Asia/Tokyo')).toBe('Asia/Tokyo')
  })
})
