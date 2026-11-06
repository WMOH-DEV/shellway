import { describe, it, expect } from 'vitest'
import type { DeployStep } from '@/types/deploy'
import {
  appendNewSteps,
  blankStep,
  duplicateStep,
  formatLimit,
  moveStep,
  moveToOtherStage,
  parseLimit,
  presetStepsFor,
  presetsWithSteps,
  removeStep,
  stepFlag,
  updateStep
} from './pipelineSteps'

const step = (command: string, extra: Partial<DeployStep> = {}): DeployStep => ({ ...blankStep(command), ...extra })
const commands = (steps: DeployStep[]) => steps.map((s) => s.command)

describe('editing step lists', () => {
  const steps = [step('a'), step('b'), step('c')]

  it('moves a step to a new position', () => {
    expect(commands(moveStep(steps, 0, 2))).toEqual(['b', 'c', 'a'])
    expect(commands(moveStep(steps, 2, 0))).toEqual(['c', 'a', 'b'])
  })

  it('ignores moves outside the list or onto the same place', () => {
    expect(moveStep(steps, 0, -1)).toBe(steps)
    expect(moveStep(steps, 2, 3)).toBe(steps)
    expect(moveStep(steps, 1, 1)).toBe(steps)
  })

  it('updates only the chosen step', () => {
    const next = updateStep(steps, 1, { optional: true, timeoutSeconds: 60 })
    expect(next[1]).toEqual({ command: 'b', optional: true, timeoutSeconds: 60 })
    expect(next[0]).toBe(steps[0])
  })

  it('removes a step', () => {
    expect(commands(removeStep(steps, 1))).toEqual(['a', 'c'])
  })

  it('duplicates a step right after the original as a separate object', () => {
    const copy = duplicateStep([step('a', { timeoutSeconds: 30 }), step('b')], 0)
    expect(commands(copy)).toEqual(['a', 'a', 'b'])
    expect(copy[1]).toEqual(copy[0])
    expect(copy[1]).not.toBe(copy[0])
  })

  it('appends only commands that are not already there', () => {
    expect(commands(appendNewSteps(steps, [step('b'), step('d')]))).toEqual(['a', 'b', 'c', 'd'])
  })

  it('moves a step into the other list', () => {
    const { source, target } = moveToOtherStage(steps, [step('x')], 1)
    expect(commands(source)).toEqual(['a', 'c'])
    expect(commands(target)).toEqual(['x', 'b'])
  })

  it('creates a required step without a limit', () => {
    expect(blankStep()).toEqual({ command: '', optional: false, timeoutSeconds: null })
  })
})

describe('presets as step sources', () => {
  it('returns the commands a preset runs in a stage', () => {
    expect(commands(presetStepsFor('buildSteps', 'node'))).toEqual(['npm ci'])
    expect(commands(presetStepsFor('activateSteps', 'laravel'))).toContain('php artisan migrate --force')
  })

  it('lists only presets that have commands for the stage', () => {
    const build = presetsWithSteps('buildSteps').map((p) => p.id)
    const activate = presetsWithSteps('activateSteps').map((p) => p.id)
    expect(build).toEqual(expect.arrayContaining(['laravel', 'php', 'node']))
    expect(build).not.toContain('static')
    expect(activate).toEqual(expect.arrayContaining(['laravel', 'compose']))
    expect(activate).not.toContain('node')
  })
})

describe('command flags', () => {
  const needs = ['/usr/bin/systemctl reload php8.3-fpm']

  it('marks sudo commands that the server has no sudoers line for', () => {
    expect(stepFlag(step('sudo systemctl reload php8.3-fpm'), needs)).toEqual({ label: 'needs sudoers line', tone: 'warning' })
  })

  it('marks other sudo commands as needing sudo', () => {
    expect(stepFlag(step('sudo systemctl restart nginx'), needs)).toEqual({ label: 'needs sudo', tone: 'muted' })
    expect(stepFlag(step('sudo systemctl reload php8.3-fpm'), [])).toEqual({ label: 'needs sudo', tone: 'muted' })
  })

  it('does not flag commands that only mention sudo', () => {
    expect(stepFlag(step('npm run build'), needs)).toBeNull()
    expect(stepFlag(step('echo sudo hello'), needs)).toBeNull()
    expect(stepFlag(step('sudoedit x'), needs)).toBeNull()
  })
})

describe('time limit text', () => {
  it.each<[number | null, string]>([[null, ''], [30, '30s'], [90, '90s'], [120, '2m'], [600, '10m'], [3600, '1h'], [5400, '90m']])(
    'formats %s as %j',
    (seconds, text) => expect(formatLimit(seconds)).toBe(text)
  )

  it.each<[string, number | null]>([
    ['', null],
    ['  ', null],
    ['10m', 600],
    ['90s', 90],
    ['2h', 7200],
    ['15', 900],
    ['1 h', 3600],
    ['5M', 300]
  ])('reads %j as %s seconds', (text, seconds) => expect(parseLimit(text)).toBe(seconds))

  it.each(['abc', '0', '0m', '-5m', '1.5h', '25h', '86401s', '10 minutes'])('rejects %j', (text) => {
    expect(parseLimit(text)).toBeUndefined()
  })

  it('accepts exactly one day', () => {
    expect(parseLimit('24h')).toBe(86_400)
  })

  it('round-trips every formatted value', () => {
    for (const seconds of [1, 59, 60, 61, 3599, 3600, 7260, 86_400]) {
      expect(parseLimit(formatLimit(seconds))).toBe(seconds)
    }
  })
})
