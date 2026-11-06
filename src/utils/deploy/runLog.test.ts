import { describe, it, expect } from 'vitest'
import { failedStep, filterSections, parseRunLog, plainLogText, stepResult } from './runLog'
import { failureView, skippedRows, stageTime, stageViews } from './runSummary'
import { makeRecord, makeSummary } from './testSummary'

const M = '\x1e'

const failedBuildLog = [
  `${M}100 phase fetch`,
  '[10:00:00] deploy example-app (releases, auto, trigger auto)',
  '[10:00:00] fetching main from git@example.com:acme/example-app.git',
  '[10:00:02] commit abc123',
  `${M}102 phase build`,
  `${M}102 step R`,
  '[10:00:02] $ composer install',
  'Installing dependencies from lock file',
  'Your lock file does not contain a compatible set of packages.',
  `${M}140 end 2`,
  '[10:00:40] step failed (exit 2)',
  '[10:00:40] deploy failed',
  ''
].join('\n')

describe('parseRunLog', () => {
  it('groups lines by stage and command and records exit codes and times', () => {
    const parsed = parseRunLog(failedBuildLog)
    expect(parsed.structured).toBe(true)
    expect(parsed.stageStarts).toEqual({ fetch: 100, build: 102 })
    expect(parsed.sections.map((s) => [s.kind, s.stage, s.command, s.exitCode, s.lines.length])).toEqual([
      ['stage', 'fetch', '', null, 3],
      ['step', 'build', 'composer install', 2, 3],
      ['stage', 'build', '', null, 1]
    ])
    const step = parsed.sections[1]
    expect([step.started, step.ended]).toEqual([102, 140])
    expect(step.lines[2]).toEqual({ n: 6, time: '10:00:40', text: 'step failed (exit 2)', tone: 'error' })
  })

  it('numbers lines without the markers and keeps runner times separate from the text', () => {
    const parsed = parseRunLog(failedBuildLog)
    expect(parsed.sections[0].lines[0]).toEqual({ n: 1, time: '10:00:00', text: 'deploy example-app (releases, auto, trigger auto)', tone: 'plain' })
    expect(parsed.sections[1].lines[0]).toEqual({ n: 4, time: '', text: 'Installing dependencies from lock file', tone: 'plain' })
  })

  it('marks error and warning lines', () => {
    const parsed = parseRunLog('npm ERR! code ENOENT\nwarning: shared path .env does not exist yet\nall good\nPermission denied (publickey)\n')
    expect(parsed.sections[0].lines.map((l) => l.tone)).toEqual(['error', 'warning', 'plain', 'error'])
  })

  it('treats a log without markers as one unstructured block', () => {
    const parsed = parseRunLog('[10:00:00] $ echo hi\nhi\n')
    expect(parsed.structured).toBe(false)
    expect(parsed.sections).toHaveLength(1)
    expect(parsed.sections[0].lines).toHaveLength(2)
  })

  it('handles an empty log and a command that is still running', () => {
    expect(parseRunLog('').sections).toEqual([])
    const running = parseRunLog(`${M}100 phase build\n${M}100 step O\n[10:00:00] $ sleep 5\n`)
    expect(stepResult(running.sections[0])).toBe('running')
    expect(running.sections[0].optional).toBe(true)
  })

  it('finds the last required command that failed, ignoring optional ones', () => {
    const log = `${M}1 phase build\n${M}1 step O\n[x] $ lint\n${M}2 end 1\n${M}2 step R\n[x] $ build\n${M}3 end 0\n`
    const parsed = parseRunLog(log)
    expect(failedStep(parsed)).toBeUndefined()
    expect(parsed.sections.map(stepResult)).toEqual(['warning', 'ok'])
    expect(failedStep(parseRunLog(failedBuildLog))?.command).toBe('composer install')
  })
})

describe('plainLogText', () => {
  it('drops the marker lines', () => {
    expect(plainLogText(`${M}1 phase fetch\nhello\n${M}2 end 0\nbye`)).toBe('hello\nbye')
  })
})

describe('filterSections', () => {
  const sections = parseRunLog(failedBuildLog).sections

  it('keeps every line when there is no filter', () => {
    expect(filterSections(sections, { query: '', errorsOnly: false })).toBe(sections)
  })

  it('keeps matching lines, or the whole section when its command matches', () => {
    const byLine = filterSections(sections, { query: 'lock file', errorsOnly: false })
    expect(byLine.map((s) => s.lines.map((l) => l.n))).toEqual([[4, 5]])
    const byCommand = filterSections(sections, { query: 'composer', errorsOnly: false })
    expect(byCommand.map((s) => s.lines.length)).toEqual([3])
  })

  it('shows only error lines when asked', () => {
    const errors = filterSections(sections, { query: '', errorsOnly: true })
    expect(errors.flatMap((s) => s.lines.map((l) => l.text))).toEqual(['step failed (exit 2)', 'deploy failed'])
  })
})

