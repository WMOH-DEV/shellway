import { spawnSync } from 'child_process'
import { createHash } from 'crypto'
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { EXIT_EDIT_REJECTED, EXIT_EDIT_RESTORED, EXIT_FILE_CHANGED, fileEditRollback, fileEditScript, fileEditStep, type FileEditSpec } from './fileEdit'

const RUN_ID = 'run-1'
let root: string
let file: string
let backups: string

const sha = (text: string): string => createHash('sha256').update(text).digest('hex')

function run(script: string, env: Record<string, string> = {}) {
  const result = spawnSync('/bin/sh', ['-s'], { input: script, env: { PATH: process.env.PATH, SHELLWAY_RUN_ID: RUN_ID, ...env }, encoding: 'utf8' })
  return { code: result.status, output: result.stdout + result.stderr }
}

const spec = (overrides: Partial<FileEditSpec> = {}): FileEditSpec => ({ id: 'edit', label: 'Edit', path: file, content: 'new\n', originalSha256: sha('old\n'), ...overrides })
const edit = (overrides: Partial<FileEditSpec> = {}) => run(fileEditScript(spec(overrides), backups))
const backupOf = (path: string) => join(backups, RUN_ID, path)
const counter = () => join(root, 'count')
const countCalls = `echo x >> '${join('$ROOT', 'count')}'`

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'shellway-edit-'))
  backups = join(root, 'backups')
  file = join(root, 'etc', 'app.conf')
  run(`mkdir -p '${join(root, 'etc')}'`)
  writeFileSync(file, 'old\n')
  chmodSync(file, 0o640)
})

afterEach(() => rmSync(root, { recursive: true, force: true }))

describe('fileEditScript', () => {
  it('backs up, writes and keeps the original mode', () => {
    const result = edit({ test: 'true', reload: 'true', verify: 'true' })
    expect(result.code).toBe(0)
    expect(readFileSync(file, 'utf8')).toBe('new\n')
    expect(statSync(file).mode & 0o777).toBe(0o640)
    expect(readFileSync(backupOf(file), 'utf8')).toBe('old\n')
    expect(result.output).toContain(`SHELLWAY_STATE backup=${backupOf(file)}`)
  })

  it('writes nothing when the file changed since review', () => {
    const result = edit({ originalSha256: sha('something else\n') })
    expect(result.code).toBe(EXIT_FILE_CHANGED)
    expect(readFileSync(file, 'utf8')).toBe('old\n')
    expect(existsSync(backupOf(file))).toBe(false)
    expect(result.output.trim().split('\n').pop()).toContain('changed after you reviewed it')
  })

  it('refuses when a file appeared where none was expected', () => {
    expect(edit({ originalSha256: null }).code).toBe(EXIT_FILE_CHANGED)
    expect(readFileSync(file, 'utf8')).toBe('old\n')
  })

  it('creates a new file with mode 644 in a new folder', () => {
    const fresh = join(root, 'new', 'dir', 'site.conf')
    const result = edit({ path: fresh, originalSha256: null })
    expect(result.code).toBe(0)
    expect(readFileSync(fresh, 'utf8')).toBe('new\n')
    expect(statSync(fresh).mode & 0o777).toBe(0o644)
    expect(result.output).toContain('SHELLWAY_STATE created=1')
  })

  it('applies an explicit mode', () => {
    expect(edit({ mode: '600' }).code).toBe(0)
    expect(statSync(file).mode & 0o777).toBe(0o600)
  })

  it('keeps tricky content byte for byte', () => {
    const content = "a $HOME `id` 'q' \"d\" \\ SHELLWAY_B64_END\nünïcødé ✓\nno newline at end"
    expect(edit({ content }).code).toBe(0)
    expect(readFileSync(file, 'utf8')).toBe(content)
  })

  it('puts the original back when the test fails', () => {
    const result = edit({ test: 'echo "bad config line 3"; false', reload: 'true' })
    expect(result.code).toBe(EXIT_EDIT_REJECTED)
    expect(readFileSync(file, 'utf8')).toBe('old\n')
    expect(statSync(file).mode & 0o777).toBe(0o640)
    expect(result.output).toContain('bad config line 3')
    expect(result.output.trim().split('\n').pop()).toBe('The test failed, so nothing was changed. The original file is back in place.')
  })

  it('removes a new file when its test fails', () => {
    const fresh = join(root, 'etc', 'fresh.conf')
    expect(edit({ path: fresh, originalSha256: null, test: 'false' }).code).toBe(EXIT_EDIT_REJECTED)
    expect(existsSync(fresh)).toBe(false)
  })

  it('restores, tests and reloads again when the reload fails', () => {
    const reload = `${countCalls}; [ "$(wc -l < '${counter()}')" -gt 1 ]`
    const result = run(fileEditScript(spec({ test: 'true', reload: reload.replace('$ROOT', root) }), backups))
    expect(result.code).toBe(EXIT_EDIT_RESTORED)
    expect(readFileSync(file, 'utf8')).toBe('old\n')
    expect(readFileSync(counter(), 'utf8').trim().split('\n')).toHaveLength(2)
    expect(result.output.trim().split('\n').pop()).toBe('The reload failed. The original file is back in place.')
  })

  it('restores when the verify step fails', () => {
    const result = edit({ reload: 'true', verify: 'false' })
    expect(result.code).toBe(EXIT_EDIT_RESTORED)
    expect(readFileSync(file, 'utf8')).toBe('old\n')
  })

  it('refuses to replace a symlink', () => {
    const link = join(root, 'etc', 'link.conf')
    symlinkSync(file, link)
    expect(edit({ path: link }).code).toBe(EXIT_EDIT_REJECTED)
    expect(readFileSync(file, 'utf8')).toBe('old\n')
  })

  it('fails before writing when the run id is missing', () => {
    const result = spawnSync('/bin/sh', ['-s'], { input: fileEditScript(spec(), backups), env: { PATH: process.env.PATH }, encoding: 'utf8' })
    expect(result.status).not.toBe(0)
    expect(readFileSync(file, 'utf8')).toBe('old\n')
  })

  it.each(['relative/path', '/etc/../shadow', '/etc/a b', "/etc/a'b", '/etc/a\nb'])('rejects the path %j', (path) => {
    expect(() => fileEditScript(spec({ path }))).toThrow('Invalid file path')
  })

  it('rejects a bad mode, owner or checksum', () => {
    expect(() => fileEditScript(spec({ mode: '999' }))).toThrow('Invalid file mode')
    expect(() => fileEditScript(spec({ owner: 'root; rm -rf /' }))).toThrow('Invalid file owner')
    expect(() => fileEditScript(spec({ originalSha256: 'abc' }))).toThrow('Invalid checksum')
  })
})

