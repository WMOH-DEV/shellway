import { describe, it, expect } from 'vitest'
import type { ShipFile, ShipPreview } from '@/types/deploy'
import {
  authorTone,
  AUTHOR_TONES,
  COLLAPSED_FILE_ROWS,
  deployLabel,
  fileDelta,
  hasMigration,
  initials,
  isUpToDate,
  migrationCommand,
  migrationCount,
  migrationHeadline,
  requiresReview,
  rollbackCommit,
  stageChips,
  summaryLine,
  truncationNote,
  visibleFiles
} from './shipPreview'
import { makeRecord, makeSummary } from './testSummary'

const file = (overrides: Partial<ShipFile> = {}): ShipFile => ({ status: 'M', path: 'app/Order.php', added: 1, removed: 1, migration: false, ...overrides })

const preview = (overrides: Partial<ShipPreview> = {}): ShipPreview => ({
  from: 'aaa', to: 'bbb', branch: 'main', commits: [], files: [], totalCommits: 2, totalFiles: 1, truncated: false, ...overrides
})

describe('initials and tones', () => {
  it.each([
    ['Test User', 'TU'],
    ['sam', 'SA'],
    ['Ada Byron Lovelace', 'AL'],
    ['  ', '?'],
    ['', '?']
  ])('turns %j into %s', (author, expected) => {
    expect(initials(author)).toBe(expected)
  })

  it('gives the same author the same tone, within range', () => {
    expect(authorTone('Test User')).toBe(authorTone('Test User'))
    for (const name of ['sam', 'alex', 'Test User', '']) expect(authorTone(name)).toBeLessThan(AUTHOR_TONES)
  })
})

describe('summary and button labels', () => {
  it('counts commits and files', () => {
    expect(summaryLine(preview({ totalCommits: 1, totalFiles: 14 }))).toBe('1 commit, 14 files')
    expect(summaryLine(preview({ totalCommits: 2, totalFiles: 1 }))).toBe('2 commits, 1 file')
  })

  it('says a branch with nothing new is already up to date and offers a redeploy', () => {
    const same = preview({ totalCommits: 0, totalFiles: 0 })
    expect(isUpToDate(same)).toBe(true)
    expect(summaryLine(same)).toBe('Already up to date')
    expect(deployLabel(same)).toBe('Redeploy')
  })

  it('names the number of commits on the deploy button', () => {
    expect(deployLabel(preview({ totalCommits: 1 }))).toBe('Deploy 1 commit')
    expect(deployLabel(preview({ totalCommits: 12 }))).toBe('Deploy 12 commits')
  })

  it('only mentions a truncation when a list was cut', () => {
    expect(truncationNote(preview())).toBe('')
    const commits = new Array(50).fill(null)
    const files = new Array(200).fill(file())
    expect(truncationNote(preview({ truncated: true, totalCommits: 80, commits, totalFiles: 0 }))).toBe('Showing 50 of 80 commits')
    expect(truncationNote(preview({ truncated: true, totalCommits: 2, commits: [null, null] as never, totalFiles: 240, files }))).toBe('Showing 200 of 240 files')
    expect(truncationNote(preview({ truncated: true, totalCommits: 80, commits, totalFiles: 240, files }))).toBe('Showing 50 of 80 commits and 200 of 240 files')
  })
})

describe('files', () => {
  it('collapses long lists until expanded', () => {
    const files = Array.from({ length: 10 }, (_, i) => file({ path: `f${i}` }))
    expect(visibleFiles(files, false)).toHaveLength(COLLAPSED_FILE_ROWS)
    expect(visibleFiles(files, true)).toHaveLength(10)
  })

  it('formats additions and removals, hiding zeros and marking binary files', () => {
    expect(fileDelta(file({ added: 31, removed: 0 }))).toEqual({ added: '+31', removed: '' })
    expect(fileDelta(file({ added: 0, removed: 2 }))).toEqual({ added: '', removed: '−2' })
    expect(fileDelta(file({ added: null, removed: null }))).toEqual({ added: 'binary', removed: '' })
  })
})

