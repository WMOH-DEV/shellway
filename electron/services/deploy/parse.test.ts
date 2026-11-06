import { describe, it, expect } from 'vitest'
import { parseDoctor, parseHistory, parseKeyValues, parsePreview, parseState } from './parse'

describe('parseHistory', () => {
  it('keeps the last line per id and sorts newest first', () => {
    const tsv = [
      'd1\trunning\tmanual\t-\t100\t\t0\t',
      'd1\tsuccess\tmanual\tabc\t100\t110\t0\t',
      'd2\trunning\tauto\t-\t200\t\t0\t',
      'd2\tfailed\tauto\tdef\t200\t230\t1\tbuild failed; live site untouched',
      'garbage line',
      ''
    ].join('\n')
    const history = parseHistory(tsv)
    expect(history.map((r) => [r.id, r.status])).toEqual([['d2', 'failed'], ['d1', 'success']])
    expect(history[0]).toEqual({
      id: 'd2', status: 'failed', trigger: 'auto', commit: 'def', started: 200, finished: 230, warnings: 1,
      note: 'build failed; live site untouched'
    })
  })

  it('reads cancelled deploys', () => {
    const [record] = parseHistory('d4\tcancelled\tmanual\tabc\t300\t310\t0\tcancelled; live site untouched')
    expect(record.status).toBe('cancelled')
  })

  it('reports a running deploy with no commit or finish time yet', () => {
    const [record] = parseHistory('d3\trunning\tmanual\t-\t300\t\t0\t')
    expect(record.commit).toBe('')
    expect(record.finished).toBeNull()
  })
})

describe('parseState', () => {
  it('reads every status key', () => {
    const state = parseState([
      'CURRENT=abc', 'CURRENT_RELEASE=d1', 'LAST_ATTEMPTED=abc', 'REMOTE_HEAD=def', 'HEARTBEAT=50', 'MIRROR_HEAD=abc',
      'PENDING=', 'BEHIND=4', 'BUSY=1', 'CURRENT_SUBJECT=Fix a=b in login', 'STAGE=build', 'STEP=2', 'STEPS=5',
      'COMMAND=npm run build', 'CANCELLING=1', 'NOW=60', ''
    ].join('\n'))
    expect(state).toEqual({
      current: 'abc', currentRelease: 'd1', lastAttempted: 'abc', remoteHead: 'def', heartbeat: 50,
      mirrorHead: 'abc', pending: '', behind: 4, busy: true, currentSubject: 'Fix a=b in login',
      progress: { stage: 'build', step: 2, steps: 5, command: 'npm run build' }, cancelling: true, now: 60
    })
  })

  it('has no progress when nothing runs or the stage is unknown', () => {
    expect(parseState('BUSY=0\nNOW=1\n').progress).toBeNull()
    expect(parseState('BUSY=1\nSTAGE=other\nNOW=1\n').progress).toBeNull()
    expect(parseState('BUSY=0\nNOW=1\n').cancelling).toBe(false)
  })

  it('treats a missing heartbeat as never checked and an unknown count as null', () => {
    const state = parseState('HEARTBEAT=\nBEHIND=\nNOW=1\n')
    expect(state.heartbeat).toBeNull()
    expect(state.behind).toBeNull()
  })
})

describe('parseDoctor', () => {
  it('reads flags and sudo lines', () => {
    const report = parseDoctor([
      'USER=deploy', 'GIT=1', 'CURL=0', 'WGET=1', 'CRONTAB=1', 'SSH_KEYGEN=1', 'SITE_PATH_KIND=dir',
      'PARENT_WRITABLE=0', 'SITE_WRITABLE=1', 'DEPLOY_KEY=0',
      'SUDO_OK\t/usr/bin/systemctl reload php8.3-fpm',
      'SUDO_NEEDS\t/usr/bin/systemctl restart queue-worker scheduler-worker'
    ].join('\n'))
    expect(report).toMatchObject({ user: 'deploy', git: true, curl: false, sitePathKind: 'dir', parentWritable: false })
    expect(report.sudoOk).toEqual(['/usr/bin/systemctl reload php8.3-fpm'])
    expect(report.sudoNeeds).toEqual(['/usr/bin/systemctl restart queue-worker scheduler-worker'])
  })
})

describe('parseKeyValues', () => {
  it('keeps everything after the first equals sign', () => {
    expect(parseKeyValues('URL=https://x/?a=b\n')).toEqual({ URL: 'https://x/?a=b' })
  })
})

describe('parsePreview', () => {
  const output = [
    'FROM=aaa',
    'TO=bbb',
    'BRANCH=main',
    'TOTAL_COMMITS=2',
    'COMMIT\tbbb\t1700000100\tTest User\t0\tBump a=b dependency',
    'COMMIT\tccc\t1700000000\tOther Dev\t1\tAdd tax\tregion',
    'FILE\tA\t31\t0\t1\tdatabase/migrations/2026_add.php',
    'FILE\tM\t4\t1\t0\tapp/Models/Order.php',
    'FILE\tM\t-\t-\t0\tlogo.png',
    'TOTAL_FILES=3',
    ''
  ].join('\n')

  it('reads commits and files from the runner output', () => {
    const preview = parsePreview(output)
    expect(preview).toMatchObject({ from: 'aaa', to: 'bbb', branch: 'main', totalCommits: 2, totalFiles: 3 })
    expect(preview.commits[0]).toEqual({ sha: 'bbb', time: 1700000100, author: 'Test User', migration: false, subject: 'Bump a=b dependency' })
    expect(preview.commits[1]).toMatchObject({ migration: true, subject: 'Add tax region' })
    expect(preview.files[0]).toEqual({ status: 'A', path: 'database/migrations/2026_add.php', added: 31, removed: 0, migration: true })
  })

  it('reads binary files as unknown counts and unknown statuses as modified', () => {
    const { files } = parsePreview(`TO=bbb\nFILE\tM\t-\t-\t0\tlogo.png\nFILE\tT\t1\t1\t0\tlink\n`)
    expect(files[0]).toMatchObject({ path: 'logo.png', added: null, removed: null })
    expect(files[1].status).toBe('M')
  })

  it('is not truncated when every row is present', () => {
    expect(parsePreview(output).truncated).toBe(false)
  })

  it('flags lists cut short by the caps', () => {
    expect(parsePreview(output.replace('TOTAL_FILES=3', 'TOTAL_FILES=240')).truncated).toBe(true)
    expect(parsePreview(output.replace('TOTAL_COMMITS=2', 'TOTAL_COMMITS=80')).truncated).toBe(true)
  })

  it('rejects output without a target commit', () => {
    expect(() => parsePreview('FROM=aaa\n')).toThrow(/no preview/)
  })
})