describe('stageViews', () => {
  const config = makeSummary({ config: { healthUrl: 'https://example.com/up', activateSteps: [{ command: 'php artisan migrate', optional: false }] } }).config

  it('shows each stage with its time, the failed stage and the ones that never ran', () => {
    const record = makeRecord({ status: 'failed', started: 100, finished: 141 })
    const views = stageViews(parseRunLog(failedBuildLog), record, config, 200, false)
    expect(views.map((v) => [v.label, v.state, stageTime(v)])).toEqual([
      ['Fetch', 'done', '2s'],
      ['Build', 'failed', '39s'],
      ['Go live', 'skipped', 'skipped'],
      ['After live', 'skipped', 'skipped'],
      ['Health', 'skipped', 'skipped']
    ])
  })

  it('shows later stages as pending while running and leaves out stages that do not apply', () => {
    const record = makeRecord({ status: 'running', started: 100, finished: null })
    const inPlace = { ...config, layout: 'inplace' as const, healthUrl: '' }
    const views = stageViews(parseRunLog(`${M}100 phase fetch\n${M}104 phase build\n`), record, inPlace, 110, false)
    expect(views.map((v) => [v.id, v.state, v.seconds])).toEqual([
      ['fetch', 'done', 4], ['build', 'running', 6], ['after', 'pending', null]
    ])
  })

  it('shows only the stages a rollback or env change runs', () => {
    const rollback = stageViews(parseRunLog(`${M}1 phase golive\n${M}2 phase after\n`), makeRecord({ trigger: 'rollback', started: 1, finished: 3 }), config, 9, false)
    expect(rollback.map((v) => v.id)).toEqual(['golive', 'after', 'health'])
    const env = stageViews(parseRunLog(`${M}1 phase after\n`), makeRecord({ trigger: 'env', started: 1, finished: 3 }), config, 9, false)
    expect(env.map((v) => v.id)).toEqual(['after', 'health'])
  })

  it('flags a finished stage whose optional command failed', () => {
    const log = `${M}1 phase build\n${M}1 step O\n[x] $ lint\n${M}2 end 1\n${M}3 phase golive\n`
    const views = stageViews(parseRunLog(log), makeRecord({ status: 'warning', started: 1, finished: 4 }), { ...config, healthUrl: '' }, 9, false)
    expect(views.find((v) => v.id === 'build')?.state).toBe('warning')
  })

  it('has no stages for an old log without markers', () => {
    expect(stageViews(parseRunLog('hello'), makeRecord(), config, 9, false)).toEqual([])
  })
})

describe('failureView', () => {
  const config = makeSummary().config

  it('names the command, its exit code, the stage, and says the live site is untouched', () => {
    const view = failureView(parseRunLog(failedBuildLog), makeRecord({ status: 'failed' }), config, 'f00dbeef12', false)
    expect(view).toMatchObject({ command: 'composer install', exitCode: 2, stageLabel: 'Build', outcome: 'The live site was not touched and still serves f00dbee.' })
  })

  it('warns that an in-place build may have left the site partly updated', () => {
    const view = failureView(parseRunLog(failedBuildLog), makeRecord({ status: 'failed' }), { ...config, layout: 'inplace' }, 'abc', false)
    expect(view?.outcome).toContain('partly updated')
  })

  it('explains a switch back and an interrupted run, and stays empty for good runs', () => {
    expect(failureView(parseRunLog(''), makeRecord({ status: 'reverted' }), config, 'abc', false)?.outcome).toContain('switched back')
    expect(failureView(parseRunLog(''), makeRecord({ status: 'running' }), config, 'abc', true)?.outcome).toContain('stopped before it finished')
    expect(failureView(parseRunLog(''), makeRecord({ status: 'success' }), config, 'abc', false)).toBeNull()
  })
})

describe('skippedRows', () => {
  const config = makeSummary({
    config: {
      buildSteps: [{ command: 'composer install', optional: false }, { command: 'npm ci && npm run build', optional: false }],
      activateSteps: [{ command: 'php artisan migrate', optional: false }, { command: 'php artisan queue:restart', optional: true }]
    }
  }).config

  it('lists the commands that never ran after a failure', () => {
    const rows = skippedRows(parseRunLog(failedBuildLog), makeRecord({ status: 'failed' }), config)
    expect(rows.map((r) => r.title)).toEqual(['npm ci && npm run build', 'After going live · 2 commands'])
  })

  it('lists nothing for successful or running deploys', () => {
    expect(skippedRows(parseRunLog(failedBuildLog), makeRecord({ status: 'success' }), config)).toEqual([])
    expect(skippedRows(parseRunLog(failedBuildLog), makeRecord({ status: 'running' }), config)).toEqual([])
  })
})