describe('fileEditScript stop handling', () => {
  const script = (overrides: Partial<FileEditSpec> = {}) => fileEditScript(spec(overrides), backups)

  it('traps termination right after the new file goes live, and stays valid shell', () => {
    const text = script({ test: 'true', reload: 'true', verify: 'true' })
    const lines = text.split('\n')
    const trapAt = lines.findIndex((line) => line.startsWith('trap '))
    expect(trapAt).toBeGreaterThan(lines.findIndex((line) => line.startsWith('recover() {')))
    expect(lines[trapAt - 1]).toMatch(/^mv -f "\$tmp" "\$path" \|\|/)
    expect(lines[trapAt]).toBe(`trap 'recover "Stopped before finishing."' TERM HUP INT`)
    expect(spawnSync('/bin/sh', ['-n'], { input: text }).status).toBe(0)
  })

  it('puts the original file back when terminated after the write', () => {
    const result = run(script({ verify: 'kill -TERM $$' }))
    expect(result.code).toBe(EXIT_EDIT_RESTORED)
    expect(readFileSync(file, 'utf8')).toBe('old\n')
    expect(result.output).toContain('Stopped before finishing. The original file is back in place.')
  })
})

describe('fileEditRollback', () => {
  it('restores the backup and reloads', () => {
    expect(edit().code).toBe(0)
    const marker = join(root, 'reloaded')
    const result = run(fileEditRollback(spec({ test: 'true', reload: `touch '${marker}'` })), { backup: backupOf(file) })
    expect(result.code).toBe(0)
    expect(readFileSync(file, 'utf8')).toBe('old\n')
    expect(existsSync(marker)).toBe(true)
  })

  it('removes a file the edit created', () => {
    const fresh = join(root, 'etc', 'fresh.conf')
    expect(edit({ path: fresh, originalSha256: null }).code).toBe(0)
    expect(run(fileEditRollback(spec({ path: fresh })), { created: '1' }).code).toBe(0)
    expect(existsSync(fresh)).toBe(false)
  })

  it('does nothing without recorded state', () => {
    const result = run(fileEditRollback(spec()))
    expect(result.code).toBe(1)
    expect(readFileSync(file, 'utf8')).toBe('old\n')
  })
})

describe('fileEditStep', () => {
  it('is a reversible root step whose clean exits mean nothing changed', () => {
    const step = fileEditStep({ ...spec(), path: '/etc/nginx/sites-available/app', test: 'nginx -t', reload: 'systemctl reload nginx' })
    expect(step).toMatchObject({ kind: 'file-edit', root: true, timeoutSeconds: 60, cleanExits: [EXIT_FILE_CHANGED, EXIT_EDIT_REJECTED, EXIT_EDIT_RESTORED] })
    expect(step.rollback).toContain('systemctl reload nginx')
    expect(step.display).toBe("cp -p '/etc/nginx/sites-available/app' \"/var/backups/shellway/$SHELLWAY_RUN_ID/etc/nginx/sites-available/app\"\nwrite '/etc/nginx/sites-available/app'\nnginx -t\nsystemctl reload nginx")
    expect(step.script).toContain("'/var/backups/shellway'/\"${SHELLWAY_RUN_ID:?}\"'/etc/nginx/sites-available/app'")
  })
})
