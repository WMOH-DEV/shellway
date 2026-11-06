import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { execFileSync } from 'child_process'
import { mkdirSync, mkdtempSync, writeFileSync, rmSync, existsSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { LocalGit, type PreviewRequest } from './LocalGit'

const gitEnv = { GIT_AUTHOR_NAME: 'T', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 'T', GIT_COMMITTER_EMAIL: 't@t' }
const git = (cwd: string, ...args: string[]) => execFileSync('git', args, { cwd, env: { ...process.env, ...gitEnv } }).toString().trim()

let base: string
let origin: string
let work: string
let local: LocalGit

function commit(content: string): string {
  writeFileSync(join(work, 'f.txt'), content)
  git(work, 'add', '-A')
  git(work, 'commit', '-q', '-m', content)
  git(work, 'push', '-q', 'origin', 'main')
  return git(work, 'rev-parse', 'HEAD')
}

function bundleHeads(file: string): string {
  return execFileSync('git', ['bundle', 'list-heads', file]).toString()
}

describe('LocalGit', () => {
  beforeEach(() => {
    base = mkdtempSync(join(tmpdir(), 'sw-localgit-'))
    origin = join(base, 'origin.git')
    work = join(base, 'work')
    execFileSync('git', ['init', '-q', '--bare', '-b', 'main', origin])
    execFileSync('git', ['init', '-q', '-b', 'main', work])
    git(work, 'remote', 'add', 'origin', origin)
    local = new LocalGit(join(base, 'cache'), { allowLocalRepos: true })
  })

  afterEach(() => rmSync(base, { recursive: true, force: true }))

  it('reads the branch head and fails clearly for a missing branch', async () => {
    const head = commit('one')
    expect(await local.available()).toBe(true)
    expect(await local.lsRemote(origin, 'main')).toBe(head)
    await expect(local.lsRemote(origin, 'nope')).rejects.toThrow(/nope was not found/)
  })

  it('creates a full bundle when the server has nothing', async () => {
    const head = commit('one')
    expect(await local.fetch(origin, 'main')).toBe(head)
    const bundle = await local.createBundle(origin, 'main', '')
    expect(bundle.full).toBe(true)
    expect(bundleHeads(bundle.file)).toContain(`${head} refs/heads/main`)
    rmSync(bundle.file)
  })

  it('creates an incremental bundle on top of the server head', async () => {
    const first = commit('one')
    const second = commit('two')
    await local.fetch(origin, 'main')
    const bundle = await local.createBundle(origin, 'main', first)
    expect(bundle.full).toBe(false)
    expect(bundleHeads(bundle.file)).toContain(second)
    expect(() => execFileSync('git', ['bundle', 'verify', bundle.file], { cwd: work, stdio: 'pipe' })).not.toThrow()
    rmSync(bundle.file)
  })

  it('falls back to a full bundle when the server head is unknown locally', async () => {
    commit('one')
    await local.fetch(origin, 'main')
    const bundle = await local.createBundle(origin, 'main', 'f'.repeat(40))
    expect(bundle.full).toBe(true)
    expect(existsSync(bundle.file)).toBe(true)
    rmSync(bundle.file)
  })

  it('reports how many commits the live one is behind', async () => {
    const first = commit('one')
    commit('two')
    const third = commit('three')
    expect(await local.drift(origin, 'main', first)).toEqual({ head: third, behind: 2 })
    expect(await local.drift(origin, 'main', third)).toEqual({ head: third, behind: 0 })
    expect(await local.drift(origin, 'main', '')).toEqual({ head: third, behind: null })
    expect(await local.drift(origin, 'main', 'f'.repeat(40))).toEqual({ head: third, behind: null })
  })

  it('knows when the server already has an older commit', async () => {
    const first = commit('one')
    const second = commit('two')
    await local.fetch(origin, 'main')
    expect(await local.isAncestor(origin, first, second)).toBe(true)
    expect(await local.isAncestor(origin, second, second)).toBe(true)
    expect(await local.isAncestor(origin, second, first)).toBe(false)
    expect(await local.isAncestor(origin, second, '')).toBe(false)
  })
})

describe('LocalGit with a server supplied URL', () => {
  const strict = new LocalGit(join(tmpdir(), 'sw-localgit-strict'))
  const marker = join(tmpdir(), `sw-pwned-${process.pid}`)

  afterEach(() => rmSync(marker, { force: true }))

  it.each([
    [`--upload-pack=touch ${marker}`],
    ['/home/someone/private-repo'],
    ['file:///home/someone/private-repo'],
    ['ext::sh -c touch% /tmp/x'],
    ['../relative']
  ])('refuses %s without running anything', async (url) => {
    await expect(strict.lsRemote(url, 'main')).rejects.toThrow()
    await expect(strict.fetch(url, 'main')).rejects.toThrow()
    expect(existsSync(marker)).toBe(false)
  })

  it('refuses a branch that looks like an option', async () => {
    await expect(strict.lsRemote('https://example.com/acme/app.git', '--upload-pack=x')).rejects.toThrow(/Branch/)
  })
})

describe('LocalGit preview', () => {
  function commitFiles(files: Record<string, string>, message: string): string {
    for (const [path, content] of Object.entries(files)) {
      mkdirSync(join(work, path, '..'), { recursive: true })
      writeFileSync(join(work, path), content)
    }
    git(work, 'add', '-A')
    git(work, 'commit', '-q', '-m', message)
    git(work, 'push', '-q', 'origin', 'main')
    return git(work, 'rev-parse', 'HEAD')
  }

  const request = (overrides: Partial<PreviewRequest> = {}): PreviewRequest =>
    ({ url: origin, branch: 'main', live: '', pending: '', migrationsPath: 'database/migrations', ...overrides })

  beforeEach(() => {
    base = mkdtempSync(join(tmpdir(), 'sw-localgit-'))
    origin = join(base, 'origin.git')
    work = join(base, 'work')
    execFileSync('git', ['init', '-q', '--bare', '-b', 'main', origin])
    execFileSync('git', ['init', '-q', '-b', 'main', work])
    git(work, 'remote', 'add', 'origin', origin)
    local = new LocalGit(join(base, 'cache'), { allowLocalRepos: true })
  })

  afterEach(() => rmSync(base, { recursive: true, force: true }))

  it('shows the head commit and its files when nothing is live', async () => {
    const head = commitFiles({ 'index.html': 'v1\n' }, 'first')
    const preview = await local.preview(request())
    expect(preview).toMatchObject({ from: '', to: head, branch: 'main', totalCommits: 1, totalFiles: 1, truncated: false })
    expect(preview.commits).toEqual([{ sha: head, time: expect.any(Number), author: 'T', subject: 'first', migration: false }])
    expect(preview.files).toEqual([{ status: 'A', path: 'index.html', added: 1, removed: 0, migration: false }])
  })

  it('lists commits and files between the live commit and the branch head with migrations first', async () => {
    const live = commitFiles({ 'index.html': 'v1\n', 'old.txt': 'a\nb\n' }, 'first')
    const migration = commitFiles({ 'index.html': 'v2\n', 'database/migrations/2026_add.php': '<?php\n' }, 'Add tax region')
    rmSync(join(work, 'old.txt'))
    const head = commitFiles({ 'logo.png': 'x' }, 'Drop old file')
    const preview = await local.preview(request({ live }))
    expect(preview).toMatchObject({ from: live, to: head, totalCommits: 2, totalFiles: 4 })
    expect(preview.commits.map((c) => [c.sha, c.migration, c.subject])).toEqual([[head, false, 'Drop old file'], [migration, true, 'Add tax region']])
    expect(preview.files.map((f) => [f.status, f.path, f.added, f.removed, f.migration])).toEqual([
      ['A', 'database/migrations/2026_add.php', 1, 0, true],
      ['M', 'index.html', 1, 1, false],
      ['A', 'logo.png', 1, 0, false],
      ['D', 'old.txt', 0, 2, false]
    ])
  })

  it('reports nothing to ship when the live commit is the head', async () => {
    const live = commitFiles({ 'index.html': 'v1' }, 'first')
    const preview = await local.preview(request({ live }))
    expect(preview).toMatchObject({ from: live, to: live, totalCommits: 0, totalFiles: 0, commits: [], files: [] })
  })

  it('previews the pending commit instead of the newest one', async () => {
    const live = commitFiles({ 'index.html': 'v1' }, 'first')
    const pending = commitFiles({ 'database/migrations/2026_add.php': '<?php' }, 'Add table')
    await local.fetch(origin, 'main')
    commitFiles({ 'later.txt': 'x' }, 'Later')
    const preview = await local.preview(request({ live, pending }))
    expect(preview.to).toBe(pending)
    expect(preview.totalCommits).toBe(1)
  })

  it('treats a live commit the cache does not know as nothing being live', async () => {
    const head = commitFiles({ 'index.html': 'v1' }, 'first')
    const preview = await local.preview(request({ live: 'f'.repeat(40) }))
    expect(preview).toMatchObject({ from: '', to: head, totalCommits: 1 })
  })

  it('caps the commit and file lists and flags it', async () => {
    const live = commitFiles({ 'index.html': 'v1' }, 'first')
    for (let i = 0; i < 54; i++) git(work, 'commit', '--allow-empty', '-q', '-m', `empty ${i}`)
    const many = Object.fromEntries(Array.from({ length: 204 }, (_, i) => [`src/file-${String(i).padStart(3, '0')}.txt`, 'x']))
    commitFiles({ ...many, 'database/migrations/zzz_last.php': '<?php' }, 'Many files')
    const preview = await local.preview(request({ live }))
    expect(preview).toMatchObject({ totalCommits: 55, totalFiles: 205, truncated: true })
    expect(preview.commits).toHaveLength(50)
    expect(preview.files).toHaveLength(200)
    expect(preview.files[0].path).toBe('database/migrations/zzz_last.php')
  })
})