describe('migrations', () => {
  it('detects a migration in a file or a commit', () => {
    expect(hasMigration(preview({ files: [file({ migration: true })] }))).toBe(true)
    expect(hasMigration(preview({ commits: [{ sha: 'b', subject: 's', author: 'a', time: 1, migration: true }] }))).toBe(true)
    expect(hasMigration(preview({ files: [file()] }))).toBe(false)
  })

  it('counts migrations that are added or changed but not deleted ones', () => {
    const files = [file({ migration: true, status: 'A' }), file({ migration: true, status: 'M' }), file({ migration: true, status: 'D' }), file()]
    expect(migrationCount(preview({ files }))).toBe(2)
  })

  it('words the callout for a known or unknown count', () => {
    expect(migrationHeadline(1)).toBe('This deploy adds 1 migration.')
    expect(migrationHeadline(3)).toBe('This deploy adds 3 migrations.')
    expect(migrationHeadline(0)).toBe('This deploy includes database migrations.')
  })

  it('asks for a review when something is pending or when migrations ship on a site that asks first', () => {
    const withMigration = preview({ files: [file({ migration: true })] })
    const asks = makeSummary({ config: { approveMigrations: true } })
    expect(requiresReview(asks, withMigration)).toBe(true)
    expect(requiresReview(asks, preview())).toBe(false)
    expect(requiresReview(makeSummary({ config: { approveMigrations: false } }), withMigration)).toBe(false)
    expect(requiresReview(makeSummary({ state: { pending: 'bbb' } }), preview())).toBe(true)
  })

  it('finds the command that runs migrations', () => {
    const config = makeSummary({
      config: {
        buildSteps: [{ command: 'npm run build', optional: false }],
        activateSteps: [{ command: 'php artisan migrate --force', optional: false }]
      }
    }).config
    expect(migrationCommand(config)).toBe('php artisan migrate --force')
    expect(migrationCommand(makeSummary().config)).toBe('')
  })
})

describe('rollbackCommit', () => {
  const live = makeRecord({ id: 'd2', commit: 'bbb' })
  const older = makeRecord({ id: 'd1', commit: 'aaa' })

  it('offers the newest earlier successful deploy on a releases site', () => {
    const summary = makeSummary({ state: { current: 'bbb', currentRelease: 'd2' }, history: [live, older] })
    expect(rollbackCommit(summary)).toBe('aaa')
  })

  it('offers nothing when there is no earlier deploy', () => {
    expect(rollbackCommit(makeSummary({ state: { current: 'bbb', currentRelease: 'd2' }, history: [live] }))).toBe('')
  })

  it('offers nothing when only one release is kept', () => {
    const summary = makeSummary({ config: { keepReleases: 1 }, state: { current: 'bbb', currentRelease: 'd2' }, history: [live, older] })
    expect(rollbackCommit(summary)).toBe('')
  })

  it('offers nothing before the first deploy', () => {
    expect(rollbackCommit(makeSummary({ state: { current: '' }, history: [older] }))).toBe('')
  })

  it('skips failed deploys and env changes', () => {
    const summary = makeSummary({
      state: { current: 'bbb', currentRelease: 'd4' },
      history: [
        makeRecord({ id: 'd4', commit: 'bbb' }),
        makeRecord({ id: 'd3', commit: 'ccc', status: 'failed' }),
        makeRecord({ id: 'd2', commit: 'ddd', trigger: 'env' }),
        older
      ]
    })
    expect(rollbackCommit(summary)).toBe('aaa')
  })

  it('compares commits on an in-place site and needs no kept releases', () => {
    const summary = makeSummary({
      config: { layout: 'inplace', keepReleases: 1 },
      state: { current: 'bbb', currentRelease: '' },
      history: [makeRecord({ id: 'd3', commit: 'bbb' }), live, older]
    })
    expect(rollbackCommit(summary)).toBe('aaa')
  })
})

describe('stageChips', () => {
  const step = (command: string) => ({ command, optional: false })

  it('lists only the stages the site runs', () => {
    const { config } = makeSummary()
    expect(stageChips(config).map((c) => c.id)).toEqual(['fetch', 'activate'])
  })

  it('counts commands and describes the health check', () => {
    const { config } = makeSummary({
      config: {
        buildSteps: [step('a'), step('b'), step('c')],
        activateSteps: [step('d')],
        healthUrl: 'https://app.example.com/up',
        healthStatus: 200
      }
    })
    expect(stageChips(config)).toEqual([
      { id: 'fetch', name: 'Fetch', detail: '' },
      { id: 'build', name: 'Build', detail: '3 commands' },
      { id: 'activate', name: 'Go live', detail: 'switch' },
      { id: 'after', name: 'After going live', detail: '1 command' },
      { id: 'health', name: 'Health check', detail: '/up · 200' }
    ])
  })

  it('says where the code comes from and how it goes live', () => {
    const { config } = makeSummary({ config: { sourceMode: 'pc', layout: 'inplace' } })
    const chips = stageChips(config)
    expect(chips[0].detail).toBe('from this PC')
    expect(chips.find((c) => c.id === 'activate')?.detail).toBe('in place')
  })
})
